// Multi-signal email verification — designed to produce a reliable
// deliverability verdict WITHOUT relying on outbound SMTP probes on port 25
// (which Railway, Render, Fly, AWS EC2 free tier, GCP free tier, and most
// other cloud providers block by default to prevent spam abuse).
//
// We gather every signal we can from DNS + the email's own structure, then
// combine them in scoring.ts into a single VALID / CATCH_ALL / RISKY /
// UNKNOWN / INVALID verdict with a 0-100 confidence score.

import { promises as dns } from 'node:dns';
import { prisma } from '../db/prisma.js';

// ─── Common-typo correction (mailcheck.js style) ─────────────────────────────
const POPULAR_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
  'icloud.com', 'me.com', 'aol.com', 'protonmail.com', 'proton.me',
  'live.com', 'msn.com', 'yandex.ru', 'qq.com', 'mail.com',
];

/** Damerau-Levenshtein distance (allows single-char swaps). */
function distance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
        i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]
          ? dp[i - 2]![j - 2]! + 1
          : Infinity,
      );
    }
  }
  return dp[m]![n]!;
}

/** Return the closest popular domain within Damerau-Lev distance ≤ 2, or null. */
export function suggestTypoFix(domain: string): string | null {
  const d = domain.toLowerCase();
  if (POPULAR_DOMAINS.includes(d)) return null;
  let best: { domain: string; dist: number } | null = null;
  for (const candidate of POPULAR_DOMAINS) {
    if (Math.abs(candidate.length - d.length) > 2) continue;
    const dist = distance(d, candidate);
    if (dist > 0 && dist <= 2 && (!best || dist < best.dist)) {
      best = { domain: candidate, dist };
    }
  }
  return best?.domain ?? null;
}

// ─── Free vs business email detection ───────────────────────────────────────
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'ymail.com',
  'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'aim.com',
  'protonmail.com', 'proton.me', 'pm.me', 'tutanota.com',
  'gmx.com', 'gmx.de', 'mail.com', 'yandex.com', 'yandex.ru',
  'zoho.com', 'fastmail.com',
]);

export function isFreeEmail(domain: string): boolean {
  return FREE_EMAIL_DOMAINS.has(domain.toLowerCase());
}

// ─── MX provider classification ─────────────────────────────────────────────
//
// Knowing which mail provider hosts a domain's MX records massively improves
// our confidence. A domain on Google Workspace or Microsoft 365 is HIGHLY
// likely to actually deliver mail (these providers have great anti-spam and
// reject obviously-invalid addresses at SMTP time anyway). A domain pointing
// at a generic VPS with no recognizable MX is much more likely to be a
// catch-all or accept-all configuration.

export type MxProvider =
  | 'GOOGLE'
  | 'MICROSOFT'
  | 'ZOHO'
  | 'AMAZON_SES'
  | 'SENDGRID'
  | 'MAILGUN'
  | 'POSTMARK'
  | 'PROTONMAIL'
  | 'YANDEX'
  | 'FASTMAIL'
  | 'OTHER';

const MX_PATTERNS: Array<[MxProvider, RegExp]> = [
  ['GOOGLE',     /\bgoogle(?:mail)?\.com$|\baspmx\.l\.google\.com$|\bgoogle\b/i],
  ['MICROSOFT',  /\boutlook\.com$|\bprotection\.outlook\.com$|\bmail\.protection\.outlook\.com$/i],
  ['ZOHO',       /\bzoho(?:mail)?\.(?:com|eu|in)$/i],
  ['AMAZON_SES', /\bamazonaws\.com$|\bamazonses\.com$|\bemail-smtp\b/i],
  ['SENDGRID',   /\bsendgrid\.net$/i],
  ['MAILGUN',    /\bmailgun\.org$/i],
  ['POSTMARK',   /\bpostmarkapp\.com$/i],
  ['PROTONMAIL', /\bprotonmail\.ch$|\bproton\.me$/i],
  ['YANDEX',     /\byandex\.net$|\byandex\.ru$/i],
  ['FASTMAIL',   /\bmessagingengine\.com$|\bfastmail\.com$/i],
];

export function classifyMxProvider(records: string[]): MxProvider {
  for (const r of records) {
    for (const [provider, pattern] of MX_PATTERNS) {
      if (pattern.test(r)) return provider;
    }
  }
  return 'OTHER';
}

/** Providers known to enforce strong SMTP-time validation — high confidence. */
const STRONG_VALIDATION_PROVIDERS: ReadonlySet<MxProvider> = new Set([
  'GOOGLE', 'MICROSOFT', 'PROTONMAIL', 'FASTMAIL', 'ZOHO',
]);

export function hasStrongMxValidation(provider: MxProvider): boolean {
  return STRONG_VALIDATION_PROVIDERS.has(provider);
}

// ─── SPF / DMARC checks ─────────────────────────────────────────────────────
//
// A domain that publishes SPF + DMARC records is significantly more legit
// than one that doesn't — these are the table-stakes for any organization
// that takes email seriously. Used as a confidence multiplier in scoring.

export interface DomainAuthSignals {
  hasSpf: boolean;
  hasDmarc: boolean;
  dmarcPolicy: 'none' | 'quarantine' | 'reject' | null;
}

export async function lookupDomainAuth(domain: string): Promise<DomainAuthSignals> {
  const d = domain.toLowerCase();
  // Reuse the domain cache row if we've already done these lookups recently.
  const cached = await prisma.domainCache.findUnique({ where: { domain: d } });
  if (cached && cached.expiresAt > new Date() && (cached as any).hasSpf !== null) {
    return {
      hasSpf: (cached as any).hasSpf ?? false,
      hasDmarc: (cached as any).hasDmarc ?? false,
      dmarcPolicy: (cached as any).dmarcPolicy ?? null,
    };
  }

  const [spfRecords, dmarcRecords] = await Promise.all([
    safeTxt(d),
    safeTxt(`_dmarc.${d}`),
  ]);

  const hasSpf = spfRecords.some((r) => /v=spf1/i.test(r));
  const dmarcRecord = dmarcRecords.find((r) => /v=DMARC1/i.test(r));
  const hasDmarc = Boolean(dmarcRecord);
  let dmarcPolicy: DomainAuthSignals['dmarcPolicy'] = null;
  if (dmarcRecord) {
    const policyMatch = dmarcRecord.match(/\bp=(none|quarantine|reject)/i);
    dmarcPolicy = (policyMatch?.[1]?.toLowerCase() as any) ?? null;
  }
  return { hasSpf, hasDmarc, dmarcPolicy };
}

async function safeTxt(host: string): Promise<string[]> {
  try {
    const records = await dns.resolveTxt(host);
    return records.map((parts) => parts.join(''));
  } catch {
    return [];
  }
}

// ─── Suspicious-pattern detection ───────────────────────────────────────────
//
// Heuristics that catch garbage emails our regex pass would otherwise let
// through (e.g. "qwerty@example.com", "asdf1234@gmail.com", etc.).

const SUSPICIOUS_PATTERNS: RegExp[] = [
  /^[a-z]{1,3}\d{4,}$/i,            // a123456 — likely junk-account pattern
  /^test\d*$/i,                      // test, test1, test123
  /^example/i,                       // example*
  /^(?:asdf|qwer|zxcv|hjkl|jkl)/i,   // keyboard mashing
  /^[a-z0-9]{32,}$/i,                // very long random tokens
];

export function isSuspiciousLocalpart(local: string): boolean {
  return SUSPICIOUS_PATTERNS.some((re) => re.test(local));
}
