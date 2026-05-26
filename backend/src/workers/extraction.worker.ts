import { Worker, Job } from 'bullmq';
import { redis, redisPub } from '../db/redis.js';
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

      await prisma.extractionJob.update({
        where: { id: jobId },
        data: { status: 'COMPLETED', progress: 100, completedAt: new Date() },
      });
      await prisma.jobEvent.create({
        data: { jobId, type: 'completed', message: 'Extraction completed' },
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
    connection: redis,
    concurrency: 5,
    limiter: { max: 10, duration: 1000 },
  },
);
