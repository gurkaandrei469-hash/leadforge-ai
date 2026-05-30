// LLM-driven lead scoring.
//
// Builds a feature vector for each lead from all the signals we've gathered
// (firmographics, verification result, intent signals, ICP fit), then asks
// the LLM (Groq Llama 3.3 70B by default, OpenRouter or Anthropic as
// fallback) to combine them into a calibrated 0-100 score with a rubric.
//
// Why LLM instead of XGBoost/LightGBM?
//   • We don't have labeled training data yet (no historical
//     send-and-reply pairs to learn from)
//   • The features are mixed structured + textual (industry name, job title)
//     and LLMs handle that better out of the box
//   • A single LLM call per lead is cheap (~$0.0002 on Groq free tier)
//   • Easy to A/B test rubrics — just edit the prompt
//
// Once we have ~10k closed-loop send→reply records we can train a smaller
// XGBoost on the same features and replace this with a model that's 100×
// faster and just as accurate.

import { runLlm } from '../../services/llm-router.js';
import type { Lead } from '@prisma/client';
import type { CompanyFirmographics } from '../enrichment/company.js';
import type { IntentSignal } from '../intent/signals.js';

export interface LeadFeatures {
  lead: Pick<Lead, 'id' | 'email' | 'fullName' | 'jobTitle' | 'companyName' | 'companyDomain' | 'country' | 'verificationStatus' | 'technologies'>;
  firmographics?: CompanyFirmographics;
  intentSignals?: IntentSignal[];
  /** Optional ICP description — what does a "good" lead look like for this user. */
  icpDescription?: string;
}

export interface LeadScoreResult {
  score: number;          // 0..100
  status: 'A' | 'B' | 'C' | 'D';
  reasons: string[];
  redFlags: string[];
}

const SYSTEM_PROMPT = `You are a senior B2B sales operations analyst grading lead quality.

You will receive structured data about a single lead — their job title, company, firmographics, technographics, intent signals, and email-verification status. Your job is to produce a calibrated 0-100 score AND a tier (A/B/C/D).

SCORING RUBRIC
- 90-100 (A): Decision-maker at an ICP-fit company with strong intent signals. Email is verified VALID.
- 75-89 (B): Likely decision-maker or influencer at an ICP-fit company, OR a strong fit with no recent intent. Email VALID or RISKY-business.
- 60-74 (C): Plausible target but with caveats — role account, unclear job title, free email, generic firmographics, no intent signals.
- 0-59  (D): Poor fit — wrong industry, junior role, unverifiable email, disposable domain, suspicious pattern.

REASONS
Return 2-4 short bullet reasons explaining the score. Be specific — cite the actual signals you saw.

RED FLAGS
Return 0-3 specific concerns that should make the user hesitate before adding this lead to a campaign.

Respond with ONLY valid JSON in this exact shape:
{
  "score": <integer 0-100>,
  "status": "A" | "B" | "C" | "D",
  "reasons": ["..."],
  "redFlags": ["..."]
}`;

export async function scoreLead(features: LeadFeatures): Promise<LeadScoreResult> {
  const userMessage = buildUserMessage(features);
  try {
    const response = await runLlm({
      system: SYSTEM_PROMPT,
      user: userMessage,
      maxTokens: 400,
      temperature: 0.2,
      jsonMode: true,
    });
    return parseResponse(response);
  } catch (err) {
    // Graceful degradation — fall back to a deterministic score from the
    // verification status alone so a missing LLM provider doesn't break
    // extraction jobs.
    return fallbackScore(features);
  }
}

function buildUserMessage(f: LeadFeatures): string {
  const parts: string[] = [];

  parts.push('LEAD');
  parts.push(`Name: ${f.lead.fullName ?? '(unknown)'}`);
  parts.push(`Email: ${f.lead.email ?? '(missing)'}`);
  parts.push(`Job title: ${f.lead.jobTitle ?? '(unknown)'}`);
  parts.push(`Country: ${f.lead.country ?? '(unknown)'}`);
  parts.push(`Email verification: ${f.lead.verificationStatus}`);
  if (f.lead.technologies && f.lead.technologies.length) {
    parts.push(`Lead-page detected tech: ${f.lead.technologies.join(', ')}`);
  }

  parts.push('');
  parts.push('COMPANY');
  parts.push(`Name: ${f.firmographics?.name ?? f.lead.companyName ?? '(unknown)'}`);
  parts.push(`Domain: ${f.lead.companyDomain ?? f.firmographics?.domain ?? '(unknown)'}`);
  if (f.firmographics?.industry) parts.push(`Industry: ${f.firmographics.industry}`);
  if (f.firmographics?.employeeRange) parts.push(`Employees: ${f.firmographics.employeeRange}`);
  if (f.firmographics?.foundedYear) parts.push(`Founded: ${f.firmographics.foundedYear}`);
  if (f.firmographics?.totalFundingUSD) parts.push(`Total funding: $${f.firmographics.totalFundingUSD.toLocaleString()}`);
  if (f.firmographics?.technologies?.length) {
    parts.push(`Company tech stack: ${f.firmographics.technologies.join(', ')}`);
  }
  if (f.firmographics?.hasSpf && f.firmographics?.hasDmarc) {
    parts.push('Domain auth: SPF + DMARC published (legit operation)');
  }

  if (f.intentSignals && f.intentSignals.length) {
    parts.push('');
    parts.push('INTENT SIGNALS (recent)');
    for (const s of f.intentSignals.slice(0, 5)) {
      parts.push(`- [${s.kind}] ${s.headline}`);
    }
  }

  if (f.icpDescription) {
    parts.push('');
    parts.push('USER ICP DESCRIPTION');
    parts.push(f.icpDescription);
  }

  return parts.join('\n');
}

function parseResponse(text: string): LeadScoreResult {
  // Strip code fences if the model wrapped the JSON in markdown
  const cleaned = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  const parsed = JSON.parse(cleaned);
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
  const status = (['A', 'B', 'C', 'D'] as const).includes(parsed.status) ? parsed.status : tierFromScore(score);
  const reasons = Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 5).map(String) : [];
  const redFlags = Array.isArray(parsed.redFlags) ? parsed.redFlags.slice(0, 5).map(String) : [];
  return { score, status, reasons, redFlags };
}

function tierFromScore(s: number): LeadScoreResult['status'] {
  if (s >= 90) return 'A';
  if (s >= 75) return 'B';
  if (s >= 60) return 'C';
  return 'D';
}

function fallbackScore(f: LeadFeatures): LeadScoreResult {
  // Static fallback used when the LLM call fails. Conservative — never claims
  // higher than C tier without LLM corroboration.
  let s = 50;
  if (f.lead.verificationStatus === 'VALID') s += 15;
  if (f.lead.verificationStatus === 'INVALID') s -= 30;
  if (f.firmographics?.industry) s += 5;
  if (f.firmographics?.employeeCount && f.firmographics.employeeCount > 50) s += 5;
  if (f.intentSignals && f.intentSignals.length > 0) s += 10;
  s = Math.max(0, Math.min(100, s));
  return {
    score: s,
    status: tierFromScore(s),
    reasons: ['Scored without LLM (fallback)'],
    redFlags: [],
  };
}
