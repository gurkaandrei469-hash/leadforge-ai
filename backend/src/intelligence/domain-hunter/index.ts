/**
 * Domain Hunter — Hunter.io-style email discovery engine.
 *
 * Pipeline:
 *  1. Crawl every page of the target domain → harvest real emails + names
 *  2. Detect email naming pattern from harvested emails
 *  3. Find all employees via LinkedIn + company pages + press
 *  4. Generate email candidates using pattern × employee names
 *  5. SMTP-verify every candidate (RCPT TO on port 25)
 *  6. Persist VALID + RISKY leads to the database
 */
import pLimit from 'p-limit';
import { crawlDomain } from './crawler.js';
import { detectPattern, generateAllCandidates, applyPattern, type PatternType } from './pattern.js';
import { findEmployees } from './employee-finder.js';
import { enrichDomain } from './enrichment.js';
import { verifyEmail } from '../../verification/verifier.js';
import { prisma } from '../../db/prisma.js';
import { verificationQueue } from '../../workers/queues.js';
import { logger } from '../../utils/logger.js';

export interface DomainHuntOptions {
  domain: string;
  companyName: string;
  teamId: string;
  createdById: string;
  jobId: string;
  targetLeads?: number;
  onProgress?: (p: {
    stage: string;
    pagesVisited?: number;
    emailsFound?: number;
    employeesFound?: number;
    candidatesGenerated?: number;
    verified?: number;
    saved?: number;
  }) => void;
}

export interface DomainHuntResult {
  emailsDiscovered: number;
  employeesFound: number;
  candidatesGenerated: number;
  verified: number;
  saved: number;
  pattern: PatternType;
  patternConfidence: number;
}

