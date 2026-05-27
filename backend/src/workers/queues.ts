import { Queue, QueueEvents } from 'bullmq';
import { bullConnection } from '../db/redis.js';

// Pass connection OPTIONS (not an existing ioredis instance) so BullMQ creates
// a dedicated connection per Queue/Worker. Sharing one instance with workers
// caused starvation on Upstash — see db/redis.ts for the long story.
const connection = bullConnection;

export const extractionQueue = new Queue('extraction', { connection });
export const verificationQueue = new Queue('verification', { connection });
export const enrichmentQueue = new Queue('enrichment', { connection });
export const exportQueue = new Queue('export', { connection });
export const webhookQueue = new Queue('webhook', { connection });
export const campaignQueue = new Queue('campaign', { connection });

export const extractionEvents = new QueueEvents('extraction', { connection });
export const verificationEvents = new QueueEvents('verification', { connection });

export const queues = {
  extraction: extractionQueue,
  verification: verificationQueue,
  enrichment: enrichmentQueue,
  export: exportQueue,
  webhook: webhookQueue,
  campaign: campaignQueue,
};
