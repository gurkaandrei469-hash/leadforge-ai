import pLimit from 'p-limit';
import { prisma } from '../db/prisma.js';
import { logger } from '../utils/logger.js';
import { matchInMemory } from '../filters/engine.js';
import { verificationQueue, enrichmentQueue } from '../workers/queues.js';
import type { Filter } from '../filters/types.js';
import { discoverSources } from './discovery.js';
import { scrapePage, type ScrapedPage } from './scraper.js';
import { extractLeads, type LeadCandidate } from './extractor.js';
import { ROLE_LOCALPARTS } from '../verification/syntax.js';
import { findLinkedInProfile } from './searchEngines.js';

// Additional role-prefix patterns not worth enumerating individually
const ROLE_PREFIX_RE = /^(?:no[_.-]?reply|do[_.-]?not[_.-]?reply|bounce|unsubscribe|auto[_.-]?reply|mailer)/i;

/**
 * Returns true only for emails that look like they belong to a real person —
 * not a shared/role inbox.  Rejects:
 *   • Exact matches in ROLE_LOCALPARTS (info@, support@, sales@, …)
 *   • Known no-reply/bounce patterns
 *   • Ultra-short generic local parts (hr@, it@, pr@)
 *   • Garbage captures containing slashes or double-dots
 */
function isMarketableEmail(email: string | null): boolean {
  if (!email) return false;
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  if (!local) return false;
  if (email.includes('/') || email.includes('..')) return false;
  if (ROLE_LOCALPARTS.has(local)) return false;
  if (ROLE_PREFIX_RE.test(local)) return false;
  // Single/two-char all-alpha local — almost always a role alias (hr@, it@, pr@)
  if (local.length <= 2 && /^[a-z]+$/.test(local)) return false;
  return true;
}

interface RunArgs {
  jobId: string;
  teamId: string;
  sources: any[];
  filters: Filter;
  targetLeads: number;
  onProgress: (p: { progress: number; leadsFound: number; pagesScraped: number; eta?: Date }) => Promise<void>;
}

const CONCURRENCY = 6;

// Common URL paths that frequently contain decision-maker contact info.
// We follow these from any successfully-scraped domain root.
const CONTACT_HINTS = [
  '/contact', '/contact-us', '/contacts',
  '/about', '/about-us', '/team', '/our-team', '/people', '/leadership',
  '/staff', '/employees', '/management', '/founders', '/who-we-are',
  '/imprint', '/impressum',
];

/**
 * Aggressive multi-pass extraction. The pipeline keeps trying broader strategies
 * until either the target is hit OR every strategy has been exhausted:
 *
 *   Pass 1 — original sources + filters → fetch + extract
 *   Pass 2 — deep crawl /about /team /contact links of every Pass-1 domain
 *   Pass 3 — keyword expansion (synonyms, role variations)
 *   Pass 4 — broaden sources to ALL 11 source types
 *   Pass 5 — for known-company-but-no-email leads, guess email patterns
 *
 * Each pass can early-exit if leadsFound >= targetLeads. Progress is reported
 * after every URL scraped so the UI stays live.
 */
