/**
 * Task-based model router. Classifies the user's last message and picks the best Groq model.
 * Frontend can pass `auto: true` (default) and let this decide, or override with explicit `model`.
 *
 * Routing strategy (free Groq models, all support tool use):
 *   - Reasoning-heavy ("analyze", "compare", "why", "plan", "strategy") → DeepSeek R1 Distill 70B
 *   - Long-context ("summarize this", code paste, > 3k chars)             → Mixtral 8×7B 32k
 *   - Light Q&A   ("how many", "list", "show", "what's my")              → Llama 3.1 8B Instant (fastest)
 *   - Default tool-heavy agentic                                          → Llama 3.3 70B Versatile
 */

type GroqModel =
  | 'llama-3.3-70b-versatile'
  | 'deepseek-r1-distill-llama-70b'
  | 'llama-3.1-8b-instant'
  | 'mixtral-8x7b-32768'
  | 'gemma2-9b-it';

const REASONING_RE = /\b(analyz|reason|compar|why|explain|strateg|plan a|break down|think through|critique|evaluate)/i;
const LIGHT_RE = /^(how many|list|show me|what(?:'s| is) my|do i have|give me|count|count of)\b/i;
const DRAFT_RE = /\b(write|draft|compose|email|cold email|icebreaker|outreach)/i;

export function pickModelForUserMessage(text: string): GroqModel {
  const len = text.length;
  const trimmed = text.trim();

  // Very long input → use Mixtral (32k context)
  if (len > 3000) return 'mixtral-8x7b-32768';

  // Reasoning / analysis tasks → DeepSeek R1
  if (REASONING_RE.test(trimmed)) return 'deepseek-r1-distill-llama-70b';

  // Short factual queries → fastest model
  if (LIGHT_RE.test(trimmed) && len < 80) return 'llama-3.1-8b-instant';

  // Drafting / creative → Llama 3.3 70B (still primary agent — better instruction following than 8B)
  if (DRAFT_RE.test(trimmed)) return 'llama-3.3-70b-versatile';

  // Default: best general agentic model
  return 'llama-3.3-70b-versatile';
}

export const MODEL_LABELS: Record<GroqModel, { label: string; reason: string }> = {
  'llama-3.3-70b-versatile':      { label: 'Llama 3.3 70B',           reason: 'best for agentic tool use' },
  'deepseek-r1-distill-llama-70b':{ label: 'DeepSeek R1 Distill 70B', reason: 'reasoning-heavy task' },
  'llama-3.1-8b-instant':         { label: 'Llama 3.1 8B Instant',    reason: 'fastest for light Q&A' },
  'mixtral-8x7b-32768':           { label: 'Mixtral 8×7B (32k)',      reason: 'long context' },
  'gemma2-9b-it':                 { label: 'Gemma 2 9B',              reason: 'lightweight' },
};
