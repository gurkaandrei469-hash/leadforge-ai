import { Worker, Job } from 'bullmq';
import { redis, redisPub, bullConnection } from '../db/redis.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../utils/logger.js';
import { runExtraction } from '../scraping/orchestrator.js';

export const extractionWorker = new Worker(
  'extraction',
  async (job: Job<{ jobId: string; teamId: string }>) => {
    const { jobId } = job.data;
    const dbJob = await prisma.extractionJob.findUnique({ where: { id: jobId } });
    if (!dbJob) throw new Error(`Job ${jobId} not found`);

    await prisma.extractionJob.update({
      where: { id: jobId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    await prisma.jobEvent.create({
      data: { jobId, type: 'started', message: 'Extraction started' },
    });

    try {
      await runExtraction({
        jobId,
        teamId: dbJob.teamId,
        sources: dbJob.sources,
        filters: dbJob.filters as any,
        targetLeads: dbJob.targetLeads,
        onProgress: async (p) => {
          await job.updateProgress(p.progress);
          await prisma.extractionJob.update({
            where: { id: jobId },
            data: {
              progress: p.progress,
              leadsFound: p.leadsFound,
              pagesScraped: p.pagesScraped,
              estimatedFinishAt: p.eta ?? null,
            },
          });
          await redisPub.publish(
            `job:${jobId}:progress`,
            JSON.stringify({ progress: p.progress, leadsFound: p.leadsFound, pagesScraped: p.pagesScraped }),
          );
        },
      });

      // Pull the latest leadsFound count from DB (set by onProgress during run).
      const finalState = await prisma.extractionJob.findUnique({
        where: { id: jobId },
        select: { leadsFound: true, pagesScraped: true },
      });
      const finalLeads = finalState?.leadsFound ?? 0;

      // When extraction completes with zero leads, leave a helpful message so
      // the user knows it wasn't a silent failure — and what to try next. The
      // status is still COMPLETED so the UI doesn't show it as a hard error,
      // but `errorMessage` gives the AI assistant something concrete to relay.
      const completionMessage =
        finalLeads === 0
          ? `Searched ${finalState?.pagesScraped ?? 0} pages but couldn't find any contactable leads matching your criteria. Try a broader keyword — "${dbJob.name}" may be too specific. Useful patterns: "CFO consultant" instead of "Spectrum CFO", or "B2B SaaS marketing agency" instead of a single brand name.`
          : null;

      await prisma.extractionJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          progress: 100,
          completedAt: new Date(),
          ...(completionMessage ? { errorMessage: completionMessage } : {}),
        },
      });
      await prisma.jobEvent.create({
        data: {
          jobId,
          type: 'completed',
          message:
            finalLeads === 0
              ? `Completed with 0 leads — try broader keywords`
              : `Extraction completed — ${finalLeads} leads found`,
        },
      });
    } catch (err) {
      logger.error({ err, jobId }, 'Extraction failed');
      await prisma.extractionJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', errorMessage: (err as Error).message, completedAt: new Date() },
      });
      await prisma.jobEvent.create({
        data: { jobId, type: 'failed', message: (err as Error).message },
      });
      throw err;
    }
  },
  {
    connection: bullConnection,
    concurrency: 5,
    limiter: { max: 10, duration: 1000 },
  },
);