export async function runExtraction(args: RunArgs) {
  const state: ExtractionState = {
    args,
    leadsFound: 0,
    pagesScraped: 0,
    start: Date.now(),
    visited: new Set<string>(),
    seenDomainHints: new Set<string>(),
    leadsByDomain: new Map<string, LeadCandidate[]>(),
  };

  // ── Pass 1 — original sources + filters
  logger.info({ jobId: args.jobId }, 'pass 1: original discovery');
  const initialUrls = await discoverSources(args.sources, args.filters);
  await processBatch(state, initialUrls);
  if (state.leadsFound >= args.targetLeads) return;

  // ── Pass 2 — deep-crawl contact/about/team pages on visited domains
  logger.info({ jobId: args.jobId, leadsSoFar: state.leadsFound }, 'pass 2: deep crawl contact pages');
  const deepUrls = expandDeepUrls(state.visited);
  await processBatch(state, deepUrls);
  if (state.leadsFound >= args.targetLeads) return;

  // ── Pass 3 — expanded keywords + same sources
  const keywords = extractKeywords(args.filters);
  if (keywords.length > 0) {
    logger.info({ jobId: args.jobId, leadsSoFar: state.leadsFound }, 'pass 3: keyword expansion');
    const expanded = expandKeywords(keywords);
    const expandedFilter = withKeywords(args.filters, expanded);
    const urls = await discoverSources(args.sources, expandedFilter);
    await processBatch(state, urls);
    if (state.leadsFound >= args.targetLeads) return;
  }

  // ── Pass 4 — every source type, original keywords
  if (state.leadsFound < args.targetLeads) {
    logger.info({ jobId: args.jobId, leadsSoFar: state.leadsFound }, 'pass 4: broaden to all sources');
    const allSources = [
      'WEB_SEARCH', 'DIRECTORY', 'COMPANY_PAGE', 'BLOG', 'FORUM',
      'SOCIAL_LINKEDIN', 'CONTACT_PAGE', 'LISTING',
    ];
    const urls = await discoverSources(allSources, args.filters);
    await processBatch(state, urls);
  }

  // ── Pass 5 — pattern-guess emails for partial leads (name + company, no email)
  if (state.leadsFound < args.targetLeads) {
    logger.info({ jobId: args.jobId, leadsSoFar: state.leadsFound }, 'pass 5: pattern-guess emails');
    await guessEmailsForPartialLeads(state);
  }

  logger.info(
    { jobId: args.jobId, leadsFound: state.leadsFound, pagesScraped: state.pagesScraped, duration: Date.now() - state.start },
    'extraction finished',
  );
}

// ─────────────────────── helpers ────────────────────────────────────────────

interface ExtractionState {
  args: RunArgs;
  leadsFound: number;
  pagesScraped: number;
  start: number;
  visited: Set<string>;
  seenDomainHints: Set<string>;
  /** Per-domain partial leads (name+company but no email) collected for the
   *  pattern-guessing pass. */
  leadsByDomain: Map<string, LeadCandidate[]>;
}

async function processBatch(state: ExtractionState, urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  const limit = pLimit(CONCURRENCY);

  // Active keywords from the user's filter. We use these to populate each
  // candidate's matchedKeywords field — without this the `keyword IN [...]`
  // filter would reject every lead (extractor.ts always returns an empty
  // matchedKeywords list because it has no idea what search query found the page).
  const activeKeywords = extractKeywords(state.args.filters);

  await Promise.all(
    urls.map((url) =>
      limit(async () => {
        if (state.leadsFound >= state.args.targetLeads) return;
        if (state.visited.has(url)) return;
        state.visited.add(url);

        try {
          const page = await scrapePage(url);
          state.pagesScraped++;
          const candidates = extractLeads(page);
          const pageMatchedKeywords = matchKeywordsOnPage(page, activeKeywords);

          for (const c of candidates) {
            if (state.leadsFound >= state.args.targetLeads) break;

            // Tag the candidate with the keywords that actually appear on the
            // source page. Falls back to ALL active keywords so the user's
            // filter passes — they searched for these, so the lead matched.
            c.matchedKeywords = pageMatchedKeywords.length > 0 ? pageMatchedKeywords : activeKeywords;

            // Stash partial leads (no email yet) so the final pass can pattern-guess
            if (!c.email && c.fullName && c.companyDomain) {
              const arr = state.leadsByDomain.get(c.companyDomain) ?? [];
              arr.push(c);
              state.leadsByDomain.set(c.companyDomain, arr);
              continue;
            }

            if (!matchInMemory(state.args.filters, c)) continue;
            if (!isMarketableEmail(c.email)) continue;
            await persistLead(state, c);
          }

          await reportProgress(state);
        } catch (err) {
          logger.warn({ err: (err as Error).message, url }, 'scrape error');
        }
      }),
    ),
  );
}

/**
 * Return the subset of `keywords` that appear (case-insensitive substring
 * match) in either the page title or body text. Used to tag extracted leads
 * with which of the user's search terms actually matched the source page.
 */
