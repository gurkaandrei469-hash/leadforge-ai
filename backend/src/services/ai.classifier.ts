import OpenAI from 'openai';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const client = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

interface ClassifyResult {
  niche: string | null;
  niches: string[];
  qualityScore: number;
  relevanceScore: number;
  intentScore: number;
  authorityScore: number;
  tags: string[];
  summary: string | null;
}

const FALLBACK: ClassifyResult = {
  niche: null, niches: [], qualityScore: 50, relevanceScore: 50, intentScore: 50, authorityScore: 50, tags: [], summary: null,
};

export async function classifyLead(lead: any): Promise<ClassifyResult> {
  if (!client) return heuristic(lead);

  try {
    const prompt = `Classify this B2B lead. Respond in JSON.
Lead: ${JSON.stringify({
  email: lead.email, jobTitle: lead.jobTitle, companyName: lead.companyName,
  companyDomain: lead.companyDomain, sourcePageTitle: lead.sourcePageTitle,
})}
Schema: { niche: string, niches: string[], qualityScore: 0-100, relevanceScore: 0-100, intentScore: 0-100, authorityScore: 0-100, tags: string[], summary: string }`;

    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    });
    const parsed = JSON.parse(resp.choices[0].message.content ?? '{}');
    return { ...FALLBACK, ...parsed };
  } catch (err) {
    logger.warn({ err }, 'AI classification failed; using heuristic');
    return heuristic(lead);
  }
}

function heuristic(lead: any): ClassifyResult {
  const isExec = /ceo|founder|cto|cmo|vp|head/i.test(lead.jobTitle ?? '');
  const hasEmail = !!lead.email;
  return {
    niche: lead.companyIndustry ?? null,
    niches: lead.companyIndustry ? [lead.companyIndustry] : [],
    qualityScore: 40 + (isExec ? 25 : 0) + (hasEmail ? 20 : 0),
    relevanceScore: 50,
    intentScore: 40,
    authorityScore: isExec ? 75 : 45,
    tags: isExec ? ['decision-maker'] : [],
    summary: null,
  };
}
