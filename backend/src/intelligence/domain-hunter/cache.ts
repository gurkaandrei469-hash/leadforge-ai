/**
 * DomainCache — Redis-backed cache for domain hunt data.
 *
 * Keys / TTLs:
 *   hunter:{domain}    → Hunter.io results         30 days
 *   osint:{domain}     → OSINT results             3 days
 *   employees:{domain} → Discovered employees      7 days
 *   mx:{domain}        → MX records                7 days
 *   catchall:{domain}  → Catch-all flag            7 days
 *
 * Gracefully falls back (returns null) when Redis is unavailable.
 */
import Redis from 'ioredis';
import { logger } from '../../utils/logger.js';

const REDIS_URL = process.env.REDIS_URL ?? '';

let _client: Redis | null = null;
let _connected = false;
let _connectAttempted = false;

function getClient(): Redis | null {
  if (_connectAttempted) return _connected ? _client : null;
  _connectAttempted = true;

  if (!REDIS_URL) {
    logger.warn('DomainCache: REDIS_URL not set — caching disabled');
    return null;
  }

  try {
    const client = new Redis(REDIS_URL, {
      connectTimeout: 3000,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    client.on('ready', () => {
      _connected = true;
      logger.info('DomainCache: Redis connected');
    });

    client.on('error', (err: Error) => {
      if (_connected) {
        logger.warn({ err: err.message }, 'DomainCache: Redis error — caching disabled');
      }
      _connected = false;
    });

    client.on('close', () => {
      _connected = false;
    });

    // Initiate connection (non-blocking)
    client.connect().catch(() => {
      // will be caught by the error event above
    });

    _client = client;
    return client;
  } catch (err: any) {
    logger.warn({ err: err.message }, 'DomainCache: failed to create Redis client');
    return null;
  }
}

export class DomainCache {
  // Pre-defined TTLs in seconds
  static readonly TTL = {
    hunter:    30 * 24 * 60 * 60,   // 30 days
    osint:      3 * 24 * 60 * 60,   //  3 days
    employees:  7 * 24 * 60 * 60,   //  7 days
    mx:         7 * 24 * 60 * 60,   //  7 days
    catchall:   7 * 24 * 60 * 60,   //  7 days
  } as const;

  /** Get a cached value. Returns null if not found or Redis unavailable. */
  static async get<T>(key: string): Promise<T | null> {
    const client = getClient();
    if (!client || !_connected) return null;
    try {
      const raw = await client.get(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch (err: any) {
      logger.debug({ key, err: err.message }, 'DomainCache: get failed');
      return null;
    }
  }

  /** Set a value with TTL (seconds). No-op if Redis unavailable. */
  static async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const client = getClient();
    if (!client || !_connected) return;
    try {
      await client.setex(key, ttlSeconds, JSON.stringify(value));
    } catch (err: any) {
      logger.debug({ key, err: err.message }, 'DomainCache: set failed');
    }
  }

  /** Check if key exists. Returns false if Redis unavailable. */
  static async has(key: string): Promise<boolean> {
    const client = getClient();
    if (!client || !_connected) return false;
    try {
      return (await client.exists(key)) === 1;
    } catch {
      return false;
    }
  }

  // ─── Typed helpers ────────────────────────────────────────────────────────

  static hunterKey(domain: string)    { return `hunter:${domain}`; }
  static osintKey(domain: string)     { return `osint:${domain}`; }
  static employeesKey(domain: string) { return `employees:${domain}`; }
  static mxKey(domain: string)        { return `mx:${domain}`; }
  static catchallKey(domain: string)  { return `catchall:${domain}`; }
}
