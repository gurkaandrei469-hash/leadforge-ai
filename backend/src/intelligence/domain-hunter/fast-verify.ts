/**
 * Fast 3-stage pre-screening pipeline to filter bad email candidates
 * BEFORE sending them to the expensive SMTP / DNS verification.
 *
 * Stage 1: EmailRep.io free API — reputation, suspicious flag
 * Stage 2: Clearbit Risk free API — disposable / role check
 * Stage 3: MX catch-all pre-screen — probe random999@domain via SMTP RCPT TO;
 *           if server accepts, domain is catch-all → skip individual probes
 *
 * Returns 'pass' | 'fail' | 'catchall' per email.
 *
 * NOTE: The SMTP catch-all probe (Stage 3) only fires once per domain and
 * is cached to avoid redundant probes.
 */
import axios from 'axios';
import * as dns from 'dns';
import * as net from 'net';
import { promisify } from 'util';
import { logger } from '../../utils/logger.js';
import { DomainCache } from './cache.js';

const resolveMx = promisify(dns.resolveMx);

export type FastVerifyResult = 'pass' | 'fail' | 'catchall';

// ─── Stage 1: EmailRep.io ─────────────────────────────────────────────────────

async function checkEmailRep(email: string): Promise<'pass' | 'fail' | 'skip'> {
  try {
    const apiKey = process.env.EMAILREP_API_KEY ?? '';
    const headers: Record<string, string> = {
      'User-Agent': 'LeadForge/1.0',
    };
    if (apiKey) headers['Key'] = apiKey;

    const { data } = await axios.get(`https://emailrep.io/${encodeURIComponent(email)}`, {
      headers,
      timeout: 5000,
      validateStatus: s => s < 500,
    });

    if (data?.status !== 'ok' && !data?.reputation) return 'skip';

    // Fail if clearly suspicious
    if (data?.suspicious === true) return 'fail';

    // Fail if reputation is 'none' (completely unknown / new address — risky)
    if (data?.reputation === 'none') {
      // Only fail if also has no references
      if ((data?.references ?? 0) === 0) return 'fail';
    }

    return 'pass';
  } catch {
    // API unavailable or rate-limited — skip this stage
    return 'skip';
  }
}

// ─── Stage 2: Clearbit Risk ────────────────────────────────────────────────────

async function checkClearbitRisk(email: string): Promise<'pass' | 'fail' | 'skip'> {
  try {
    const { data } = await axios.get('https://risk.clearbit.com/v1/calculate', {
      params: { email },
      timeout: 5000,
      validateStatus: s => s < 500,
    });

    if (!data) return 'skip';

    // Fail hard if disposable
    if (data?.email?.disposable === true) return 'fail';

    // Fail if it's a role account (info@, noreply@, etc.) with high risk
    if (data?.email?.role === true && (data?.risk?.level === 'high' || data?.risk?.level === 'very_high')) return 'fail';

    // Fail if overall risk is very high
    if (data?.risk?.level === 'very_high') return 'fail';

    return 'pass';
  } catch {
    return 'skip';
  }
}

// ─── Stage 3: SMTP catch-all probe ────────────────────────────────────────────

// In-memory cache for domains already probed this process run
const catchAllCache = new Map<string, boolean>();

async function getMxHost(domain: string): Promise<string | null> {
  // Check Redis cache first
  const cacheKey = DomainCache.mxKey(domain);
  const cached = await DomainCache.get<string[]>(cacheKey);
  if (cached && cached.length > 0) return cached[0]!;

  try {
    const records = await resolveMx(domain);
    if (records.length === 0) return null;
    records.sort((a, b) => a.priority - b.priority);
    const mxHost = records[0]!.exchange;
    // Cache for 7 days
    await DomainCache.set(cacheKey, records.map(r => r.exchange), DomainCache.TTL.mx);
    return mxHost;
  } catch {
    return null;
  }
}

