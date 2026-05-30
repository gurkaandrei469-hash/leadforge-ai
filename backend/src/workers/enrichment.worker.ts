import { Worker, Job } from 'bullmq';
import { bullConnection } from '../db/redis.js';
import { prisma } from '../db/prisma.js';
import { classifyLead } from '../services/ai.classifier.js';
import { runIntelligence } from '../intelligence/orchestrator.js';
import { logger } from '../utils/logger.js';

export const enrichmentWorker = new Worker(
  'enrichment',
  async (job: Job<{ leadId: string; teamId: string; mode?: 'classify' | 'full' }>) => {
    const lead = await prisma.lead.findUnique({ where: { id: job.data.leadId } });
    if (!lead) return;

    // Mode 'full' runs the new intelligence pipeline (firmographics + intent +
    // LLM scoring + dedup). Default to the lighter classify-only path so
    // existing extraction jobs don't suddenly start burning 5x the LLM tokens.
    if (job.data.mode === 'full') {
      try {
        await runIntelligence(lead.id);
      } catch (err) {
        logger.warn({ leadId: lead.id, err: (err as Error).message }, 'intelligence pipeline failed; falling back to classify-only');
      }
    }

    const ai = await classifyLead(lead);
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        niche: ai.niche,
        niches: ai.niches,
        // Don't clobber qualityScore if the intelligence pipeline already set it
        ...(job.data.mode !== 'full' ? { qualityScore: ai.qualityScore } : {}),
        relevanceScore: ai.relevanceScore,
        intentScore: ai.intentScore,
        authorityScore: ai.authorityScore,
        aiTags: ai.tags,
        aiSummary: ai.summary,
        status: 'ENRICHED',
      },
    });
  },
  { connection: bullConnection, concurrency: 5 },
);
