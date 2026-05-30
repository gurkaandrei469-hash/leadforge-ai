// Lightweight single-shot LLM caller (no streaming, no tool use, no agent loop).
//
// Different from src/services/assistant.ts which is the conversational
// tool-using agent. This is for internal pipelines that just need "given this
// prompt, give me back a string" — lead scoring, intent classification, etc.
//
// Provider chain mirrors the agent: Groq → OpenRouter → Anthropic → OpenAI →
// throw. Each provider is tried until one succeeds; failures are silent
// (caller decides what to do with the throw at the end).

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

interface LlmRequest {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** When true, the prompt is expected to return JSON — providers that
   *  support a JSON-response mode get told to use it. */
  jsonMode?: boolean;
}

const groq = env.GROQ_API_KEY
  ? new OpenAI({ apiKey: env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
  : null;
const openrouter = env.OPENROUTER_API_KEY
  ? new OpenAI({ apiKey: env.OPENROUTER_API_KEY, baseURL: 'https://openrouter.ai/api/v1' })
  : null;
const openai = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;
const anthropic = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;

export async function runLlm(req: LlmRequest): Promise<string> {
  const attempts: Array<() => Promise<string>> = [];

  if (groq) attempts.push(() => callOpenAICompat(groq, 'llama-3.3-70b-versatile', req, 'groq'));
  if (openrouter) attempts.push(() => callOpenAICompat(openrouter, env.OPENROUTER_MODEL ?? 'google/gemma-4-26b-a4b-it:free', req, 'openrouter'));
  if (anthropic) attempts.push(() => callAnthropic(anthropic, req));
  if (openai) attempts.push(() => callOpenAICompat(openai, 'gpt-4o-mini', req, 'openai'));

  if (attempts.length === 0) {
    throw new Error('No LLM provider configured (need GROQ_API_KEY, OPENROUTER_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY)');
  }

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (err) {
      lastError = err;
      logger.debug({ err: (err as Error).message }, 'LLM provider failed, trying next');
    }
  }
  throw lastError;
}

async function callOpenAICompat(
  client: OpenAI,
  model: string,
  req: LlmRequest,
  providerName: string,
): Promise<string> {
  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
    max_tokens: req.maxTokens ?? 600,
    temperature: req.temperature ?? 0.2,
    ...(req.jsonMode && providerName !== 'openrouter' ? { response_format: { type: 'json_object' as const } } : {}),
  });
  const text = res.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${providerName} returned empty content`);
  return text;
}

async function callAnthropic(client: Anthropic, req: LlmRequest): Promise<string> {
  const res = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: req.maxTokens ?? 600,
    temperature: req.temperature ?? 0.2,
    system: req.system,
    messages: [{ role: 'user', content: req.user }],
  });
  const block = res.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('Anthropic returned no text block');
  return block.text;
}
