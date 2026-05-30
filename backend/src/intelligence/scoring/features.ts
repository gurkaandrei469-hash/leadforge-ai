// Feature engineering for the lead scorer.
//
// Extracts a numeric feature vector from a Lead + its graph context. The
// same shape is used by:
//   • the heuristic ensemble scorer (current production)
//   • the LLM scorer (gets the features as a JSON blob in the prompt)
//   • the future trained XGBoost/LightGBM model (loads vector, calls onnx)
//
// Feature vector is intentionally LARGE — the trained model will pick what's
// useful via L1 regularization. For the heuristic we hand-weight a subset.

import type { Lead, Company, EmailVerification, FundingEvent, ExecutiveMove } from '@prisma/client';

export interface LeadFeatures {
  // ── Verification signals ─────────────────────────────────────────────────
  emailValid: number;              // 1 if status=VALID, else 0
  emailRisky: number;
  emailCatchAll: number;
  emailInvalid: number;
  emailScore: number;              // 0..100 normalized to 0..1
  hasSpf: number;
  hasDmarc: number;
  isFreeEmail: number;
  isRoleAccount: number;

  // ── Person signals ──────────────────────────────────────────────────────
  hasFullName: number;
  hasJobTitle: number;
  hasLinkedinUrl: number;
  seniorityVp: number;             // is VP / Director
  seniorityClevel: number;         // is C-level / Founder
  seniorityIc: number;             // is Individual Contributor

  // ── Company-graph signals ───────────────────────────────────────────────
  hasGraphCompany: number;
  companyEmployeeCount: number;    // log-scaled (log10(N+1) / 5)
  companyHasIndustry: number;
  companyHasTechStack: number;
  techStackSize: number;           // log-scaled
  companyFundingTotalUsd: number;  // log10(funding+1) / 10
  companyIsPublic: number;
  companyFoundedYear: number;      // (year - 1990) / 35, clipped 0..1
  recentlyFunded90d: number;       // FundingEvent in last 90 days
  recentExecChange90d: number;     // ExecutiveMove in last 90 days
  companyHasSpf: number;
  companyHasDmarc: number;

  // ── Aggregate / derived ─────────────────────────────────────────────────
  totalSignalCount: number;        // raw count of non-zero features above
}

export interface FeatureInputs {
  lead: Lead;
  company?: (Company & {
    fundingEvents?: FundingEvent[];
    executiveMoves?: ExecutiveMove[];
    technologies?: Array<{ technologyId: string }>;
  }) | null;
  verification?: EmailVerification | null;
}

const SENIOR_VP_RE = /\b(vp|vice\s*president|director|head of|principal|sr|senior)\b/i;
const SENIOR_C_RE = /\b(ceo|cto|cfo|coo|cmo|cpo|ciso|chief|founder|co[- ]?founder|owner|president)\b/i;
const SENIOR_IC_RE = /\b(intern|junior|jr|assistant|associate|engineer\s*i\b|developer\s*i\b)\b/i;

export function extractFeatures(input: FeatureInputs): LeadFeatures {
  const { lead, company, verification } = input;

  const title = lead.jobTitle ?? '';
  const seniorityVp = SENIOR_VP_RE.test(title) ? 1 : 0;
  const seniorityClevel = SENIOR_C_RE.test(title) ? 1 : 0;
  const seniorityIc = SENIOR_IC_RE.test(title) ? 1 : 0;

  const status = lead.verificationStatus;
  const f: LeadFeatures = {
    emailValid:        status === 'VALID' ? 1 : 0,
    emailRisky:        status === 'RISKY' ? 1 : 0,
    emailCatchAll:     status === 'CATCH_ALL' ? 1 : 0,
    emailInvalid:      status === 'INVALID' ? 1 : 0,
    emailScore:        (lead.emailScore ?? 0) / 100,
    hasSpf:            inferBoolFromReason(verification?.reason, 'spf'),
    hasDmarc:          inferBoolFromReason(verification?.reason, 'dmarc'),
    isFreeEmail:       inferBoolFromReason(verification?.reason, 'free'),
    isRoleAccount:     verification?.isRoleAccount ? 1 : 0,

    hasFullName:       lead.fullName ? 1 : 0,
    hasJobTitle:       lead.jobTitle ? 1 : 0,
    hasLinkedinUrl:    lead.linkedinUrl ? 1 : 0,
    seniorityVp, seniorityClevel, seniorityIc,

    hasGraphCompany:   company ? 1 : 0,
    companyEmployeeCount: company?.employeeCount
      ? Math.min(1, Math.log10((company.employeeCount + 1)) / 5)
      : 0,
    companyHasIndustry: company?.industryId ? 1 : 0,
    companyHasTechStack: (company?.technologies?.length ?? 0) > 0 ? 1 : 0,
    techStackSize: company?.technologies?.length
      ? Math.min(1, Math.log10((company.technologies.length + 1)) / 1.5)
      : 0,
    companyFundingTotalUsd: company?.totalFundingUsd
      ? Math.min(1, Math.log10(Number(company.totalFundingUsd) + 1) / 10)
      : 0,
    companyIsPublic:    company?.isPublic ? 1 : 0,
    companyFoundedYear: company?.foundedYear
      ? Math.max(0, Math.min(1, (company.foundedYear - 1990) / 35))
      : 0,
    recentlyFunded90d: company?.fundingEvents?.some(
      (e) => e.announcedOn.getTime() > Date.now() - 90 * 86400_000
    ) ? 1 : 0,
    recentExecChange90d: company?.executiveMoves?.some(
      (m) => m.announcedOn.getTime() > Date.now() - 90 * 86400_000
    ) ? 1 : 0,
    companyHasSpf:   company?.hasSpf ? 1 : 0,
    companyHasDmarc: company?.hasDmarc ? 1 : 0,
    totalSignalCount: 0,  // filled below
  };

  // Count signals — used by the heuristic to break ties between two leads
  // that look similar on every individual axis.
  let count = 0;
  for (const [k, v] of Object.entries(f)) {
    if (k === 'totalSignalCount') continue;
    if (typeof v === 'number' && v > 0) count++;
  }
  f.totalSignalCount = count;

  return f;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** The verifier writes structured tokens into the `reason` column (e.g.
 *  "free_email: managed:google,spf,dmarc"). We extract booleans from there
 *  without a schema migration. */
function inferBoolFromReason(reason: string | null | undefined, token: string): number {
  if (!reason) return 0;
  return new RegExp(`\\b${token}\\b`, 'i').test(reason) ? 1 : 0;
}
