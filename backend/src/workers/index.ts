import { extractionWorker } from './extraction.worker.js';
import { verificationWorker } from './verification.worker.js';
import { enrichmentWorker } from './enrichment.worker.js';
import { exportWorker } from './export.worker.js';
import { webhookWorker } from './webhook.worker.js';
import { campaignWorker } from './campaign.worker.js';
import { imapPollWorker, bootstrapImapPolls } from './imap-poll.worker.js';
import { logger } from '../utils/logger.js';

const workers = [
  { name: 'extraction', w: extractionWorker },
  { name: 'verification', w: verificationWorker },
  { name: 'enrichment', w: enrichmentWorker },
  { name: 'export', w: exportWorker },
  { name: 'webhook', w: webhookWorker },
  { name: 'campaign', w: campaignWorker },
  { name: 'imap-poll', w: imapPollWorker },
];

workers.forEach(({ name, w }) => {
  w.on('completed', (j) => logger.info({ name, jobId: j.id }, 'job completed'));
  w.on('failed', (j, err) => logger.error({ name, jobId: j?.id, err: err.message }, 'job failed'));
});

const shutdown = async () => {
  logger.info('Shutting down workers');
  await Promise.all(workers.map(({ w }) => w.close()));
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

logger.info('Workers started');

// Seed IMAP polls for every account that has imapEnabled = true
bootstrapImapPolls().catch((err) => logger.error({ err: err.message }, 'imap bootstrap failed'));
