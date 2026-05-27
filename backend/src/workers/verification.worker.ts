import { Worker, Job } from 'bullmq';
import { redis, bullConnection } from '../db/redis.js';
import { prisma } from '../db/prisma.js';
import { verifyEmail } from '../verification/verifier.js';

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
        reason: result.reason,
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
        reason: result.reason,
        durationMs: result.durationMs,
        verifiedAt: new Date(),
      },
    });

    await prisma.lead.update({
      where: { id: leadId },
      data: { verificationStatus: result.status, emailScore: result.score },
    });
  },
  {
    connection: bullConnection,
    concurrency: 20,
    limiter: { max: 30, duration: 1000 },
  },
);
