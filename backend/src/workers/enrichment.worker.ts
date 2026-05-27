import { Worker, Job } from 'bullmq';
import { redis, bullConnection } from '../db/redis.js';
import { prisma } from '../db/prisma.js';
import { classifyLead } from '../services/ai.classifier.js';

export const enrichmentWorker = new Worker(
  'enrichment',
  async (job: Job<{ leadId: string; teamId: string }>) => {
    const lead = await prisma.lead.findUnique({ where: { id: job.data.leadId } });
    if (!lead) return;

    const ai = await classifyLead(lead);
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        niche: ai.niche,
        niches: ai.niches,
        qualityScore: ai.qualityScore,
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