export async function huntDomain(opts: DomainHuntOptions): Promise<DomainHuntResult> {
  const {
    domain, companyName, teamId, createdById, jobId,
    targetLeads = 500,
    onProgress = () => {},
  } = opts;

  logger.info({ domain, companyName }, 'domain hunt started');

  // ── Stage 1: Free-tier enrichment APIs (Hunter + Apollo + PDL) ──────────
  onProgress({ stage: 'enriching', emailsFound: 0, employeesFound: 0 });
  const enriched = await enrichDomain(domain);
  logger.info({
    domain,
    sources: enriched.sources,
    emails: enriched.emails.length,
    employees: enriched.employees.length,
    pattern: enriched.pattern,
  }, 'enrichment done');
  onProgress({ stage: 'enriched', emailsFound: enriched.emails.length, employeesFound: enriched.employees.length });

  // ── Stage 2: Deep domain crawl (parallel) ────────────────────────────────
  onProgress({ stage: 'crawling', pagesVisited: 0 });
  const crawl = await crawlDomain(domain, 200);
  const allRealEmails = [...new Set([...enriched.emails, ...Array.from(crawl.emails)])];
  logger.info({ domain, pages: crawl.pagesVisited, emails: allRealEmails.length }, 'crawl done');
  onProgress({ stage: 'crawled', pagesVisited: crawl.pagesVisited, emailsFound: allRealEmails.length });

  // ── Stage 3: Detect email pattern ────────────────────────────────────────
  // Hunter.io pattern takes priority if available (most accurate)
  let detected = detectPattern(allRealEmails, domain);
  if (enriched.pattern && detected.confidence < 0.5) {
    // Map Hunter.io pattern format to our PatternType
    const hunterMap: Record<string, PatternType> = {
      '{first}.{last}': 'first.last',
      '{first}{last}':  'firstlast',
      '{f}{last}':      'flast',
      '{first}':        'first',
      '{first}_{last}': 'first_last',
      '{f}.{last}':     'f.last',
    };
    const mapped = hunterMap[enriched.pattern];
    if (mapped) detected = { pattern: mapped, confidence: 0.95, examples: allRealEmails.slice(0, 3) };
  }
  logger.info({ domain, pattern: detected.pattern, confidence: detected.confidence }, 'pattern');
  onProgress({ stage: 'pattern', emailsFound: allRealEmails.length });

  // ── Stage 4: Merge employees from all sources ─────────────────────────────
  onProgress({ stage: 'finding_employees', employeesFound: 0 });

  // Web employee search (Serper-based)
  const webEmployees = await findEmployees(domain, companyName, 300);

  // Merge all sources: enrichment APIs + crawl + web search
  const empMap = new Map<string, { fullName: string; firstName: string; lastName: string; title?: string; source: string; email?: string }>();

  const addEmp = (firstName: string, lastName: string, opts: { title?: string; source: string; email?: string }) => {
    const k = `${firstName.toLowerCase()}+${lastName.toLowerCase()}`;
    if (!empMap.has(k)) {
      empMap.set(k, { fullName: `${firstName} ${lastName}`, firstName, lastName, ...opts });
    } else if (opts.email && !empMap.get(k)!.email) {
      empMap.set(k, { ...empMap.get(k)!, email: opts.email });
    }
  };

  for (const e of enriched.employees) addEmp(e.firstName, e.lastName, { title: e.title, source: e.source, email: e.email });
  for (const e of webEmployees) addEmp(e.firstName, e.lastName, { title: e.title, source: e.source });
  for (const n of crawl.names) {
    const parts = n.name.trim().split(/\s+/);
    if (parts.length >= 2) addEmp(parts[0]!, parts[parts.length - 1]!, { title: n.title ?? undefined, source: n.url ?? 'crawl' });
  }

  const uniqueEmployees = Array.from(empMap.values());
  logger.info({ domain, employees: uniqueEmployees.length }, 'employees merged');
  onProgress({ stage: 'employees_found', employeesFound: uniqueEmployees.length });

  // ── Stage 4: Generate candidates ─────────────────────────────────────────
  const candidateSet = new Set<string>();

  // Add real emails directly (already verified by existing on the site)
  for (const e of allRealEmails) candidateSet.add(e);

  // Generate from pattern × employees
  if (detected.pattern !== 'unknown') {
    for (const emp of uniqueEmployees) {
      const email = applyPattern(detected.pattern, emp.firstName, emp.lastName, domain);
      if (email) candidateSet.add(email);
    }
  }

  // Also generate ALL patterns for top-priority employees (executives, directors)
  const executives = uniqueEmployees.filter(e =>
    /ceo|cto|cfo|coo|vp|vice president|director|president|chief|founder/i.test(e.title ?? '')
  );
  for (const emp of executives) {
    for (const email of generateAllCandidates(emp.firstName, emp.lastName, domain)) {
      candidateSet.add(email);
    }
  }

  // Remove already-verified leads from DB
  const existing = await prisma.lead.findMany({
    where: { teamId, emailNormalized: { in: Array.from(candidateSet).map(e => e.toLowerCase()) } },
    select: { emailNormalized: true },
  });
  const existingSet = new Set(existing.map(e => e.emailNormalized ?? ''));
  const candidates = Array.from(candidateSet).filter(e => !existingSet.has(e.toLowerCase()));

  logger.info({ domain, candidates: candidates.length }, 'candidates to verify');
  onProgress({ stage: 'verifying', candidatesGenerated: candidates.length });

  // ── Stage 5: SMTP verify ──────────────────────────────────────────────────
  const limit = pLimit(8);   // 8 concurrent verifications
  let verified = 0;
  let saved = 0;
  const empByEmail = new Map<string, typeof uniqueEmployees[0]>();

  // Build lookup: email → employee info
  if (detected.pattern !== 'unknown') {
    for (const emp of uniqueEmployees) {
      const email = applyPattern(detected.pattern, emp.firstName, emp.lastName, domain);
      if (email) empByEmail.set(email.toLowerCase(), emp);
    }
  }
  for (const emp of executives) {
    for (const email of generateAllCandidates(emp.firstName, emp.lastName, domain)) {
      empByEmail.set(email.toLowerCase(), emp);
    }
  }

  await Promise.all(candidates.map(email => limit(async () => {
    if (saved >= targetLeads) return;
    try {
      const result = await verifyEmail(email);
      verified++;
      onProgress({ stage: 'verifying', verified, saved, candidatesGenerated: candidates.length });

      if (result.status !== 'VALID' && result.status !== 'RISKY') return;

      const emp = empByEmail.get(email.toLowerCase());
      const domain_ = email.split('@')[1] ?? domain;

      // Persist the lead
      const lead = await prisma.lead.upsert({
        where: { teamId_emailNormalized: { teamId, emailNormalized: email.toLowerCase() } },
        create: {
          teamId,
          jobId,
          email,
          emailNormalized: email.toLowerCase(),
          fullName: emp?.fullName ?? null,
          firstName: emp ? emp.firstName : null,
          lastName: emp ? emp.lastName : null,
          jobTitle: emp?.title ?? null,
          companyName,
          companyDomain: domain_,
          companyWebsite: `https://${domain_}`,
          sourceType: 'COMPANY_PAGE',
          sourceUrl: `https://${domain_}`,
          matchedKeywords: [domain, companyName.toLowerCase()],
          status: 'NEW',
          verificationStatus: result.status,
          emailScore: result.score,
        },
        update: {
          verificationStatus: result.status,
          emailScore: result.score,
          ...(emp?.fullName && !await prisma.lead.findUnique({ where: { teamId_emailNormalized: { teamId, emailNormalized: email.toLowerCase() } }, select: { fullName: true } }).then(l => l?.fullName) ? { fullName: emp.fullName, firstName: emp.firstName, lastName: emp.lastName } : {}),
        },
      });

      // Store verification result
      await prisma.emailVerification.upsert({
        where: { leadId: lead.id },
        create: {
          leadId: lead.id,
          email,
          emailNormalized: email.toLowerCase(),
          syntaxValid: result.syntaxValid,
          isDisposable: result.isDisposable,
          mxValid: result.mxValid,
          mxRecords: result.mxRecords,
          smtpDeliverable: result.smtpDeliverable,
          isCatchAll: result.isCatchAll,
          isRoleAccount: result.isRoleAccount,
          status: result.status,
          score: result.score,
          confidence: result.confidence,
          reason: result.reason,
          durationMs: result.durationMs,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
        update: { status: result.status, score: result.score, durationMs: result.durationMs },
      }).catch(() => {});

      // Enqueue enrichment
      await verificationQueue.add('verify', { leadId: lead.id, email, teamId }).catch(() => {});

      saved++;
      onProgress({ stage: 'verifying', verified, saved, candidatesGenerated: candidates.length });
    } catch (e) {
      logger.debug({ email, err: (e as Error).message }, 'verification failed');
    }
  })));

  // Update job stats
  await prisma.extractionJob.update({
    where: { id: jobId },
    data: { leadsFound: saved, leadsVerified: verified, status: 'COMPLETED', completedAt: new Date(), progress: 100 },
  }).catch(() => {});

  logger.info({ domain, saved, verified, candidates: candidates.length }, 'domain hunt complete');

  return {
    emailsDiscovered: allRealEmails.length,
    employeesFound: uniqueEmployees.length,
    candidatesGenerated: candidates.length,
    verified,
    saved,
    pattern: detected.pattern,
    patternConfidence: detected.confidence,
  };
}
