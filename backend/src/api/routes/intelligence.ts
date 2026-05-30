// Public API for the lead intelligence pipeline.
//
// Endpoints:
//   POST /api/v1/intelligence/enrich   { domain }
//        Returns firmographics for a company domain (synchronous).
//
//   POST /api/v1/intelligence/intent   { companyName }
//        Returns recent intent signals + a 0-100 intent score.
//
//   POST /api/v1/intelligence/score    { leadId, icpDescription? }
//        Runs the full pipeline on an existing lead and returns the new
//        score + tier + reasons.
//
//   POST /api/v1/intelligence/dedup    { fullName?, email?, linkedinUrl?, companyName?, companyDomain? }
//        Tries to find an existing lead in the workspace that matches.
//        Used by the AI assistant before creating a new lead.

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { enrichCompany } from '../../intelligence/enrichment/company.js';
import { detectIntentSignals, intentScore } from '../../intelligence/intent/signals.js';
import { runIntelligence } from '../../intelligence/orchestrator.js';
import { resolveLead } from '../../intelligence/matching/resolver.js';
import { generateRankedEmails } from '../../intelligence/email-discovery/patterns.js';
import { extractEntities } from '../../intelligence/ner/extractor.js';
import { enqueue as enqueueCrawl, stats as crawlStats } from '../../intelligence/crawling/frontier.js';
import { queryLeads, graphStats } from '../../intelligence/graph/query.js';
import { recordFeedback, feedbackStats } from '../../intelligence/scoring/feedback.js';

const r = Router();

// ── Company enrichment ───────────────────────────────────────────────────
r.post('/enrich', authenticate, async (req, res, next) => {
  try {
    const { domain } = z.object({ domain: z.string().min(3) }).parse(req.body);
    const firmographics = await enrichCompany(domain);
    res.json({ firmographics });
  } catch (e) { next(e); }
});

// ── Intent signal detection ──────────────────────────────────────────────
r.post('/intent', authenticate, async (req, res, next) => {
  try {
    const { companyName } = z.object({ companyName: z.string().min(2) }).parse(req.body);
    const signals = await detectIntentSignals(companyName);
    const { score, topKinds } = intentScore(signals);
    res.json({ signals, score, topKinds });
  } catch (e) { next(e); }
});

// ── Full intelligence run on a known lead ────────────────────────────────
r.post('/score', authenticate, async (req, res, next) => {
  try {
    const { leadId, icpDescription } = z.object({
      leadId: z.string(),
      icpDescription: z.string().max(2000).optional(),
    }).parse(req.body);
    const result = await runIntelligence(leadId, { icpDescription });
    res.json(result);
  } catch (e) { next(e); }
});

// ── Duplicate detection ─────────────────────────────────────────────────
r.post('/dedup', authenticate, async (req, res, next) => {
  try {
    const candidate = z.object({
      fullName: z.string().optional(),
      email: z.string().email().optional(),
      linkedinUrl: z.string().url().optional(),
      companyName: z.string().optional(),
      companyDomain: z.string().optional(),
    }).parse(req.body);

    const result = await resolveLead(req.auth!.teamId, candidate);
    res.json({
      duplicate: result.match ? {
        leadId: result.match.id,
        email: result.match.email,
        fullName: result.match.fullName,
        companyName: result.match.companyName,
      } : null,
      reason: result.reason,
      confidence: result.confidence,
    });
  } catch (e) { next(e); }
});

// ── Email pattern prediction ────────────────────────────────────────────
r.post('/predict-emails', authenticate, async (req, res, next) => {
  try {
    const { firstName, lastName, middleName, domain, limit } = z.object({
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      middleName: z.string().optional(),
      domain: z.string().min(3),
      limit: z.number().int().min(1).max(20).default(8),
    }).parse(req.body);

    const ranked = await generateRankedEmails(
      { first: firstName, last: lastName, middle: middleName },
      domain,
      limit,
    );
    res.json({ predictions: ranked });
  } catch (e) { next(e); }
});

