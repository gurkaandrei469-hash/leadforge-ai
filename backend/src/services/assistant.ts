import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { tools, type Tool, type ToolContext } from './assistant.tools.js';
import { runMockAgent } from './assistant.mock.js';
import { pickModelForUserMessage, MODEL_LABELS } from './assistant.router.js';

// Models known to Groq (defensive check — never send OpenRouter slugs to Groq endpoint)
const GROQ_MODELS = new Set<string>([
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile',
  'llama-3.1-8b-instant',
  'deepseek-r1-distill-llama-70b',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
]);

// When Groq is rate-limited, fall back to this OpenRouter model
const OPENROUTER_FALLBACK_MODEL = 'google/gemma-4-26b-a4b-it:free';

const SYSTEM_PROMPT = `You are LeadForge's AI assistant — a polished, knowledgeable expert helping B2B sales and growth teams find and reach customers.

YOUR VOICE
- Confident, concise, professional. Like a senior CX agent at a top SaaS company.
- Never apologize for limitations. Never explain how the system works internally.
- Never reveal internal mechanics: don't mention "tools", "functions", "API calls", "endpoints", or specific function names like create_extraction_job, web_search, get_team_usage, etc. The user doesn't care and shouldn't know they exist.
- Use the user's own language. If they're casual, be casual. If formal, be formal.

WHAT YOU DO
- Help users run lead extractions, verify emails, search their database, build prospect lists, push to their CRM, draft cold emails, and look at analytics.
- When you take an action, briefly say what you're doing in human terms ("Starting an extraction now…", "Pulling your recent jobs…", "Drafting the email…"). Never say "I'll call X tool" or "Using create_extraction_job".
- After an action completes, summarize the outcome in one or two sentences. Don't dump JSON or restate every field — the dashboard already shows results visually.

OUTPUT FORMAT
- Markdown supported. Prefer short paragraphs.
- Use bold for emphasis sparingly.
- Use bullet points when listing 3+ items.
- For emails, format as quoted blocks. Always include subject line + body.
- Avoid emoji unless the user uses them first.

WHEN UNCERTAIN
- If you need a piece of information from the user (a URL, an email, a lead ID), ask one clear question. Don't give a numbered todo list of "what we need to do".
- If something failed, just say it failed in plain English and suggest the next step. Never expose error codes or HTTP status to the user.
- If the user asks for something outside your scope (e.g. SQL queries, system status, raw database access), politely redirect: "I can help with leads, campaigns, and account info — anything in those areas you want to dig into?"

LIMITS
- Maximum 5 actions per user message unless they explicitly ask for a multi-step workflow.`;

const MAX_HOPS = 6;

// Provider preference: explicit mock > Groq (PRIMARY) > OpenRouter > Anthropic > OpenAI > mock fallback
// Groq wins for chat agents: sub-second TTFT, generous free tier, OpenAI-compatible.
type Provider = 'groq' | 'openrouter' | 'anthropic' | 'openai' | 'mock';
const provider: Provider = env.MOCK_AGENT
  ? 'mock'
  : env.GROQ_API_KEY
    ? 'groq'
    : env.OPENROUTER_API_KEY
      ? 'openrouter'
      : env.ANTHROPIC_API_KEY
        ? 'anthropic'
        : env.OPENAI_API_KEY
          ? 'openai'
          : 'mock';

const anthropic = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
const openai = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;
const openrouter = env.OPENROUTER_API_KEY
  ? new OpenAI({
      apiKey: env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: { 'HTTP-Referer': 'https://leadforge.ai', 'X-Title': 'LeadForge AI' },
    })
  : null;
// Groq uses the OpenAI SDK with a custom baseURL.
const groq = env.GROQ_API_KEY
  ? new OpenAI({
      apiKey: env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    })
  : null;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
        | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
      >;
}

export interface AgentEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'done' | 'error' | 'meta';
  data: unknown;
}

function lastUserText(history: ChatMessage[]): string {
  const last = [...history].reverse().find((m) => m.role === 'user');
  if (!last) return '';
  if (typeof last.content === 'string') return last.content;
  return (last.content as any[])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join(' ');
}

const findTool = (name: string): Tool | undefined => tools.find((t) => t.name === name);

