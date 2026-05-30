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

export default r;