/** SMTP probe: connects, sends EHLO + MAIL FROM + RCPT TO, reads result. */
async function smtpProbe(mxHost: string, fromEmail: string, toEmail: string, timeoutMs = 6000): Promise<boolean | null> {
  return new Promise(resolve => {
    let settled = false;
    const settle = (val: boolean | null) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        sock.destroy();
        resolve(val);
      }
    };

    const timer = setTimeout(() => settle(null), timeoutMs);

    const sock = net.createConnection(25, mxHost);
    sock.setEncoding('ascii');

    let buf = '';
    let step = 0;

    sock.on('error', () => settle(null));

    sock.on('data', (chunk: string) => {
      buf += chunk;
      const lines = buf.split('\r\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        if (!line) continue;
        const code = parseInt(line.slice(0, 3), 10);
        if (isNaN(code)) continue;

        if (step === 0 && code === 220) {
          sock.write(`EHLO leadforge-verify.com\r\n`);
          step = 1;
        } else if (step === 1 && (code === 250 || code === 220)) {
          if (!line.startsWith('250-')) {
            // Last line of EHLO response
            sock.write(`MAIL FROM:<${fromEmail}>\r\n`);
            step = 2;
          }
        } else if (step === 2 && code === 250) {
          sock.write(`RCPT TO:<${toEmail}>\r\n`);
          step = 3;
        } else if (step === 3) {
          // 250 = accepted, 550/551/553 = rejected, anything else = unknown
          if (code === 250 || code === 251) settle(true);
          else if (code >= 500 && code < 600) settle(false);
          else settle(null);
        } else if (code >= 400) {
          // Server busy / temp fail / rejected immediately
          settle(null);
        }
      }
    });
  });
}

/** Returns true if the domain accepts any random address (catch-all). */
async function isCatchAll(domain: string): Promise<boolean> {
  // Fast in-memory check first
  if (catchAllCache.has(domain)) return catchAllCache.get(domain)!;

  // Then Redis cache
  const cacheKey = DomainCache.catchallKey(domain);
  const cached = await DomainCache.get<boolean>(cacheKey);
  if (cached !== null) {
    catchAllCache.set(domain, cached);
    return cached;
  }

  const mxHost = await getMxHost(domain);
  if (!mxHost) {
    catchAllCache.set(domain, false);
    return false;
  }

  const randomLocal = `probe${Math.floor(Math.random() * 1_000_000_000)}`;
  const probeAddress = `${randomLocal}@${domain}`;
  const fromAddress = process.env.SMTP_VERIFY_FROM ?? 'verify@leadforge.ai';

  const accepted = await smtpProbe(mxHost, fromAddress, probeAddress, 8000);

  // null = inconclusive (timeout / error) → assume not catch-all
  const result = accepted === true;

  catchAllCache.set(domain, result);
  await DomainCache.set(cacheKey, result, DomainCache.TTL.catchall);

  if (result) {
    logger.info({ domain, mxHost }, 'fast-verify: domain is catch-all');
  }

  return result;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run the 3-stage fast pre-screen for a single email.
 * Returns 'catchall', 'fail', or 'pass'.
 */
export async function fastVerify(email: string): Promise<FastVerifyResult> {
  const [, domain] = email.toLowerCase().split('@') as [string, string];
  if (!domain) return 'fail';

  // Stage 3 first — if domain is catch-all, no point checking the individual address
  try {
    const catchall = await isCatchAll(domain);
    if (catchall) return 'catchall';
  } catch {
    // non-fatal — continue
  }

  // Stage 1: EmailRep
  const repResult = await checkEmailRep(email);
  if (repResult === 'fail') return 'fail';

  // Stage 2: Clearbit Risk
  const riskResult = await checkClearbitRisk(email);
  if (riskResult === 'fail') return 'fail';

  return 'pass';
}

/**
 * Batch-screen a list of candidates.
 * Returns an object with candidates grouped by result.
 */
export async function batchFastVerify(emails: string[]): Promise<{
  pass: string[];
  fail: string[];
  catchall: string[];
}> {
  const pass: string[] = [];
  const fail: string[] = [];
  const catchall: string[] = [];

  // Domain-level catch-all check first (deduplicated per domain)
  const domains = [...new Set(emails.map(e => e.split('@')[1] ?? '').filter(Boolean))];
  const catchallDomains = new Set<string>();

  await Promise.allSettled(
    domains.map(async domain => {
      try {
        if (await isCatchAll(domain)) catchallDomains.add(domain);
      } catch { /* non-fatal */ }
    })
  );

  // Now screen remaining emails in parallel
  await Promise.allSettled(
    emails.map(async email => {
      const domain = email.split('@')[1] ?? '';
      if (catchallDomains.has(domain)) {
        catchall.push(email);
        return;
      }

      const [repResult, riskResult] = await Promise.allSettled([
        checkEmailRep(email),
        checkClearbitRisk(email),
      ]);

      const rep  = repResult.status  === 'fulfilled' ? repResult.value  : 'skip';
      const risk = riskResult.status === 'fulfilled' ? riskResult.value : 'skip';

      if (rep === 'fail' || risk === 'fail') {
        fail.push(email);
      } else {
        pass.push(email);
      }
    })
  );

  return { pass, fail, catchall };
}