export async function runAgent(
  history: ChatMessage[],
  ctx: ToolContext,
  onEvent: (e: AgentEvent) => void | Promise<void>,
  options: { model?: string } = {},
): Promise<void> {
  try {
    if (provider === 'groq') {
      // Smart model pick based on the user's last message — unless the user explicitly overrode
      const lastUserMsg = lastUserText(history);
      const userPicked = options.model && GROQ_MODELS.has(options.model) ? options.model : undefined;
      const autoPicked = pickModelForUserMessage(lastUserMsg);
      const model = userPicked ?? autoPicked;

      if (!userPicked && model !== env.GROQ_MODEL) {
        const meta = MODEL_LABELS[model as keyof typeof MODEL_LABELS];
        await onEvent({ type: 'meta', data: { routed_to: model, reason: meta?.reason } });
      }

      try {
        return await runOpenAICompat(history, ctx, onEvent, groq!, model, 'groq');
      } catch (err) {
        // On rate-limit / quota errors, transparently fall back to OpenRouter (if available)
        const msg = (err as Error).message ?? '';
        const isQuota = /429|rate.?limit|quota|insufficient|tokens.per.minute/i.test(msg);
        if (isQuota && openrouter) {
          logger.warn({ err: msg }, 'groq rate-limited, falling back to OpenRouter');
          await onEvent({ type: 'meta', data: { fallback: 'openrouter', reason: 'groq quota' } });
          return await runOpenAICompat(history, ctx, onEvent, openrouter, OPENROUTER_FALLBACK_MODEL, 'openrouter');
        }
        throw err;
      }
    }
    if (provider === 'openrouter') {
      const model = options.model ?? env.OPENROUTER_MODEL;
      return await runOpenAICompat(history, ctx, onEvent, openrouter!, model, 'openrouter');
    }
    if (provider === 'anthropic') return await runAnthropic(history, ctx, onEvent);
    if (provider === 'openai') return await runOpenAICompat(history, ctx, onEvent, openai!, normaliseOpenAIModel(env.ASSISTANT_MODEL), 'openai');
    return await runMockAgent(history, ctx, onEvent);
  } catch (err) {
    const msg = (err as Error).message ?? 'Agent error';
    logger.error({ err, provider }, 'agent failed');
    // Graceful fallback to mock router so the user is never blocked
    if (provider !== 'mock') {
      // No more raw error dumps — just a soft notice in the assistant card itself
      await onEvent({ type: 'meta', data: { degraded: true, hint: 'High traffic — using a simpler responder for this message.' } });
      try { await runMockAgent(history, ctx, onEvent); } catch { /* swallow */ }
    } else {
      await onEvent({ type: 'error', data: humanizeError(msg) });
    }
  }
}

/** Convert raw provider errors into something a user can actually read. */
function humanizeError(raw: string): string {
  if (/429|rate.?limit|too many requests/i.test(raw)) {
    return 'The AI is at peak capacity right now. Please try again in a few seconds.';
  }
  if (/quota|insufficient.*credit|insufficient_quota|out of credit/i.test(raw)) {
    return "We've reached our daily quota on this provider. Try again tomorrow, or switch the model in the picker.";
  }
  if (/404|model.*(not.*exist|not.*found)|does not have access/i.test(raw)) {
    return "That model isn't available right now — try the default one.";
  }
  if (/unauthorized|invalid.*api.*key|authentication/i.test(raw)) {
    return 'Our LLM connection needs to be re-authenticated. The admin has been notified.';
  }
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET/i.test(raw)) {
    return 'The AI took too long to respond. Please try again.';
  }
  if (/network|fetch failed|ECONNREFUSED|ENOTFOUND/i.test(raw)) {
    return 'Network hiccup talking to the AI. Please try again.';
  }
  // Generic fallback — strip technical bits
  return 'Something went wrong on our side. Please try again.';
}

function normaliseOpenAIModel(m: string): string {
  return m.startsWith('gpt-') ? m : 'gpt-4o-mini';
}

// ─────────────────────────── Anthropic backend ───────────────────────────

async function runAnthropic(history: ChatMessage[], ctx: ToolContext, onEvent: (e: AgentEvent) => void | Promise<void>) {
  if (!anthropic) return;
  const messages: any[] = JSON.parse(JSON.stringify(history));

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const resp = await anthropic.messages.create({
      model: env.ASSISTANT_MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as any })),
      messages,
    });
    const textParts = resp.content.filter((c: any) => c.type === 'text');
    for (const p of textParts) await onEvent({ type: 'text', data: (p as any).text });
    messages.push({ role: 'assistant', content: resp.content });
    if (resp.stop_reason !== 'tool_use') {
      await onEvent({ type: 'done', data: null });
      return;
    }
    const toolUses = resp.content.filter((c: any) => c.type === 'tool_use');
    const toolResults: any[] = [];
    for (const tu of toolUses as any[]) {
      const out = await runTool(tu.name, tu.input, ctx, onEvent, tu.id);
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: out.content, is_error: !out.ok });
    }
    messages.push({ role: 'user', content: toolResults });
  }
  await onEvent({ type: 'error', data: 'Hit max tool-use hops.' });
}