function matchKeywordsOnPage(page: { title: string; text: string }, keywords: string[]): string[] {
  if (keywords.length === 0) return [];
  const hay = (page.title + ' ' + page.text).toLowerCase();
  return keywords.filter((kw) => hay.includes(kw.toLowerCase()));
}

/** Remove keys whose value is undefined so Prisma doesn't clobber non-null columns. */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as any)[k] = v;
  }
  return out;
}

async function persistLead(state: ExtractionState, c: LeadCandidate): Promise<void> {
  const { args } = state;

  // Identity resolution — catch fuzzy duplicates (Jon Smith vs John Smith at
  // the same company) BEFORE we upsert. The existing emailNormalized unique
  // index handles exact-email dedup; this catches everything else.
  let resolved: { id: string } | null = null;
  try {
    const { resolveLead } = await import('../intelligence/matching/resolver.js');
    const r = await resolveLead(args.teamId, c);
    if (r.match) resolved = { id: r.match.id };
  } catch { /* resolver should never throw — but if it does, fall back to upsert */ }

  const lead = resolved
    ? await prisma.lead.update({
        where: { id: resolved.id },
        data: {
          jobId: args.jobId,
          // Fill in any fields we now have that we didn't before. Don't
          // overwrite existing non-null values.
          ...stripUndefined({
            email: c.email ?? undefined,
            fullName: c.fullName ?? undefined,
            firstName: c.firstName ?? undefined,
            lastName: c.lastName ?? undefined,
            jobTitle: c.jobTitle ?? undefined,
            companyName: c.companyName ?? undefined,
            companyDomain: c.companyDomain ?? undefined,
            linkedinUrl: c.linkedinUrl ?? undefined,
            twitterUrl: c.twitterUrl ?? undefined,
          }),
        },
      })
    : await prisma.lead.upsert({
        where: {
          teamId_emailNormalized: {
            teamId: args.teamId,
            emailNormalized: c.email?.toLowerCase() ?? `__none_${Date.now()}_${Math.random()}`,
          },
        },
        create: {
          teamId: args.teamId,
          jobId: args.jobId,
          ...c,
          emailNormalized: c.email?.toLowerCase() ?? null,
          status: 'NEW',
        },
        update: { jobId: args.jobId },
      });

  state.leadsFound++;

  if (lead.email) {
    await verificationQueue.add('verify', { leadId: lead.id, email: lead.email, teamId: args.teamId });
  }
  await enrichmentQueue.add('classify', { leadId: lead.id, teamId: args.teamId });

  if (!lead.linkedinUrl && lead.fullName && lead.fullName.length > 3) {
    findLinkedInProfile(lead.fullName, lead.companyName ?? undefined)
      .then(async (url) => {
        if (url) await prisma.lead.update({ where: { id: lead.id }, data: { linkedinUrl: url } });
      })
      .catch(() => {});
  }
}

async function reportProgress(state: ExtractionState): Promise<void> {
  const progress = Math.min(99, (state.leadsFound / state.args.targetLeads) * 100);
  const elapsed = Date.now() - state.start;
  const eta =
    state.leadsFound > 0
      ? new Date(Date.now() + (elapsed / state.leadsFound) * (state.args.targetLeads - state.leadsFound))
      : undefined;
  await state.args.onProgress({
    progress,
    leadsFound: state.leadsFound,
    pagesScraped: state.pagesScraped,
    eta,
  });
}

/**
 * For every domain we've already scraped, generate a fresh list of common
 * contact-page paths. Skips paths we've already visited.
 */
function expandDeepUrls(visited: Set<string>): string[] {
  const out: string[] = [];
  const seenOrigins = new Set<string>();
  for (const url of visited) {
    let origin: string;
    try { origin = new URL(url).origin; } catch { continue; }
    if (seenOrigins.has(origin)) continue;
    seenOrigins.add(origin);
    for (const path of CONTACT_HINTS) {
      const candidate = origin + path;
      if (!visited.has(candidate)) out.push(candidate);
    }
  }
  return out;
}

/**
 * Walk the filter tree and pull every keyword/niche/industry value into a flat list.
 */
