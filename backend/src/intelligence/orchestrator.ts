// End-to-end lead intelligence pipeline.
//
// Given a lead ID, this orchestrator runs every applicable enrichment +
// scoring step in parallel and writes the consolidated result back to the
// database. It's idempotent — running it twice on the same lead refreshes
// the data instead of duplicating it.
//
//                lead ──────────┐
//                               ▼
//      ┌── company enrichment (firmographics, tech stack)
//      ├── intent signal detection (funding, hiring, exec moves)
//      └── identity resolution (any duplicate already in workspace?)
//                               │
//                               ▼
//                      LLM lead scoring
//                               │
//                               ▼
//                    DB write (score, status, signals)

import type { Lead } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { logger } from '../utils/logger.js';
import { enrichCompany, type CompanyFirmographics } from './enrichment/company.js';
import { detectIntentSignals, intentScore, type IntentSignal } from './intent/signals.js';
import { resolveLead } from './matching/resolver.js';
import { upsertCompanyNode, linkLeadToCompany } from './graph/builder.js';
import { ensembleScore } from './scoring/ensemble.js';

export interface IntelligenceResult {
  leadId: string;
  firmographics?: CompanyFirmographics;
  intentSignals: IntentSignal[];
  intentScore: number;
  leadScore: number;
  leadTier: 'A' | 'B' | 'C' | 'D';
  reasons: string[];
  redFlags: string[];
  duplicateOfLeadId?: string;
}

export async function runIntelligence(leadId: string, opts?: { icpDescription?: string }): Promise<IntelligenceResult> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  // Run enrichment + intent + dedup in parallel — none depend on each other
  const [firmoSettled, intentSettled, dedupSettled] = await Promise.allSettled([
    lead.companyDomain ? enrichCompany(lead.companyDomain) : Promise.resolve(undefined),
    lead.companyName ? detectIntentSignals(lead.companyName) : Promise.resolve([]),
    resolveLead(lead.teamId, lead),
  ]);

  const firmographics = settle(firmoSettled);
  const intentSignals: IntentSignal[] = settle(intentSettled) ?? [];
  const dedup = settle(dedupSettled);
  // Don't flag the lead as a duplicate of itself
  const duplicateOfLeadId = dedup?.match && dedup.match.id !== lead.id ? dedup.match.id : undefined;

  // Build/upsert the knowledge-graph Company node from the firmographics +
  // intent signals. Captures the graph relationships so future "find me
  // CFOs at companies that use Stripe AND raised in the last 90 days"
  // queries work without re-fetching.
  let graphCompany: Awaited<ReturnType<typeof prisma.company.findUnique>> | null = null;
  if (firmographics) {
    try {
      const upsert = await upsertCompanyNode(firmographics, intentSignals);
      await linkLeadToCompany(lead.id, upsert.companyId);
      graphCompany = await prisma.company.findUnique({
        where: { id: upsert.companyId },
        include: {
          fundingEvents: { orderBy: { announcedOn: 'desc' }, take: 5 },
          executiveMoves: { orderBy: { announcedOn: 'desc' }, take: 5 },
          technologies: true,
        },
      });
    } catch (err) {
      logger.warn({ leadId, err: (err as Error).message }, 'graph upsert failed');
    }
  }

  // Ensemble scoring — combines heuristic (fast, deterministic) + LLM
  // (narrative, ICP-aware). Future swap: replace the heuristic with an
  // ONNX-loaded XGBoost trained on LeadScoreFeedback labels.
  const verification = await prisma.emailVerification.findUnique({ where: { leadId: lead.id } });
  const scoreResult = await ensembleScore({
    lead,
    company: graphCompany as any,
    verification,
    icpDescription: opts?.icpDescription,
  });

  const { score: intentScoreValue } = intentScore(intentSignals);

  // Persist the consolidated result back to the lead row.
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      // qualityScore is the LLM-grounded composite score
      qualityScore: scoreResult.score,
      // Stash intent score in an existing column we already have
      intentScore: intentScoreValue,
      // Industry / company size if we learned them
      ...(firmographics?.industry ? { companyIndustry: firmographics.industry } : {}),
      ...(firmographics?.employeeRange ? { companySize: firmographics.employeeRange } : {}),
      // Country if missing
      ...(!lead.country && firmographics?.headquartersCountry
        ? { country: firmographics.headquartersCountry } : {}),
      // Merge any newly-discovered technologies
      ...(firmographics?.technologies && firmographics.technologies.length
        ? { technologies: [...new Set([...lead.technologies, ...firmographics.technologies])] } : {}),
    },
  });

  logger.debug({ leadId, score: scoreResult.score, tier: scoreResult.status }, 'lead enriched + scored');

  return {
    leadId,
    firmographics,
    intentSignals,
    intentScore: intentScoreValue,
    leadScore: scoreResult.score,
    leadTier: scoreResult.status,
    reasons: scoreResult.reasons,
    redFlags: scoreResult.redFlags,
    duplicateOfLeadId,
  };
}

function settle<T>(s: PromiseSettledResult<T>): T | undefined {
  return s.status === 'fulfilled' ? s.value : undefined;
}
