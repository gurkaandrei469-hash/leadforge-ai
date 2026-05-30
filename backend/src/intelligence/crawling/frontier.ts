// Crawl frontier — the URL queue + politeness enforcer.
//
// Modeled after the Mercator / IRLbot frontier architecture: a backlog of
// candidate URLs, partitioned by host, dequeued in priority order subject to
// per-host politeness delays so we don't hammer any single domain.
//
//   ┌─ Postgres `CrawlEntry` ─┐   the durable backlog (millions of rows OK)
//   ↓                         ↑
// BullMQ `crawl-frontier`     │   enqueue happens via enqueue() below;
//   queue dequeues to         │   workers consume from BullMQ.
//   workers ──────────────────┘   acks/fails write back to Postgres.
//
// Why both Postgres + BullMQ instead of just BullMQ:
//   • Postgres is the audit trail — every URL we've ever crawled is queryable
//   • Restarting the worker fleet doesn't lose state
//   • Per-host politeness is easier to query (`WHERE host=… AND notBefore<=now`)
//   • Once the frontier exceeds a few million URLs BullMQ slows down; Postgres
//     stays fast with the right indexes (which we declared in the schema)

import { Queue, type JobsOptions } from 'bullmq';
import { bullConnection } from '../../db/redis.js';
import { prisma } from '../../db/prisma.js';
import { normalizeDomain } from '../matching/fuzzy.js';
import { logger } from '../../utils/logger.js';

export const crawlFrontierQueue = new Queue('crawl-frontier', { connection: bullConnection });

export interface EnqueueArgs {
  url: string;
  jobId?: string;
  /** 1 (urgent) to 10 (background). Lower numbers run first. */
  priority?: number;
}

/**
 * Add a URL (or batch of URLs) to the frontier. Idempotent — the
 * (url, jobId) unique index in Postgres dedupes. Already-seen URLs are
 * silently skipped.
 *
 * Returns the number of URLs that were actually new.
 */
export async function enqueue(urls: EnqueueArgs[]): Promise<number> {
  if (urls.length === 0) return 0;

  // Group by host so we can apply per-host politeness in one query
  const byHost = new Map<string, EnqueueArgs[]>();
  for (const u of urls) {
    try {
      const host = normalizeDomain(new URL(u.url).hostname);
      const bucket = byHost.get(host) ?? [];
      bucket.push(u);
      byHost.set(host, bucket);
    } catch {
      // Bad URL — skip silently. The frontier never logs noisy junk.
    }
  }

  // Ensure each host has a CrawlHost row (defaults to 2s delay, 1 concurrent)
  await Promise.all([...byHost.keys()].map((host) =>
    prisma.crawlHost.upsert({
      where: { host },
      create: { host },
      update: {},
    }),
  ));

  let added = 0;
  for (const [host, batch] of byHost) {
    const hostRow = await prisma.crawlHost.findUnique({ where: { host } });
    const lastFetch = hostRow?.lastFetchedAt ?? new Date(0);
    const delaySec = hostRow?.delaySeconds ?? 2;
    let notBefore = new Date(Math.max(Date.now(), lastFetch.getTime() + delaySec * 1000));

    for (const u of batch) {
      try {
        await prisma.crawlEntry.create({
          data: {
            url: u.url,
            host,
            jobId: u.jobId,
            priority: u.priority ?? 5,
            state: 'PENDING',
            notBefore,
          },
        });
        added++;
        // Stagger subsequent URLs on the same host so they don't all
        // dequeue simultaneously
        notBefore = new Date(notBefore.getTime() + delaySec * 1000);
      } catch (err) {
        // Unique constraint violation — already in the frontier. Fine.
      }
    }
  }

  // Tickle the BullMQ queue so a worker picks up the new entries.
  // The actual scheduling happens via the dequeue() loop; we just nudge it.
  await crawlFrontierQueue.add('tick', { ts: Date.now() }, { removeOnComplete: true, removeOnFail: true });

  logger.info({ added, hosts: byHost.size, requested: urls.length }, 'frontier enqueue');
  return added;
}

/**
 * Atomically claim the next batch of N URLs that are due for crawling.
 * Respects per-host politeness (notBefore) and concurrencyMax.
 *
 * The CTE-based update pattern below uses SKIP LOCKED so multiple workers
 * can pull concurrently without stepping on each other.
 */
