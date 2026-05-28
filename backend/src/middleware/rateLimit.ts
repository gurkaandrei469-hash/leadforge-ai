import { RateLimiterRedis } from 'rate-limiter-flexible';
import type { Request, Response, NextFunction } from 'express';
import { redis } from '../db/redis.js';
import { Errors } from '../utils/errors.js';
import { env } from '../config/env.js';

// 600 req/min/IP is generous enough that a dashboard with ~10 tiles, each
// firing one API call on mount AND a periodic refresh, won't trip the limit
// during normal use. The previous 100/min default was the #1 source of
// "Too many requests" toasts on the overview page.
const limiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl',
  points: env.RATE_LIMIT_MAX,
  duration: Math.floor(env.RATE_LIMIT_WINDOW_MS / 1000),
});

// Paths that are read-heavy / polled by the UI shell on every page. These get
// a wildly higher budget so dashboard polling never exhausts the user's quota
// for actual write operations (job creation, email sends).
const HIGH_FREQUENCY_PATHS = [
  '/auth/me',           // sidebar workspace, mobile shell, AssistantWidget, etc.
  '/jobs',              // /jobs page polls progress
  '/analytics/overview',// dashboard tiles
  '/teams',             // workspace switcher
  '/sse',               // server-sent events
];

const highFrequencyLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl-hf',
  points: env.RATE_LIMIT_MAX * 4,         // 4× headroom for polled endpoints
  duration: Math.floor(env.RATE_LIMIT_WINDOW_MS / 1000),
});

export async function rateLimit(req: Request, res: Response, next: NextFunction) {
  const key = req.auth?.userId ?? req.ip ?? 'anon';
  const isHighFreq = HIGH_FREQUENCY_PATHS.some((p) => req.path.startsWith(p));
  const active = isHighFreq ? highFrequencyLimiter : limiter;

  try {
    const result = await active.consume(key);
    res.setHeader('X-RateLimit-Limit', String(active.points));
    res.setHeader('X-RateLimit-Remaining', String(result.remainingPoints));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil((Date.now() + result.msBeforeNext) / 1000)));
    return next();
  } catch (rejRes: any) {
    res.setHeader('Retry-After', String(Math.ceil((rejRes?.msBeforeNext ?? 1000) / 1000)));
    return next(Errors.rateLimited());
  }
}
