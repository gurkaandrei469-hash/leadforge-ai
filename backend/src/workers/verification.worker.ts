import { Worker, Job } from 'bullmq';
import { redis, bullConnection } from '../db/redis.js';
import { prisma } from '../db/prisma.js';
import { verifyEmail } from '../verification/verifier.js';
import { logger } from '../utils/logger.js';

export const verificationWorker = new Worker(
  'verification',
  async (job: Job<{ leadId: string; email: string; teamId: string }>) => {
    const { leadId, email } = job.data;
    const result = await verifyEmail(email);

    await prisma.emailVerification.upsert({
      where: { leadId },
      create: {
        leadId,
        email: result.email,
        emailNormalized: result.emailNormalized,
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
        reason: enrichReason(result),
        durationMs: result.durationMs,
        expiresAt: new Date(Date.now() + 30 * 86400_000),
      },
      update: {
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
        reason: enrichReason(result),
        durationMs: result.durationMs,
        verifiedAt: new Date(),
      },
    });

    await prisma.lead.update({
      where: { id: leadId },
      data: { verificationStatus: result.status, emailScore: result.score },
    });

    logger.debug(
      { leadId, email: result.emailNormalized, status: result.status, score: result.score, mx: result.mxProvider },
      'verified',
    );
  },
  {
    connection: bullConnection,
    concurrency: 20,
    limiter: { max: 30, duration: 1000 },
  },
);

/** Concatenate the structured signals into the existing `reason` column so
 *  downstream UI and analytics can read them without a schema migration. */
function enrichReason(r: Awaited<ReturnType<typeof verifyEmail>>): string {
  const parts = [r.reason];
  if (r.mxProvider) parts.push(`mx=${r.mxProvider}`);
  if (r.hasSpf) parts.push('spf');
  if (r.hasDmarc) parts.push(`dmarc=${r.dmarcPolicy ?? 'present'}`);
  if (r.isFreeEmail) parts.push('free');
  if (r.isSuspicious) parts.push('suspicious');
  if (r.typoSuggestion) parts.push(`typo→${r.typoSuggestion}`);
  return parts.join(' | ').slice(0, 500);
}
