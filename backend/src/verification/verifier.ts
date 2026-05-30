// Multi-signal email verification.
//
// The classic SMTP RCPT-TO probe (used by Hunter, NeverBounce, etc.) doesn't
// work in this deployment because Railway/Render/Fly/AWS-EC2-free-tier all
// block outbound port 25 to prevent spam abuse. Doing it anyway would mean
// every email comes back UNKNOWN — which is what was happening (every lead
// scored ~60 because the SMTP step returned null and scoring fell back to
// "we don't know").
//
// Instead, we combine every signal we CAN get reliably from DNS + structural
// analysis of the email itself, and produce a calibrated confidence score.
// The signals (with their relative weight in the scoring):
//
//   • Syntax + RFC-compliance      (hard gate — fails → INVALID)
//   • Disposable provider list     (hard gate — true → INVALID)
//   • MX record validity            (hard gate — no MX → INVALID)
//   • MX provider classification    (Google/MS = high confidence)
//   • SPF + DMARC publication       (signals legit org operation)
//   • DMARC enforcement policy      (reject > quarantine > none)
//   • Free vs business email        (business = higher confidence)
//   • Role-account localpart        (info@, sales@ — RISKY)
//   • Catch-all heuristic           (no SPF + non-major MX → likely)
//   • Suspicious-pattern detection  (test@, qwerty@, etc.)
//   • Typo correction suggestion    (gmial.com → gmail.com)
//
// The output remains the same VerificationResult shape so the database
// schema doesn't change.

import { checkSyntax } from './syntax.js';
import { isDisposable } from './disposable.js';
import { lookupMx } from './mx.js';
import { score } from './scoring.js';
import {
  classifyMxProvider, hasStrongMxValidation, type MxProvider,
  isFreeEmail, isSuspiciousLocalpart, lookupDomainAuth, suggestTypoFix,
} from './signals.js';

export interface VerificationResult {
  email: string;
  emailNormalized: string;
  syntaxValid: boolean;
  isDisposable: boolean;
  mxValid: boolean;
  mxRecords: string[];
  mxProvider: MxProvider;
  hasSpf: boolean;
  hasDmarc: boolean;
  dmarcPolicy: 'none' | 'quarantine' | 'reject' | null;
  isFreeEmail: boolean;
  isRoleAccount: boolean;
  isSuspicious: boolean;
  smtpDeliverable: boolean | null;   // retained for schema compatibility — always null now
  isCatchAll: boolean | null;         // inferred from signals
  typoSuggestion: string | null;
  score: number;
  status: 'VALID' | 'INVALID' | 'RISKY' | 'CATCH_ALL' | 'UNKNOWN';
  confidence: number;
  reason: string;
  durationMs: number;
}