// ── NER — extract structured entities from arbitrary text ────────────────
r.post('/ner', authenticate, async (req, res, next) => {
  try {
    const { text } = z.object({ text: z.string().min(20).max(50_000) }).parse(req.body);
    const entities = await extractEntities(text);
    res.json({ entities });
  } catch (e) { next(e); }
});

// ── Crawler frontier — enqueue URLs + view stats ────────────────────────
r.post('/crawl/enqueue', authenticate, async (req, res, next) => {
  try {
    const { urls, jobId, priority } = z.object({
      urls: z.array(z.string().url()).min(1).max(1000),
      jobId: z.string().optional(),
      priority: z.number().int().min(1).max(10).optional(),
    }).parse(req.body);
    const added = await enqueueCrawl(urls.map((u) => ({ url: u, jobId, priority })));
    res.json({ added, requested: urls.length });
  } catch (e) { next(e); }
});

r.get('/crawl/stats', authenticate, async (_req, res, next) => {
  try {
    res.json(await crawlStats());
  } catch (e) { next(e); }
});

// ── Knowledge graph — typed lead search ─────────────────────────────────
r.post('/graph/search', authenticate, async (req, res, next) => {
  try {
    const body = z.object({
      jobSeniority: z.array(z.string()).optional(),
      jobDepartment: z.array(z.string()).optional(),
      verificationStatus: z.array(z.enum(['VALID', 'INVALID', 'RISKY', 'CATCH_ALL', 'UNKNOWN'])).optional(),
      minQualityScore: z.number().int().min(0).max(100).optional(),
      industrySlug: z.array(z.string()).optional(),
      usesTech: z.array(z.string()).optional(),
      usesAllTech: z.array(z.string()).optional(),
      excludeTech: z.array(z.string()).optional(),
      employeeMin: z.number().int().min(0).optional(),
      employeeMax: z.number().int().min(0).optional(),
      hqCountry: z.array(z.string()).optional(),
      fundedWithinDays: z.number().int().min(1).max(3650).optional(),
      execChangeWithinDays: z.number().int().min(1).max(3650).optional(),
      foundedAfter: z.number().int().min(1800).max(2100).optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(200).optional(),
      sortBy: z.enum(['qualityScore', 'createdAt', 'companyEmployees', 'lastFunding']).optional(),
      sortOrder: z.enum(['asc', 'desc']).optional(),
    }).parse(req.body);
    const result = await queryLeads({ teamId: req.auth!.teamId, ...body });
    res.json(result);
  } catch (e) { next(e); }
});

r.get('/graph/stats', authenticate, async (req, res, next) => {
  try {
    res.json(await graphStats(req.auth!.teamId));
  } catch (e) { next(e); }
});

// ── Score feedback — user labels for ML retraining ──────────────────────
r.post('/feedback', authenticate, async (req, res, next) => {
  try {
    const body = z.object({
      leadId: z.string(),
      kind: z.enum([
        'HELPFUL', 'NOT_HELPFUL',
        'WRONG_INDUSTRY', 'WRONG_ROLE', 'TOO_SMALL', 'TOO_BIG',
        'ALREADY_CUSTOMER', 'BAD_FIT',
        'REPLIED_POSITIVELY', 'REPLIED_NEGATIVELY', 'IGNORED',
      ]),
      notes: z.string().max(4000).optional(),
    }).parse(req.body);
    const created = await recordFeedback({
      teamId: req.auth!.teamId,
      leadId: body.leadId,
      userId: req.auth!.userId,
      kind: body.kind,
      notes: body.notes,
    });
    res.json(created);
  } catch (e) { next(e); }
});

r.get('/feedback/stats', authenticate, async (req, res, next) => {
  try {
    res.json(await feedbackStats(req.auth!.teamId));
  } catch (e) { next(e); }
});

export default r;
