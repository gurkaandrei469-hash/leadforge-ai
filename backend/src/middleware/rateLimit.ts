import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import type { Request, Response, NextFunction } from 'express';
import { redis } from '../db/redis.js';
import { Errors } from '../utils/errors.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// FAIL-OPEN rate limiting
//
// Previously this middleware called `RateLimiterRedis.consume()` which throws
// EITHER when the user is over budget (legitimate 429) OR when Redis is down
// (network error). We treated both as 429 — meaning a Redis outage took down
// the entire API, which is exactly what happened when Upstash quota burned
// through and every request started returning "Too many requests".
//
// New behavior: classify the rejection.
//   • Quota exceeded → 429 (correct)
//   • Redis unreachable / errored → fail open: let the request through, log a
//     warning, and (best-effort) drop down to an in-memory bucket so we still
//     have SOME protection in the meantime. The in-memory bucket is per-pod
//     so a horizontally-scaled API still has limits, just looser.
//
// This is the right tradeoff for a B2B SaaS app — a brief loss of rate limiting
// is way better than a full outage. Real DDoS mitigation belongs at the edge.
// ─────────────────────────────────────────────────────────────────────────────

const redisLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl',
  points: env.RATE_LIMIT_MAX,
  duration: Math.floor(env.RATE_LIMIT_WINDOW_MS / 1000),
  // Critical — without this, every transient Redis error throws "noScriptError"
  // or similar and the .consume() promise rejects with no msBeforeNext. We
  // detect that in the catch below and fail open.
  inMemoryBlockOnConsumed: env.RATE_LIMIT_MAX,
  inMemoryBlockDuration: Math.floor(env.RATE_LIMIT_WINDOW_MS / 1000),
  insuranceLimiter: new RateLimiterMemory({
    points: env.RATE_LIMIT_MAX,
    duration: Math.floor(env.RATE_LIMIT_WINDOW_MS / 1000),
  }),
});

const redisLimiterHighFreq = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl-hf',
  points: env.RATE_LIMIT_MAX * 4,
  duration: Math.floor(env.RATE_LIMIT_WINDOW_MS / 1000),
  inMemoryBlockOnConsumed: env.RATE_LIMIT_MAX * 4,
  inMemoryBlockDuration: Math.floor(env.RATE_LIMIT_WINDOW_MS / 1000),
  insuranceLimiter: new RateLimiterMemory({
    points: env.RATE_LIMIT_MAX * 4,
    duration: Math.floor(env.RATE_LIMIT_WINDOW_MS / 1000),
  }),
});

// Paths that the UI shell polls on every render — they get the 4×-budget bucket.
const HIGH_FREQUENCY_PATHS = [
  '/auth/me',
  '/jobs',
  '/analytics/overview',
  '/teams',
  '/sse',
];

// Don't spam the logs when Redis is broken — one warning per minute is enough.
let lastRedisErrLogAt = 0;
function warnOnce(err: unknown) {
  const now = Date.now();
  if (now - lastRedisErrLogAt < 60_000) return;
  lastRedisErrLogAt = now;
  logger.warn({ err: (err as Error)?.message ?? String(err) }, 'rate limiter Redis unreachable — failing open');
}

export async function rateLimit(req: Request, res: Response, next: NextFunction) {
  const key = req.auth?.userId ?? req.ip ?? 'anon';
  const isHighFreq = HIGH_FREQUENCY_PATHS.some((p) => req.path.startsWith(p));
  const active = isHighFreq ? redisLimiterHighFreq : redisLimiter;

  try {
    const result = await active.consume(key);
    res.setHeader('X-RateLimit-Limit', String(active.points));
    res.setHeader('X-RateLimit-Remaining', String(result.remainingPoints));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil((Date.now() + result.msBeforeNext) / 1000)));
    return next();
  } catch (rejRes: any) {
    // A LEGITIMATE quota rejection has rejRes.msBeforeNext set + rejRes.remainingPoints == 0.
    // A REDIS ERROR rejection is usually a plain Error/AggregateError with no msBeforeNext.
    const isQuotaRejection =
      rejRes && typeof rejRes.msBeforeNext === 'number' && rejRes.remainingPoints !== undefined;

    if (!isQuotaRejection) {
      // Redis unreachable / errored — fail open. The library's insuranceLimiter
      // (in-memory) should have caught it, but in case it didn't, just let the
      // request through.
      warnOnce(rejRes);
      return next();
    }

    // Real quota exceeded
    res.setHeader('Retry-After', String(Math.ceil((rejRes.msBeforeNext ?? 1000) / 1000)));
    return next(Errors.rateLimited());
  }
}
