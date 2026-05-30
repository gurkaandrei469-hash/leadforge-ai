// Buying-intent signal detection.
//
// Modern outbound is driven by trigger events — funding rounds, executive
// hires, hiring sprees, new product launches, tech-stack changes. These tell
// us a company is in motion and likely budgeting for new tools/services.
//
// We detect these via targeted web searches over the company's name +
// timeframe filters, then NLP-classify the snippets with a small LLM.

import { ddgSearch } from '../../scraping/searchEngines.js';
import { logger } from '../../utils/logger.js';

export type IntentSignalKind =
  | 'FUNDING'           // raised round, IPO, acquisition
  | 'HIRING'            // job posts, head-count growth
  | 'EXEC_CHANGE'       // new CEO/CTO/CFO/VP
  | 'PRODUCT_LAUNCH'    // new product or major release
  | 'TECH_ADOPTION'     // adopted a new tool (CRM, infra, etc.)
  | 'EXPANSION';        // new office, region, market entry

export interface IntentSignal {
  kind: IntentSignalKind;
  headline: string;
  url: string;
  detectedAt: Date;
  /** 0..1 — how confidently we matched this snippet to the signal kind */
  confidence: number;
}

const QUERY_TEMPLATES: Array<[IntentSignalKind, string, number]> = [
  ['FUNDING',        '"{name}" raised funding 2026', 30],
  ['FUNDING',        '"{name}" series A OR B OR C', 28],
  ['FUNDING',        '"{name}" acquired by 2026', 25],
  ['HIRING',         '"{name}" hiring engineers OR sales 2026', 20],
  ['HIRING',         '"{name}" "we\'re hiring" 2026', 18],
  ['EXEC_CHANGE',    '"{name}" "appointed CEO" OR "named CTO" 2026', 25],
  ['EXEC_CHANGE',    '"{name}" "joins as CFO" OR "new chief" 2026', 22],
  ['PRODUCT_LAUNCH', '"{name}" "announces" OR "launches" 2026', 15],
  ['TECH_ADOPTION',  '"{name}" "now using" OR "migrated to" 2026', 12],
  ['EXPANSION',      '"{name}" "expands to" OR "new office" 2026', 12],
];

const PATTERNS_BY_KIND: Record<IntentSignalKind, RegExp[]> = {
  FUNDING:        [/raised|secured|closed|series\s+[a-z]|valuation|acquired|ipo/i],
  HIRING:         [/hiring|hire|we'?re hiring|job\s+open|growing the team/i],
  EXEC_CHANGE:    [/appoint|named|join(s|ed)? as|new\s+(?:ceo|cto|cfo|coo|vp|president)/i],
  PRODUCT_LAUNCH: [/announce|launch|unveil|introduce|release/i],
  TECH_ADOPTION:  [/now using|migrated|switched to|adopt|standardized on/i],
  EXPANSION:      [/expand|open(?:s|ed)?\s+(?:new\s+)?office|enter(?:s|ed) the/i],
};

export async function detectIntentSignals(companyName: string): Promise<IntentSignal[]> {
  if (!companyName || companyName.length < 2) return [];

  const allHits: IntentSignal[] = [];
  // Concurrent queries — Serper handles this fine.
  await Promise.all(
    QUERY_TEMPLATES.map(async ([kind, template, _weight]) => {
      const q = template.replace('{name}', companyName);
      try {
        const results = await ddgSearch(q, 5);
        for (const r of results) {
          const hay = `${r.title} ${r.snippet}`;
          const patterns = PATTERNS_BY_KIND[kind];
          let hits = 0;
          for (const p of patterns) if (p.test(hay)) hits++;
          if (hits === 0) continue;
          allHits.push({
            kind,
            headline: r.title.slice(0, 200),
            url: r.url,
            detectedAt: new Date(),
            confidence: Math.min(1, 0.5 + 0.25 * hits),
          });
        }
      } catch (err) {
        logger.debug({ kind, q, err: (err as Error).message }, 'intent search failed');
      }
    }),
  );

  // De-dupe by URL — pick the highest-confidence kind per URL
  const byUrl = new Map<string, IntentSignal>();
  for (const sig of allHits) {
    const prev = byUrl.get(sig.url);
    if (!prev || prev.confidence < sig.confidence) byUrl.set(sig.url, sig);
  }
  return [...byUrl.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 15);
}

/** Combine intent signals into a single 0-100 intent score. Funding + exec
 *  hires carry the most weight; product launches are softer. */
export function intentScore(signals: IntentSignal[]): { score: number; topKinds: IntentSignalKind[] } {
  const weights: Record<IntentSignalKind, number> = {
    FUNDING: 30, EXEC_CHANGE: 25, HIRING: 20, PRODUCT_LAUNCH: 15, TECH_ADOPTION: 12, EXPANSION: 10,
  };
  const present = new Map<IntentSignalKind, number>();
  for (const s of signals) {
    const w = weights[s.kind] * s.confidence;
    present.set(s.kind, Math.max(present.get(s.kind) ?? 0, w));
  }
  const raw = [...present.values()].reduce((a, b) => a + b, 0);
  return {
    score: Math.min(100, Math.round(raw)),
    topKinds: [...present.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([k]) => k),
  };
}
