// Composite scoring: 0-100, plus status classification.
interface ScoreInput {
  syntaxValid: boolean;
  isDisposable: boolean;
  mxValid: boolean;
  smtpDeliverable: boolean | null;
  isCatchAll: boolean | null;
  isRoleAccount: boolean;
}

export interface Score {
  score: number;
  status: 'VALID' | 'INVALID' | 'RISKY' | 'CATCH_ALL' | 'UNKNOWN';
  confidence: number;
  reason: string;
}

export function score(input: ScoreInput): Score {
  if (!input.syntaxValid) return { score: 0, status: 'INVALID', confidence: 1, reason: 'syntax_invalid' };
  if (input.isDisposable) return { score: 5, status: 'INVALID', confidence: 0.95, reason: 'disposable' };
  if (!input.mxValid) return { score: 10, status: 'INVALID', confidence: 0.95, reason: 'no_mx' };

  if (input.smtpDeliverable === false)
    return { score: 15, status: 'INVALID', confidence: 0.9, reason: 'smtp_rejected' };

  if (input.smtpDeliverable === null)
    return { score: 50, status: 'UNKNOWN', confidence: 0.5, reason: 'smtp_inconclusive' };

  // smtpDeliverable === true
  if (input.isCatchAll)
    return {
      score: input.isRoleAccount ? 45 : 65,
      status: 'CATCH_ALL',
      confidence: 0.7,
      reason: 'catch_all_domain',
    };

  if (input.isRoleAccount)
    return { score: 75, status: 'RISKY', confidence: 0.8, reason: 'role_account' };

  return { score: 95, status: 'VALID', confidence: 0.95, reason: 'deliverable' };
}