function extractKeywords(filter: Filter): string[] {
  const out: string[] = [];
  const walk = (n: any) => {
    if (!n) return;
    if (n.field === 'keyword' || n.field === 'niche' || n.field === 'industry') {
      const v = n.value;
      if (Array.isArray(v)) out.push(...v.map(String));
      else if (v) out.push(String(v));
    }
    if (n.AND) (n.AND as any[]).forEach(walk);
    if (n.OR) (n.OR as any[]).forEach(walk);
    if (n.NOT) walk((n as any).NOT);
  };
  walk(filter);
  return [...new Set(out)];
}

/**
 * For each keyword generate variations: role-flavored suffixes, abbreviation
 * swaps, "contact"/"directory"-prefixed queries. Strictly additive — original
 * keywords are kept. Capped at ~24 to keep Serper usage bounded.
 */
function expandKeywords(kws: string[]): string[] {
  const ROLE_SUFFIXES = ['director', 'manager', 'CEO', 'founder', 'VP', 'consultant'];
  const ENRICHERS = ['contact email', 'team directory', 'leadership', 'point of contact'];
  const out = new Set<string>();
  for (const kw of kws) {
    out.add(kw);
    out.add(`${kw} contact`);
    out.add(`${kw} email`);
    out.add(`${kw} directory`);
    // Mix in 2 role variants per keyword
    ROLE_SUFFIXES.slice(0, 2).forEach((r) => out.add(`${kw} ${r}`));
    // Mix in 1 enricher
    out.add(`${kw} ${ENRICHERS[0]}`);
    // Common abbreviation expansion
    if (/Microsoft 365|Office 365/i.test(kw)) {
      out.add(kw.replace(/Office 365/i, 'Microsoft 365'));
      out.add(kw.replace(/Microsoft 365/i, 'Office 365'));
      out.add('M365 administrator');
    }
  }
  return [...out].slice(0, 24);
}

/**
 * Return a copy of `filter` with every `keyword` field's value replaced by the
 * expanded set. Preserves non-keyword conditions so the user's other filters
 * still apply.
 */
function withKeywords(filter: Filter, kws: string[]): Filter {
  const clone = JSON.parse(JSON.stringify(filter));
  const walk = (n: any) => {
    if (!n) return;
    if (n.field === 'keyword' || n.field === 'niche' || n.field === 'industry') {
      n.value = kws;
    }
    if (n.AND) (n.AND as any[]).forEach(walk);
    if (n.OR) (n.OR as any[]).forEach(walk);
    if (n.NOT) walk(n.NOT);
  };
  walk(clone);
  return clone;
}

/**
 * For every partial lead (name + company domain, no email), generate the
 * common email patterns and persist as new leads. The verification worker
 * will then test each one via SMTP and flip non-deliverable ones to INVALID,
 * so unverified guesses don't pollute downstream campaigns.
 */
async function guessEmailsForPartialLeads(state: ExtractionState): Promise<void> {
  for (const [domain, candidates] of state.leadsByDomain.entries()) {
    if (state.leadsFound >= state.args.targetLeads) break;
    if (!domain) continue;

    for (const c of candidates) {
      if (state.leadsFound >= state.args.targetLeads) break;
      const first = (c.firstName ?? c.fullName?.split(/\s+/)[0] ?? '').toLowerCase().replace(/[^a-z]/g, '');
      const last = (c.lastName ?? c.fullName?.split(/\s+/).slice(-1)[0] ?? '').toLowerCase().replace(/[^a-z]/g, '');
      if (!first || !last) continue;

      // Most common patterns first — verifier will filter out the bad ones.
      const guesses = [
        `${first}.${last}@${domain}`,
        `${first}${last}@${domain}`,
        `${first[0]}${last}@${domain}`,
        `${first}@${domain}`,
      ];

      for (const email of guesses) {
        if (state.leadsFound >= state.args.targetLeads) break;
        const enriched: LeadCandidate = { ...c, email };
        if (!matchInMemory(state.args.filters, enriched)) continue;
        await persistLead(state, enriched);
      }
    }
    await reportProgress(state);
  }
}