// ─────────────────────────── OpenAI-compatible backend (OpenRouter + OpenAI) ───────────────────────────

async function runOpenAICompat(
  history: ChatMessage[],
  ctx: ToolContext,
  onEvent: (e: AgentEvent) => void | Promise<void>,
  client: OpenAI,
  model: string,
  label: string,
) {
  // Convert our normalised history → OpenAI message format
  const messages: any[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const m of history) {
    if (typeof m.content === 'string') {
      messages.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      const text = m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
      const toolCalls = m.content
        .filter((b: any) => b.type === 'tool_use')
        .map((b: any) => ({
          id: b.id,
          type: 'function',
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }));
      messages.push({
        role: 'assistant',
        ...(text && { content: text }),
        ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
      });
    } else {
      for (const b of m.content as any[]) {
        if (b.type === 'tool_result') {
          messages.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.content });
        } else if (b.type === 'text') {
          messages.push({ role: 'user', content: b.text });
        }
      }
    }
  }

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    logger.debug({ hop, model, label }, 'agent hop');
    // Retry on transient rate-limits (free OpenRouter pool shares quota across users)
    let resp: any;
    let attempt = 0;
    while (true) {
      try {
        resp = await client.chat.completions.create({
          model,
          messages,
          tools: tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.input_schema as any },
          })),
          tool_choice: 'auto',
        });
        break;
      } catch (err: any) {
        const status = err?.status ?? err?.response?.status;
        const isRateLimit = status === 429 || /rate.?limit|temporarily/i.test(err?.message ?? '');
        if (isRateLimit && attempt < 3) {
          const waitMs = 1500 * Math.pow(2, attempt);
          logger.warn({ attempt, waitMs, label }, 'rate-limited; retrying');
          await new Promise((r) => setTimeout(r, waitMs));
          attempt++;
          continue;
        }
        throw err;
      }
    }
    const msg = resp.choices[0]?.message;
    if (!msg) break;

    if (msg.content) await onEvent({ type: 'text', data: msg.content });
    messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      await onEvent({ type: 'done', data: null });
      return;
    }

    for (const tc of msg.tool_calls) {
      const name = (tc as any).function?.name;
      const args = (() => {
        const raw = (tc as any).function?.arguments;
        if (!raw || raw === 'null' || raw === '') return {};
        try {
          const parsed = JSON.parse(raw);
          // Groq's Llama sends `null` for no-arg tools — normalize to {}
          return parsed === null ? {} : parsed;
        } catch { return {}; }
      })();
      const out = await runTool(name, args, ctx, onEvent, tc.id);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: out.content });
    }
  }
  await onEvent({ type: 'error', data: 'Hit max tool-use hops.' });
}

// ─────────────────────────── Tool execution (shared) ───────────────────────────

async function runTool(
  name: string,
  input: any,
  ctx: ToolContext,
  onEvent: (e: AgentEvent) => void | Promise<void>,
  toolUseId: string,
): Promise<{ ok: boolean; content: string }> {
  const tool = findTool(name);
  await onEvent({ type: 'tool_use', data: { id: toolUseId, name, input } });
  if (!tool) {
    const err = `Unknown tool: ${name}`;
    await onEvent({ type: 'tool_result', data: { id: toolUseId, name, ok: false, error: err } });
    return { ok: false, content: err };
  }
  try {
    const result = await tool.handler(input, ctx);
    await onEvent({ type: 'tool_result', data: { id: toolUseId, name, ok: true, result } });
    return { ok: true, content: JSON.stringify(result) };
  } catch (err) {
    const msg = (err as Error).message ?? 'Tool error';
    logger.warn({ err, tool: name }, 'tool execution failed');
    await onEvent({ type: 'tool_result', data: { id: toolUseId, name, ok: false, error: msg } });
    return { ok: false, content: msg };
  }
}

/** Helper for status endpoint. */
export function activeProvider(): { name: Provider; model: string | null } {
  return {
    name: provider,
    model:
      provider === 'groq' ? env.GROQ_MODEL
      : provider === 'openrouter' ? env.OPENROUTER_MODEL
      : provider === 'anthropic' ? env.ASSISTANT_MODEL
      : provider === 'openai' ? normaliseOpenAIModel(env.ASSISTANT_MODEL)
      : null,
  };
}
