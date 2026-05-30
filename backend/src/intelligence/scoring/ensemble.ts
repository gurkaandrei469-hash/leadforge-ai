// Ensemble scorer — combines multiple weak scorers into a single tier.
//
// Two scorers contribute:
//   1. Heuristic — linear combination of hand-tuned feature weights. Fast
//      (no API call), deterministic, runs everywhere. Good baseline.
//   2. LLM — gpt-4o-mini / Groq Llama 3.3 reads the feature bag + the user's
//      ICP description and applies a soft, narrative judgment.
//
// The ensemble averages them with weights that adapt to how much corroborating
// signal we have. When the feature vector is sparse (lead just extracted, no
// company yet), the LLM dominates. When the feature vector is rich (full
// firmographic + intent + verification), the heuristic dominates because we
// trust the hard signals more than a model's opinion.
//
// Future: replace the heuristic block with `predict(featureVector)` calling
// an XGBoost model loaded via onnxruntime-node. The ensemble logic stays
// identical — only the predictor implementation changes.

import { extractFeatures, type LeadFeatures, type FeatureInputs } from './features.js';
import { scoreLead as scoreLeadViaLlm, type LeadScoreResult } from './ai-scorer.js';

// ─── Heuristic weights ──────────────────────────────────────────────────────
// These are calibrated against the same A/B/C/D rubric the LLM uses, so the
// two scorers produce comparable scores. Hand-tuned; will be replaced by an
// XGBoost model once we have ≥1000 user feedback labels.
const WEIGHTS: Partial<Record<keyof LeadFeatures, number>> = {
  emailValid:               12,
  emailRisky:                4,
  emailCatchAll:            -3,
  emailInvalid:            -30,
  hasSpf:                    2,
  hasDmarc:                  3,
  isFreeEmail:              -5,
  isRoleAccount:            -3,

  hasFullName:               4,
  hasJobTitle:               4,
  hasLinkedinUrl:            3,
  seniorityClevel:          15,
  seniorityVp:              10,
  seniorityIc:              -5,

  hasGraphCompany:           5,
  companyEmployeeCount:     15,    // multiplied by the log-normalized 0..1
  companyHasIndustry:        3,
  companyHasTechStack:       3,
  techStackSize:             5,
  companyFundingTotalUsd:    8,
  companyIsPublic:           5,
  companyFoundedYear:        2,
  recentlyFunded90d:        12,
  recentExecChange90d:      10,
  companyHasSpf:             1,
  companyHasDmarc:           2,
};

function heuristicScore(features: LeadFeatures): { score: number; reasons: string[] } {
  let s = 50; // neutral start
  const contribs: Array<[string, number]> = [];
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const value = features[key as keyof LeadFeatures] ?? 0;
    if (value === 0) continue;
    const contribution = value * (weight as number);
    s += contribution;
    if (Math.abs(contribution) >= 5) contribs.push([key, contribution]);
  }
  const score = Math.max(0, Math.min(100, Math.round(s)));
  contribs.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const reasons = contribs.slice(0, 3).map(([k, c]) =>
    `${humanLabel(k)} (${c >= 0 ? '+' : ''}${c.toFixed(0)})`
  );
  return { score, reasons };
}

const HUMAN_LABEL: Record<string, string> = {
  emailValid: 'Verified email',
  emailInvalid: 'Email failed verification',
  seniorityClevel: 'C-level / Founder',
  seniorityVp: 'VP / Director seniority',
  seniorityIc: 'Junior role',
  companyEmployeeCount: 'Company size',
  recentlyFunded90d: 'Recent funding',
  recentExecChange90d: 'Recent executive change',
  companyFundingTotalUsd: 'Significant total funding',
  isFreeEmail: 'Free email provider',
  isRoleAccount: 'Shared role account',
  companyIsPublic: 'Public company',
  techStackSize: 'Rich tech stack',
};
function humanLabel(k: string): string { return HUMAN_LABEL[k] ?? k; }

function tierFromScore(s: number): LeadScoreResult['status'] {
  if (s >= 85) return 'A';
  if (s >= 70) return 'B';
  if (s >= 55) return 'C';
  return 'D';
}

// ─── Ensemble entry point ──────────────────────────────────────────────────

export interface EnsembleInput extends FeatureInputs {
  icpDescription?: string;
  /** When true, we skip the LLM call. Useful for bulk scoring where the user
   *  cares about throughput more than fine-grained judgment. */
  skipLlm?: boolean;
}

export interface EnsembleResult extends LeadScoreResult {
  /** The raw feature vector — persisted as feedback metadata so future model
   *  retraining can replay exactly what the scorer saw. */
  features: LeadFeatures;
  heuristicScore: number;
  llmScore: number | null;
}

export async function ensembleScore(input: EnsembleInput): Promise<EnsembleResult> {
  const features = extractFeatures(input);
  const heuristic = heuristicScore(features);

  // LLM contribution — optional
  let llmScore: number | null = null;
  let llmReasons: string[] = [];
  let llmRedFlags: string[] = [];
  if (!input.skipLlm) {
    try {
      const llm = await scoreLeadViaLlm({
        lead: input.lead,
        firmographics: input.company ? graphCompanyToFirmographics(input.company) : undefined,
        intentSignals: [], // intent already feeds the features via recentlyFunded90d etc.
        icpDescription: input.icpDescription,
      });
      llmScore = llm.score;
      llmReasons = llm.reasons;
      llmRedFlags = llm.redFlags;
    } catch {
      // LLM call failed — fall back to heuristic-only. Not fatal.
    }
  }

  // Adaptive weighting: more data → trust heuristic more
  const richness = features.totalSignalCount / Object.keys(WEIGHTS).length;
  const heuristicWeight = Math.min(0.85, 0.4 + richness * 0.5);
  const llmWeight = 1 - heuristicWeight;

  const finalScore = Math.round(
    llmScore !== null
      ? heuristic.score * heuristicWeight + llmScore * llmWeight
      : heuristic.score
  );

  const reasons = [...heuristic.reasons];
  for (const r of llmReasons) if (reasons.length < 5 && !reasons.includes(r)) reasons.push(r);

  return {
    score: finalScore,
    status: tierFromScore(finalScore),
    reasons,
    redFlags: llmRedFlags,
    features,
    heuristicScore: heuristic.score,
    llmScore,
  };
}

// ─── Helper: graph Company → CompanyFirmographics for the LLM scorer ──────

function graphCompanyToFirmographics(c: NonNullable<FeatureInputs['company']>): any {
  return {
    domain: c.domain,
    name: c.name ?? undefined,
    description: c.description ?? undefined,
    industry: undefined, // industry is by-id on the graph; the LLM scorer cares about the name though
    employeeCount: c.employeeCount ?? undefined,
    employeeRange: c.employeeRange ?? undefined,
    foundedYear: c.foundedYear ?? undefined,
    headquartersCity: c.hqCity ?? undefined,
    headquartersCountry: c.hqCountry ?? undefined,
    totalFundingUSD: c.totalFundingUsd ? Number(c.totalFundingUsd) : undefined,
    technologies: [],   // shallow — TODO populate from technologies join
    hasSpf: c.hasSpf,
    hasDmarc: c.hasDmarc,
    sources: c.enrichmentSources ?? [],
  };
}
