import IORedis, { type RedisOptions } from 'ioredis';
import { env } from '../config/env.js';

/**
 * BullMQ connection options. Each Worker and Queue gets a FRESH ioredis
 * instance built from these options — sharing a single instance across
 * workers caused queue starvation on Upstash (which times out blocking
 * commands every 5s, breaking BullMQ's BRPOPLPUSH wait-for-job loop when
 * multiple workers contend for the same connection).
 *
 * Usage:
 *   import { bullConnection, makeRedis } from '../db/redis.js';
 *   new Worker('extraction', handler, { connection: bullConnection });
 *
 * BullMQ also accepts the plain options object directly; when we do that
 * BullMQ internally creates its own connection per Worker/Queue.
 */
export const bullConnection: RedisOptions = {
  ...parseRedisUrl(env.REDIS_URL),
  maxRetriesPerRequest: null,   // required by BullMQ — it handles retries itself
  enableReadyCheck: false,      // skip INFO REPLICATION on Upstash
  // Reconnect quickly when Upstash drops idle blocking connections.
  retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
};

// Shared singleton for non-BullMQ usage (rate limiter, pub/sub).
// maxRetriesPerRequest: 0  →  fail immediately if no connection instead of
// hanging forever. The rate limiter middleware already has fail-open logic
// so a fast Redis error is much better than a 30-second request timeout.
const SHARED_OPTS: RedisOptions = {
  maxRetriesPerRequest: 0,
  enableReadyCheck: false,
  connectTimeout: 5000,       // give up connecting after 5s
  commandTimeout: 3000,       // individual commands time out in 3s
  retryStrategy: (attempt) => attempt < 3 ? Math.min(attempt * 500, 2000) : null,
  lazyConnect: true,          // don't block module load if Redis is unreachable
};

export const redis = new IORedis(env.REDIS_URL, SHARED_OPTS);
export const redisPub = new IORedis(env.REDIS_URL, SHARED_OPTS);
export const redisSub = new IORedis(env.REDIS_URL, SHARED_OPTS);

// Suppress unhandled error events when Redis is unreachable so it doesn't crash Node
redis.on('error', () => {});
redisPub.on('error', () => {});
redisSub.on('error', () => {});

/** Convenience for callers that want a fresh ioredis client. */
export function makeRedis(): IORedis {
  return new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

// rediss://user:pass@host:6379  →  { host, port, username, password, tls }
function parseRedisUrl(url: string): RedisOptions {
  const u = new URL(url);
  const tls = u.protocol === 'rediss:' ? {} : undefined;
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    ...(tls ? { tls } : {}),
    family: 0, // allow both IPv4 + IPv6 (Upstash sometimes returns AAAA)
  };
}
