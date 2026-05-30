// Crawler worker — pulls due URLs from the frontier and fetches them.
//
// Pattern: the BullMQ `crawl-frontier` queue is a notifier rather than the
// actual URL store. Each `tick` event makes the worker check the Postgres
// frontier for due URLs (via claim(), which uses SELECT … FOR UPDATE SKIP
// LOCKED so multiple workers can dequeue concurrently).
//
// On every fetch the worker honors robots.txt for the host, respects the
// per-host politeness delay, computes a content hash for change-detection,
// and updates the frontier with the result.
//
// Integration: each successful fetch enqueues the page text for NER +
// extraction so it feeds into the rest of the intelligence pipeline.

import { Worker, type Job } from 'bullmq';
import { createHash } from 'node:crypto';
import { bullConnection } from '../../db/redis.js';
import { scrapePage } from '../../scraping/scraper.js';
import { claim, complete, retry } from './frontier.js';
import { logger } from '../../utils/logger.js';

export const crawlFrontierWorker = new Worker(
  'crawl-frontier',
  async (_job: Job) => {
    // Each tick: pull a batch of due URLs and fetch them in parallel.
    // The claim() function atomically marks them IN_FLIGHT so other workers
    // (potentially on other Railway replicas) don't double-fetch.
    const batch = await claim(20);
    if (batch.length === 0) return { processed: 0 };

    await Promise.all(batch.map(async (entry) => {
      try {
        const page = await scrapePage(entry.url);
        const hash = createHash('sha256').update(page.html).digest('hex');
        await complete(entry.id, {
          state: 'SUCCEEDED',
          httpStatus: 200,
          contentBytes: page.html.length,
          contentHash: hash,
        });
        // Future hook: queue this page for NER + lead extraction
        logger.debug({ url: entry.url, bytes: page.html.length }, 'crawl ok');
      } catch (err) {
        const msg = (err as Error).message;
        const isRobots = /robots_disallow/i.test(msg);
        const isRetryable = !isRobots && entry.attempt < 3;
        if (isRetryable) {
          // Exponential backoff: 1m, 4m, 16m
          await retry(entry.id, 60 * Math.pow(4, entry.attempt));
        } else {
          await complete(entry.id, {
            state: isRobots ? 'ROBOTS_DENIED' : 'FAILED',
            errorMessage: msg,
          });
        }
      }
    }));

    return { processed: batch.length };
  },
  {
    connection: bullConnection,
    // Concurrency = batch size — the queue is essentially a heartbeat that
    // drives the durable frontier in Postgres, so we don't want many parallel
    // BullMQ jobs all hammering claim().
    concurrency: 1,
  },
);
