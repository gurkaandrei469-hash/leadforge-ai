import { promises as dns } from 'node:dns';
import { prisma } from '../db/prisma.js';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function lookupMx(domain: string): Promise<{ valid: boolean; records: string[] }> {
  const d = domain.toLowerCase();
  const cached = await prisma.domainCache.findUnique({ where: { domain: d } });
  if (cached && cached.expiresAt > new Date()) {
    return { valid: cached.hasMx, records: cached.mxRecords };
  }

  try {
    const records = await dns.resolveMx(d);
    const sorted = records.sort((a, b) => a.priority - b.priority).map((r) => r.exchange.toLowerCase());
    const valid = sorted.length > 0;

    await prisma.domainCache.upsert({
      where: { domain: d },
      create: {
        domain: d,
        mxRecords: sorted,
        hasMx: valid,
        isDisposable: false,
        expiresAt: new Date(Date.now() + CACHE_TTL_MS),
      },
      update: {
        mxRecords: sorted,
        hasMx: valid,
        lastCheckedAt: new Date(),
        expiresAt: new Date(Date.now() + CACHE_TTL_MS),
      },
    });

    return { valid, records: sorted };
  } catch {
    return { valid: false, records: [] };
  }
}
