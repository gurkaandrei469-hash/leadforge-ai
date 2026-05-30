// LLM-driven Named Entity Recognition.
//
// Apollo / ZoomInfo run trained BERT/spaCy NER models because they scrape
// billions of pages and the per-page cost matters. For us, a single LLM call
// per page is cheaper (Groq Llama 3.1 8B Instant: ~$0.0001/page) AND more
// accurate at structured extraction because the model can use the surrounding
// context to disambiguate (e.g. "Jordan" → person vs country vs basketball
// brand based on adjacent text).
//
// Output schema is strict — the LLM produces JSON conforming to NerResult,
// validated by Zod. Caches by content hash so repeated extractions on the
// same page are free.
//
// When/if we outgrow this: replace runLlm() with onnxruntime-node loading a
// distilled BERT-NER model. The output schema stays identical.

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { redis } from '../../db/redis.js';
import { runLlm } from '../../services/llm-router.js';
import { logger } from '../../utils/logger.js';

// ─── Output schema ──────────────────────────────────────────────────────────

const PersonSchema = z.object({
  fullName: z.string(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  linkedinUrl: z.string().nullable().optional(),
  twitterHandle: z.string().nullable().optional(),
  /** "ic" | "manager" | "director" | "vp" | "c-level" | "founder" */
  seniority: z.string().nullable().optional(),
  /** "engineering" | "sales" | "marketing" | "product" | "finance" | "ops" | "hr" | "legal" | "executive" */
  department: z.string().nullable().optional(),
});

const OrgSchema = z.object({
  name: z.string(),
  domain: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  /** "1-10" | "11-50" | "51-200" | "201-500" | "501-1000" | "1001-5000" | "5000+" */
  size: z.string().nullable().optional(),
});

const NerResultSchema = z.object({
  people: z.array(PersonSchema).default([]),
  organizations: z.array(OrgSchema).default([]),
  locations: z.array(z.object({
    name: z.string(),
    country: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
  })).default([]),
  technologies: z.array(z.string()).default([]),
  emails: z.array(z.string()).default([]),
  phones: z.array(z.string()).default([]),
  monetaryAmounts: z.array(z.object({
    amount: z.number(),
    currency: z.string().default('USD'),
    context: z.string().nullable().optional(),
  })).default([]),
});

export type NerResult = z.infer<typeof NerResultSchema>;

// ─── Prompt ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Named Entity Recognition model. Extract structured information from a web page snippet.

Return ONLY valid JSON matching this schema (no markdown, no commentary):

{
  "people": [{ "fullName": "...", "firstName": "...", "lastName": "...", "title": "...", "email": "...", "linkedinUrl": "...", "twitterHandle": "...", "seniority": "...", "department": "..." }],
  "organizations": [{ "name": "...", "domain": "...", "industry": "...", "size": "..." }],
  "locations": [{ "name": "...", "country": "...", "city": "..." }],
  "technologies": ["..."],
  "emails": ["..."],
  "phones": ["..."],
  "monetaryAmounts": [{ "amount": 1000000, "currency": "USD", "context": "Series B" }]
}

RULES
- Only extract entities ACTUALLY PRESENT in the text. Do not invent.
- "seniority" must be one of: ic, manager, director, vp, c-level, founder
- "department" must be one of: engineering, sales, marketing, product, finance, ops, hr, legal, executive
- "size" must be one of: 1-10, 11-50, 51-200, 201-500, 501-1000, 1001-5000, 5000+
- Set fields to null when missing — never to empty strings.
- For "people", fullName is required. Try to split into firstName + lastName if obvious.
- For "technologies", include only well-known products (React, AWS, Salesforce, Stripe — NOT "the cloud").
- Empty arrays are fine. Never return null for an array field.`;

// ─── Cache ──────────────────────────────────────────────────────────────────

const CACHE_TTL_SECONDS = 30 * 86400; // 30 days

function cacheKey(text: string): string {
  // First 8KB is the meaningful slice for any page — head, og tags, h1/h2,
  // intro paragraph. Hash that.
  const slice = text.slice(0, 8192);
  return 'ner:' + createHash('sha256').update(slice).digest('hex').slice(0, 32);
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export async function extractEntities(text: string): Promise<NerResult> {
  if (!text || text.trim().length < 20) return emptyResult();

  // Cache hit?
  const key = cacheKey(text);
  try {
    const cached = await redis.get(key);
    if (cached) {
      const parsed = NerResultSchema.safeParse(JSON.parse(cached));
      if (parsed.success) return parsed.data;
    }
  } catch { /* cache miss / parse fail — fall through */ }

  // Cap input — 12KB is plenty for a meaningful extraction and keeps the
  // token cost predictable. Anything past that is usually footer cruft.
  const capped = text.slice(0, 12_000);

  try {
    const raw = await runLlm({
      system: SYSTEM_PROMPT,
      user: capped,
      maxTokens: 1200,
      temperature: 0.1,
      jsonMode: true,
    });
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const parsed = NerResultSchema.safeParse(JSON.parse(cleaned));
    if (!parsed.success) {
      logger.warn({ err: parsed.error.message }, 'NER schema validation failed; returning empty');
      return emptyResult();
    }

    // Cache for 30 days
    try {
      await redis.set(key, JSON.stringify(parsed.data), 'EX', CACHE_TTL_SECONDS);
    } catch { /* non-fatal */ }

    return parsed.data;
  } catch (err) {
    logger.debug({ err: (err as Error).message }, 'NER LLM call failed; returning empty');
    return emptyResult();
  }
}

function emptyResult(): NerResult {
  return {
    people: [], organizations: [], locations: [], technologies: [],
    emails: [], phones: [], monetaryAmounts: [],
  };
}

/** Convenience — extract just people from a scraped page (drop-in next to
 *  the regex-based extractor for the orchestrator's "fancy mode"). */
export async function extractPeople(pageText: string): Promise<NerResult['people']> {
  const r = await extractEntities(pageText);
  return r.people;
}