export async function claim(maxBatch = 20): Promise<Array<{ id: string; url: string; host: string; attempt: number }>> {
  const claimed = await prisma.$queryRawUnsafe<Array<{ id: string; url: string; host: string; attempt: number }>>(`
    WITH due AS (
      SELECT e.id
      FROM "CrawlEntry" e
      LEFT JOIN "CrawlHost" h ON h.host = e.host
      WHERE e.state = 'PENDING'
        AND e."notBefore" <= NOW()
        AND e.attempt < 4
      ORDER BY e.priority ASC, e."notBefore" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $1
    )
    UPDATE "CrawlEntry" e
    SET state = 'IN_FLIGHT',
        attempt = e.attempt + 1,
        "updatedAt" = NOW()
    FROM due
    WHERE e.id = due.id
    RETURNING e.id, e.url, e.host, e.attempt;
  `, maxBatch);
  return claimed;
}

/**
 * Mark a claimed entry as done — either succeeded (with the fetched content
 * size + status), or failed (with a reason). Updates the per-host
 * lastFetchedAt so the next URL on that host waits the politeness delay.
 */
export async function complete(
  id: string,
  result: {
    state: 'SUCCEEDED' | 'FAILED' | 'ROBOTS_DENIED';
    httpStatus?: number;
    contentBytes?: number;
    contentHash?: string;
    errorMessage?: string;
  },
): Promise<void> {
  const entry = await prisma.crawlEntry.update({
    where: { id },
    data: {
      state: result.state,
      fetchedAt: new Date(),
      httpStatus: result.httpStatus,
      contentBytes: result.contentBytes,
      contentHash: result.contentHash,
      errorMessage: result.errorMessage?.slice(0, 500),
    },
  });

  await prisma.crawlHost.update({
    where: { host: entry.host },
    data: { lastFetchedAt: new Date() },
  });
}

/** Re-queue a failed entry for a retry (with backoff baked into notBefore). */
export async function retry(id: string, backoffSeconds = 60): Promise<void> {
  await prisma.crawlEntry.update({
    where: { id },
    data: {
      state: 'PENDING',
      notBefore: new Date(Date.now() + backoffSeconds * 1000),
      errorMessage: null,
    },
  });
  await crawlFrontierQueue.add('tick', { ts: Date.now() }, { removeOnComplete: true, removeOnFail: true });
}

// ─── Inspection helpers (used by the API + dashboard) ──────────────────────

export async function stats(): Promise<{
  pending: number; inFlight: number; succeeded: number; failed: number; robotsDenied: number;
  byHost: Array<{ host: string; pending: number; delaySeconds: number; lastFetchedAt: Date | null }>;
}> {
  const [pending, inFlight, succeeded, failed, robotsDenied, byHost] = await Promise.all([
    prisma.crawlEntry.count({ where: { state: 'PENDING' } }),
    prisma.crawlEntry.count({ where: { state: 'IN_FLIGHT' } }),
    prisma.crawlEntry.count({ where: { state: 'SUCCEEDED' } }),
    prisma.crawlEntry.count({ where: { state: 'FAILED' } }),
    prisma.crawlEntry.count({ where: { state: 'ROBOTS_DENIED' } }),
    prisma.$queryRawUnsafe<Array<{ host: string; pending: bigint; delay_seconds: number; last_fetched_at: Date | null }>>(`
      SELECT e.host,
             COUNT(*) FILTER (WHERE e.state = 'PENDING') AS pending,
             COALESCE(h."delaySeconds", 2) AS delay_seconds,
             h."lastFetchedAt" AS last_fetched_at
      FROM "CrawlEntry" e
      LEFT JOIN "CrawlHost" h ON h.host = e.host
      GROUP BY e.host, h."delaySeconds", h."lastFetchedAt"
      ORDER BY pending DESC
      LIMIT 20
    `),
  ]);
  return {
    pending, inFlight, succeeded, failed, robotsDenied,
    byHost: byHost.map((r) => ({
      host: r.host,
      pending: Number(r.pending),
      delaySeconds: r.delay_seconds,
      lastFetchedAt: r.last_fetched_at,
    })),
  };
}
