import { Worker, Job } from 'bullmq';
import axios from 'axios';
import crypto from 'node:crypto';
import { redis } from '../db/redis.js';
import { prisma } from '../db/prisma.js';

export const webhookWorker = new Worker(
  'webhook',
  async (job: Job<{ teamId: string; event: string; payload: any }>) => {
    const hooks = await prisma.webhook.findMany({
      where: { teamId: job.data.teamId, isActive: true, events: { has: job.data.event } },
    });

    for (const hook of hooks) {
      const body = JSON.stringify({ event: job.data.event, data: job.data.payload, at: new Date().toISOString() });
      const sig = crypto.createHmac('sha256', hook.secret).update(body).digest('hex');
      try {
        await axios.post(hook.url, body, {
          headers: { 'Content-Type': 'application/json', 'X-LeadForge-Signature': sig },
          timeout: 5000,
        });
        await prisma.webhook.update({ where: { id: hook.id }, data: { lastTriggeredAt: new Date(), failureCount: 0 } });
      } catch {
        await prisma.webhook.update({ where: { id: hook.id }, data: { failureCount: { increment: 1 } } });
      }
    }
  },
  { connection: redis, concurrency: 10 },
);
