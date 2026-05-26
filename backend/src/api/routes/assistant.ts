import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { runAgent, activeProvider, type ChatMessage } from '../../services/assistant.js';

// Per-provider free model catalog — each entry confirmed to support tool/function calling.
const MODEL_CATALOG: Record<string, Array<{ id: string; family: string; label: string; tag?: string }>> = {
  groq: [
    { id: 'llama-3.3-70b-versatile',        family: 'Llama',    label: 'Llama 3.3 70B',           tag: 'agent ⭐' },
    { id: 'deepseek-r1-distill-llama-70b',  family: 'DeepSeek', label: 'DeepSeek R1 Distill 70B', tag: 'reasoning' },
    { id: 'llama-3.1-8b-instant',           family: 'Llama',    label: 'Llama 3.1 8B Instant',    tag: 'fastest' },
    { id: 'mixtral-8x7b-32768',             family: 'Mixtral',  label: 'Mixtral 8×7B (32k ctx)' },
    { id: 'gemma2-9b-it',                   family: 'Gemma',    label: 'Gemma 2 9B' },
    { id: 'llama-3.1-70b-versatile',        family: 'Llama',    label: 'Llama 3.1 70B' },
  ],
  openrouter: [
    { id: 'google/gemma-4-26b-a4b-it:free',                family: 'Gemma',   label: 'Gemma 4 26B (a4b)' },
    { id: 'google/gemma-4-31b-it:free',                    family: 'Gemma',   label: 'Gemma 4 31B' },
    { id: 'deepseek/deepseek-v4-flash:free',               family: 'DeepSeek',label: 'DeepSeek V4 Flash' },
    { id: 'qwen/qwen3-next-80b-a3b-instruct:free',         family: 'Qwen',    label: 'Qwen 3 Next 80B' },
    { id: 'qwen/qwen3-coder:free',                         family: 'Qwen',    label: 'Qwen 3 Coder' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free',        family: 'Llama',   label: 'Llama 3.3 70B' },
    { id: 'mistralai/mistral-small-3.1-24b-instruct:free', family: 'Mistral', label: 'Mistral Small 3.1' },
    { id: 'z-ai/glm-4.5-air:free',                         family: 'GLM',     label: 'GLM 4.5 Air' },
  ],
  openai:    [{ id: 'gpt-4o-mini', family: 'OpenAI', label: 'GPT-4o mini' }, { id: 'gpt-4o', family: 'OpenAI', label: 'GPT-4o' }],
  anthropic: [{ id: 'claude-sonnet-4-5', family: 'Claude', label: 'Sonnet 4.5' }, { id: 'claude-haiku-4-5', family: 'Claude', label: 'Haiku 4.5' }],
  mock:      [],
};

const r = Router();

r.get('/status', authenticate, (_req, res) => {
  res.json({ provider: activeProvider() });
});

const MessageSchema: z.ZodType<ChatMessage> = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string(), z.array(z.any())]),
}) as any;

const ChatBody = z.object({
  messages: z.array(MessageSchema).min(1).max(40),
  model: z.string().optional(),
});

// Returns the active provider's curated free model catalog.
// Frontend renders these in the model dropdown.
r.get('/models', authenticate, (_req, res) => {
  const { name: providerName } = activeProvider();
  res.json({
    provider: providerName,
    models: MODEL_CATALOG[providerName] ?? [],
  });
});

// SSE streaming endpoint. Body is sent via POST → events stream back via SSE.
r.post('/chat', authenticate, async (req, res, next) => {
  try {
    const { messages, model } = ChatBody.parse(req.body);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (e: { type: string; data: unknown }) => {
      res.write(`data: ${JSON.stringify(e)}\n\n`);
    };

    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);

    try {
      await runAgent(messages, req.auth!, send, { model });
    } finally {
      clearInterval(ping);
      res.end();
    }
  } catch (e) {
    next(e);
  }
});

export default r;