export async function verifyEmail(rawEmail: string): Promise<VerificationResult> {
  const t0 = Date.now();
  const syntax = checkSyntax(rawEmail);

  // Hard gate 1: syntax
  if (!syntax.valid || !syntax.normalized) {
    return buildResult(rawEmail, rawEmail.toLowerCase(), {
      syntaxValid: false,
      score: { score: 0, status: 'INVALID', confidence: 1, reason: 'syntax_invalid' },
      durationMs: Date.now() - t0,
    });
  }

  const normalized = syntax.normalized;
  const [local, domain] = normalized.split('@') as [string, string];

  // Hard gate 2: disposable
  const disposable = isDisposable(domain);
  if (disposable) {
    return buildResult(rawEmail, normalized, {
      syntaxValid: true,
      isDisposable: true,
      isRoleAccount: syntax.isRole,
      score: { score: 5, status: 'INVALID', confidence: 0.95, reason: 'disposable' },
      durationMs: Date.now() - t0,
    });
  }

  // Typo correction suggestion (informational — doesn't gate)
  const typoSuggestion = suggestTypoFix(domain);

  // Gather all DNS-based signals in parallel
  const [mx, auth] = await Promise.all([
    lookupMx(domain),
    lookupDomainAuth(domain),
  ]);

  // Hard gate 3: domain has no MX → no mailbox can exist
  if (!mx.valid) {
    return buildResult(rawEmail, normalized, {
      syntaxValid: true,
      isRoleAccount: syntax.isRole,
      typoSuggestion,
      score: { score: 10, status: 'INVALID', confidence: 0.95, reason: 'no_mx_records' },
      durationMs: Date.now() - t0,
    });
  }

  const mxProvider = classifyMxProvider(mx.records);
  const free = isFreeEmail(domain);
  const suspicious = isSuspiciousLocalpart(local);

  // Catch-all heuristic. We can't probe SMTP, but we can infer:
  //   • Domains on managed providers (Google/MS/Zoho) are USUALLY not catch-all
  //   • Domains without SPF/DMARC and with a generic MX (cPanel, hosting
  //     providers) are MORE likely to be catch-all
  // null means "we don't know definitively" — scoring treats that as neutral.
  const isCatchAll =
    !hasStrongMxValidation(mxProvider) && !auth.hasSpf
      ? true            // strong likely-catch-all signal
      : hasStrongMxValidation(mxProvider)
        ? false         // strong NOT-catch-all signal
        : null;          // genuinely unknown

  // Compose the verdict
  const sc = score({
    syntaxValid: true,
    isDisposable: false,
    mxValid: true,
    mxProvider,
    hasSpf: auth.hasSpf,
    hasDmarc: auth.hasDmarc,
    dmarcPolicy: auth.dmarcPolicy,
    isFreeEmail: free,
    isRoleAccount: syntax.isRole,
    isSuspicious: suspicious,
    isCatchAll,
  });

  return buildResult(rawEmail, normalized, {
    syntaxValid: true,
    mxValid: true,
    mxRecords: mx.records,
    mxProvider,
    hasSpf: auth.hasSpf,
    hasDmarc: auth.hasDmarc,
    dmarcPolicy: auth.dmarcPolicy,
    isFreeEmail: free,
    isRoleAccount: syntax.isRole,
    isSuspicious: suspicious,
    isCatchAll,
    typoSuggestion,
    score: sc,
    durationMs: Date.now() - t0,
  });
}

// ─── result helper ──────────────────────────────────────────────────────────

interface Partial {
  syntaxValid?: boolean;
  isDisposable?: boolean;
  mxValid?: boolean;
  mxRecords?: string[];
  mxProvider?: MxProvider;
  hasSpf?: boolean;
  hasDmarc?: boolean;
  dmarcPolicy?: 'none' | 'quarantine' | 'reject' | null;
  isFreeEmail?: boolean;
  isRoleAccount?: boolean;
  isSuspicious?: boolean;
  isCatchAll?: boolean | null;
  typoSuggestion?: string | null;
  score: { score: number; status: VerificationResult['status']; confidence: number; reason: string };
  durationMs: number;
}

function buildResult(rawEmail: string, normalized: string, p: Partial): VerificationResult {
  return {
    email: rawEmail,
    emailNormalized: normalized,
    syntaxValid: p.syntaxValid ?? false,
    isDisposable: p.isDisposable ?? false,
    mxValid: p.mxValid ?? false,
    mxRecords: p.mxRecords ?? [],
    mxProvider: p.mxProvider ?? 'OTHER',
    hasSpf: p.hasSpf ?? false,
    hasDmarc: p.hasDmarc ?? false,
    dmarcPolicy: p.dmarcPolicy ?? null,
    isFreeEmail: p.isFreeEmail ?? false,
    isRoleAccount: p.isRoleAccount ?? false,
    isSuspicious: p.isSuspicious ?? false,
    smtpDeliverable: null,                     // never used now — port 25 blocked in cloud
    isCatchAll: p.isCatchAll ?? null,
    typoSuggestion: p.typoSuggestion ?? null,
    score: p.score.score,
    status: p.score.status,
    confidence: p.score.confidence,
    reason: p.score.reason,
    durationMs: p.durationMs,
  };
}
