// Composite scoring — combines every signal we have into a single 0-100 score
// plus a VALID / CATCH_ALL / RISKY / UNKNOWN / INVALID status label.
//
// Calibration philosophy:
//   • 95-100 = "I would mail-merge this without a second thought"
//   • 80-94  = "Probably good, may bounce occasionally"
//   • 60-79  = "Risky — role accounts, free emails, weak signals"
//   • 40-59  = "Don't bulk-mail this, manually review"
//   • 0-39   = "Don't send"
//
// We do NOT use port-25 SMTP probes — every cloud blocks them and that step
// would always return null, causing every lead to score ~50 (the symptom the
// user was seeing where every row showed Score 60). Instead we build confidence
// from DNS hygiene + MX provider reputation + structural signals.

import type { MxProvider } from './signals.js';

interface ScoreInput {
  syntaxValid: boolean;
  isDisposable: boolean;
  mxValid: boolean;
  mxProvider?: MxProvider;
  hasSpf?: boolean;
  hasDmarc?: boolean;
  dmarcPolicy?: 'none' | 'quarantine' | 'reject' | null;
  isFreeEmail?: boolean;
  isRoleAccount?: boolean;
  isSuspicious?: boolean;
  isCatchAll?: boolean | null;
}

export interface Score {
  score: number;
  status: 'VALID' | 'INVALID' | 'RISKY' | 'CATCH_ALL' | 'UNKNOWN';
  confidence: number;
  reason: string;
}

export function score(input: ScoreInput): Score {
  // ─── Hard gates (terminal verdicts) ───────────────────────────────────
  if (!input.syntaxValid) return { score: 0, status: 'INVALID', confidence: 1.0, reason: 'syntax_invalid' };
  if (input.isDisposable) return { score: 5, status: 'INVALID', confidence: 0.95, reason: 'disposable_provider' };
  if (!input.mxValid)     return { score: 10, status: 'INVALID', confidence: 0.95, reason: 'no_mx_records' };
  if (input.isSuspicious) return { score: 15, status: 'INVALID', confidence: 0.85, reason: 'suspicious_localpart' };

  // ─── Confidence build-up ──────────────────────────────────────────────
  // Start at 60 (we know syntax + MX are good, so it's "probably real")
  // and adjust based on each additional signal.
  let s = 60;
  const reasons: string[] = [];

  // MX provider — the strongest single signal we have without SMTP.
  // Domains on Google/Microsoft/etc. enforce real address validation
  // and don't typically run catch-alls.
  const strongMx = input.mxProvider === 'GOOGLE' || input.mxProvider === 'MICROSOFT'
                || input.mxProvider === 'ZOHO'   || input.mxProvider === 'PROTONMAIL'
                || input.mxProvider === 'FASTMAIL';
  if (strongMx) {
    s += 20;
    reasons.push(`managed:${input.mxProvider!.toLowerCase()}`);
  } else if (input.mxProvider === 'OTHER') {
    s -= 5;
    reasons.push('mx:generic');
  }

  // SPF — a basic table-stakes signal of legit operation
  if (input.hasSpf) {
    s += 5;
    reasons.push('spf');
  } else {
    s -= 5;
    reasons.push('no_spf');
  }

  // DMARC — stronger signal, and the policy matters
  if (input.hasDmarc) {
    s += 5;
    reasons.push('dmarc');
    if (input.dmarcPolicy === 'reject')          s += 5;
    else if (input.dmarcPolicy === 'quarantine') s += 3;
  } else {
    s -= 5;
    reasons.push('no_dmarc');
  }

  // Role accounts reach a real shared inbox but the open/reply rates
  // are notoriously bad. We mark them RISKY rather than INVALID.
  if (input.isRoleAccount) {
    reasons.push('role_account');
    return clamp({
      score: Math.min(s, 78),
      status: 'RISKY',
      confidence: 0.78,
      reason: 'role_account: ' + reasons.join(','),
    });
  }

  // Free email providers are real mailboxes but low-quality B2B leads.
  if (input.isFreeEmail) {
    reasons.push('free_provider');
    return clamp({
      score: Math.min(s, 75),
      status: 'RISKY',
      confidence: 0.8,
      reason: 'free_email: ' + reasons.join(','),
    });
  }

  // Catch-all inference — without SMTP, we use auth + MX signals: a domain
  // WITHOUT SPF on a generic MX is very likely accepting all addresses
  // (typical hosting-default behavior).
  if (input.isCatchAll === true) {
    reasons.push('inferred_catch_all');
    return clamp({
      score: Math.min(s, 70),
      status: 'CATCH_ALL',
      confidence: 0.65,
      reason: 'inferred_catch_all: ' + reasons.join(','),
    });
  }

  // ─── Default "good business email" verdict ────────────────────────────
  return clamp({
    score: s,
    status: s >= 80 ? 'VALID' : s >= 60 ? 'RISKY' : 'UNKNOWN',
    confidence: s >= 85 ? 0.9 : s >= 70 ? 0.78 : 0.55,
    reason: reasons.join(','),
  });
}

function clamp(r: Score): Score {
  return { ...r, score: Math.max(0, Math.min(100, Math.round(r.score))) };
}
