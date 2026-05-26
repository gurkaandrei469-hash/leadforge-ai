import { checkSyntax } from './syntax.js';
import { isDisposable } from './disposable.js';
import { lookupMx } from './mx.js';
import { smtpVerify } from './smtp.js';
import { score, Score } from './scoring.js';

export interface VerificationResult extends Score {
  email: string;
  emailNormalized: string;
  syntaxValid: boolean;
  isDisposable: boolean;
  mxValid: boolean;
  mxRecords: string[];
  smtpDeliverable: boolean | null;
  isCatchAll: boolean | null;
  isRoleAccount: boolean;
  durationMs: number;
}

export async function verifyEmail(rawEmail: string): Promise<VerificationResult> {
  const t0 = Date.now();
  const syntax = checkSyntax(rawEmail);

  if (!syntax.valid || !syntax.normalized) {
    const sc = score({
      syntaxValid: false, isDisposable: false, mxValid: false,
      smtpDeliverable: null, isCatchAll: null, isRoleAccount: false,
    });
    return {
      ...sc,
      email: rawEmail,
      emailNormalized: rawEmail.toLowerCase(),
      syntaxValid: false,
      isDisposable: false,
      mxValid: false,
      mxRecords: [],
      smtpDeliverable: null,
      isCatchAll: null,
      isRoleAccount: false,
      durationMs: Date.now() - t0,
    };
  }

  const normalized = syntax.normalized;
  const domain = normalized.split('@')[1];
  const disposable = isDisposable(domain);

  let mx = { valid: false, records: [] as string[] };
  let smtp = { deliverable: null as boolean | null, isCatchAll: null as boolean | null };

  if (!disposable) {
    mx = await lookupMx(domain);
    if (mx.valid) {
      smtp = await smtpVerify(normalized, mx.records);
    }
  }

  const sc = score({
    syntaxValid: true,
    isDisposable: disposable,
    mxValid: mx.valid,
    smtpDeliverable: smtp.deliverable,
    isCatchAll: smtp.isCatchAll,
    isRoleAccount: syntax.isRole,
  });

  return {
    ...sc,
    email: rawEmail,
    emailNormalized: normalized,
    syntaxValid: true,
    isDisposable: disposable,
    mxValid: mx.valid,
    mxRecords: mx.records,
    smtpDeliverable: smtp.deliverable,
    isCatchAll: smtp.isCatchAll,
    isRoleAccount: syntax.isRole,
    durationMs: Date.now() - t0,
  };
}
