/**
 * KeyPool — Multi-key rotation for Serper and Hunter APIs.
 *
 * Reads keys from environment variables:
 *   SERPER_API_KEY, SERPER_API_KEY_1, SERPER_API_KEY_2, SERPER_API_KEY_3, ...
 *   HUNTER_API_KEY, HUNTER_API_KEY_1, HUNTER_API_KEY_2, HUNTER_API_KEY_3, ...
 *
 * Round-robins across available keys.
 * Marks keys as exhausted on 429 / quota errors.
 */
import { logger } from '../../utils/logger.js';

interface KeyEntry {
  key: string;
  usageCount: number;
  exhausted: boolean;
  exhaustedAt?: Date;
}

class KeyPool {
  private readonly pool: KeyEntry[];
  private cursor = 0;
  private readonly name: string;
  // How long an exhausted key stays in cooldown before being retried (default: 1 hour)
  private readonly cooldownMs: number;

  constructor(name: string, keys: string[], cooldownMs = 60 * 60 * 1000) {
    this.name = name;
    this.cooldownMs = cooldownMs;
    this.pool = [...new Set(keys.filter(Boolean))].map(key => ({
      key,
      usageCount: 0,
      exhausted: false,
    }));
    if (this.pool.length === 0) {
      logger.warn({ pool: name }, 'KeyPool initialized with no keys');
    } else {
      logger.info({ pool: name, count: this.pool.length }, 'KeyPool initialized');
    }
  }

  /** Returns the next available key, round-robining past exhausted ones. */
  getKey(): string | null {
    const now = Date.now();
    const total = this.pool.length;
    if (total === 0) return null;

    // Recover keys whose cooldown has expired
    for (const entry of this.pool) {
      if (entry.exhausted && entry.exhaustedAt && now - entry.exhaustedAt.getTime() > this.cooldownMs) {
        entry.exhausted = false;
        entry.exhaustedAt = undefined;
        logger.info({ pool: this.name, key: entry.key.slice(0, 6) + '***' }, 'KeyPool: key recovered from cooldown');
      }
    }

    // Find the next non-exhausted key starting from cursor
    for (let i = 0; i < total; i++) {
      const idx = (this.cursor + i) % total;
      const entry = this.pool[idx]!;
      if (!entry.exhausted) {
        this.cursor = (idx + 1) % total;
        entry.usageCount++;
        return entry.key;
      }
    }

    // All keys exhausted — return the least-recently exhausted one as a last resort
    logger.warn({ pool: this.name }, 'KeyPool: all keys exhausted — returning first key anyway');
    const fallback = this.pool[this.cursor % total]!;
    fallback.usageCount++;
    return fallback.key;
  }

  /** Mark a key as exhausted (e.g. after 429 or quota error). */
  markExhausted(key: string): void {
    const entry = this.pool.find(e => e.key === key);
    if (entry && !entry.exhausted) {
      entry.exhausted = true;
      entry.exhaustedAt = new Date();
      logger.warn({ pool: this.name, key: key.slice(0, 6) + '***' }, 'KeyPool: key marked exhausted');
    }
  }

  /** How many active (non-exhausted) keys remain. */
  activeCount(): number {
    return this.pool.filter(e => !e.exhausted).length;
  }

  /** Usage summary per key. */
  stats(): Array<{ key: string; usageCount: number; exhausted: boolean }> {
    return this.pool.map(e => ({
      key: e.key.slice(0, 6) + '***',
      usageCount: e.usageCount,
      exhausted: e.exhausted,
    }));
  }
}

// ─── Helper: collect numbered env keys ───────────────────────────────────────

function collectKeys(baseName: string): string[] {
  const keys: string[] = [];
  // Base key (no suffix)
  const base = process.env[baseName];
  if (base) keys.push(base);
  // Numbered variants: KEY_1, KEY_2, KEY_3, KEY_4, KEY_5
  for (let i = 1; i <= 5; i++) {
    const v = process.env[`${baseName}_${i}`];
    if (v) keys.push(v);
  }
  return keys;
}

// ─── Singleton pools ──────────────────────────────────────────────────────────

let _serperPool: KeyPool | null = null;
let _hunterPool: KeyPool | null = null;

export function getSerperPool(): KeyPool {
  if (!_serperPool) {
    _serperPool = new KeyPool('serper', collectKeys('SERPER_API_KEY'));
  }
  return _serperPool;
}

export function getHunterPool(): KeyPool {
  if (!_hunterPool) {
    _hunterPool = new KeyPool('hunter', collectKeys('HUNTER_API_KEY'));
  }
  return _hunterPool;
}

/** Convenience: get next Serper key (null if none configured) */
export function getSerperKey(): string | null {
  return getSerperPool().getKey();
}

/** Convenience: get next Hunter key (null if none configured) */
export function getHunterKey(): string | null {
  return getHunterPool().getKey();
}

/** Mark a specific key exhausted across whichever pool owns it. */
export function markExhausted(key: string): void {
  getSerperPool().markExhausted(key);
  getHunterPool().markExhausted(key);
}
