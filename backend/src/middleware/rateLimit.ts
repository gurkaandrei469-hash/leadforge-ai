import { RateLimiterRedis } from 'rate-limiter-flexible';
import type { Request, Response, NextFunction } from 'express';
import { redis } from '../db/redis.js';
import { Errors } from '../utils/errors.js';
import { env } from '../config/env.js';

const limiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl',
  points: env.RATE_LIMIT_MAX,
  duration: Math.floor(env.RATE_LIMIT_WINDOW_MS / 1000),
});

export async function rateLimit(req: Request, res: Response, next: NextFunction) {
  const key = req.auth?.userId ?? req.ip ?? 'anon';
  try {
    const result = await limiter.consume(key);
    res.setHeader('X-RateLimit-Limit', env.RATE_LIMIT_MAX);
    res.setHeader('X-RateLimit-Remaining', result.remainingPoints);
    res.setHeader('X-RateLimit-Reset', Math.ceil((Date.now() + result.msBeforeNext) / 1000));
    return next();
  } catch (rejRes: any) {
    res.setHeader('Retry-After', Math.ceil((rejRes?.msBeforeNext ?? 1000) / 1000));
    return next(Errors.rateLimited());
  }
}
