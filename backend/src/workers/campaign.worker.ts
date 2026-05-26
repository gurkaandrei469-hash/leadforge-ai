import { Worker, Job } from 'bullmq';
import { redis } from '../db/redis.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../utils/logger.js';
import { sendOne, renderTemplate, renderHtml, generateMessageId } from '../services/email-sender.js';
import { campaignQueue } from './queues.js';
import { env } from '../config/env.js';
import crypto from 'node:crypto';

const TICK_INTERVAL_MS = 30_000; // re-check campaigns every 30s

/**
 * Worker that drives email campaigns forward.
 * For every RUNNING campaign, finds recipients whose nextSendAt <= now and sends their current step.
 * After each send, advances the recipient to the next step (or marks SENT if no more).
 */
export const campaignWorker = new Worker(
  'campaign',
  async (job: Job<{ campaignId: string }>) => {
    const { campaignId } = job.data;
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { steps: { orderBy: { order: 'asc' } }, sendingAccount: true },
    });
    if (!campaign || campaign.status !== 'RUNNING') return;
    if (!campaign.sendingAccount?.isActive) return;

    // Respect send window
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay(); // 0 sun, 6 sat
    const inWindow = hour >= campaign.sendStartHour && hour < campaign.sendEndHour;
    const onWorkday = campaign.weekdaysOnly ? day >= 1 && day <= 5 : true;

    if (!inWindow || !onWorkday) {
      // Re-queue to check again
      await campaignQueue.add('tick', { campaignId }, { delay: TICK_INTERVAL_MS });
      return;
    }

    // Reset sentToday if last reset was a different day
    const acc = campaign.sendingAccount;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (!acc.lastResetAt || acc.lastResetAt < today) {
      await prisma.sendingAccount.update({
        where: { id: acc.id },
        data: { sentToday: 0, lastResetAt: today },
      });
      acc.sentToday = 0;
    }

    const remainingToday = Math.min(
      campaign.dailyLimit - 0, // (we don't track campaign-level daily separately; use account)
      acc.dailyLimit - acc.sentToday,
    );
    if (remainingToday <= 0) {
      // Try again in 1 hour
      await campaignQueue.add('tick', { campaignId }, { delay: 60 * 60 * 1000 });
      return;
    }

    // Fetch up to N recipients ready to send
    const recipients = await prisma.campaignRecipient.findMany({
      where: {
        campaignId,
        status: { in: ['QUEUED', 'IN_PROGRESS'] },
        OR: [
          { nextSendAt: null },
          { nextSendAt: { lte: now } },
        ],
      },
      orderBy: { addedAt: 'asc' },
      take: Math.min(remainingToday, 10), // batch of 10 per tick
      include: { lead: true },
    });

    if (recipients.length === 0) {
      // Are there any recipients still pending (with future nextSendAt)?
      const pending = await prisma.campaignRecipient.count({
        where: { campaignId, status: { in: ['QUEUED', 'IN_PROGRESS'] } },
      });
      if (pending === 0) {
        await prisma.campaign.update({
          where: { id: campaignId },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
        logger.info({ campaignId }, 'campaign completed');
        return;
      }
      await campaignQueue.add('tick', { campaignId }, { delay: TICK_INTERVAL_MS });
      return;
    }

    for (const r of recipients) {
      if (!r.lead.email) continue;

      const step = campaign.steps.find((s) => s.order === r.currentStep);
      if (!step) {
        // No more steps — sequence is done. Sanity-check: did this recipient actually have
        // at least one EmailSend recorded? If not, we have a state mismatch — currentStep got
        // ahead of reality (corrupt data or a manual SQL edit). Don't silently mark SENT.
        const sendCount = await prisma.emailSend.count({ where: { recipientId: r.id } });
        if (sendCount === 0) {
          logger.warn(
            { recipientId: r.id, currentStep: r.currentStep, availableSteps: campaign.steps.map((s) => s.order) },
            'recipient has no matching step AND no prior sends — resetting to step 0',
          );
          await prisma.campaignRecipient.update({
            where: { id: r.id },
            data: { currentStep: 0, status: 'QUEUED' },
          });
          continue;
        }
        // Legitimate "sequence complete" path
        await prisma.campaignRecipient.update({ where: { id: r.id }, data: { status: 'SENT' } });
        continue;
      }

      // Ensure unsub token
      const unsub = await prisma.unsubscribeToken.upsert({
        where: { token: `unsub-${r.lead.id}-${r.campaignId}` },
        create: { token: `unsub-${r.lead.id}-${r.campaignId}`, teamId: campaign.teamId, leadId: r.lead.id, campaignId },
        update: {},
      });

      // Render template
      const subject = renderTemplate(step.subject, r.lead);
      const textBody = renderTemplate(step.body, r.lead);

      // Generate a stable Message-ID up-front so we can store it and pass it to the SMTP/API send.
      // Reply detection in imap-poll.worker.ts matches this against incoming In-Reply-To / References.
      const messageIdHeader = generateMessageId(acc.fromEmail);

      // Create EmailSend row first so we have an ID for tracking pixel
      const send = await prisma.emailSend.create({
        data: {
          campaignId, recipientId: r.id, stepId: step.id,
          status: 'PENDING',
          toEmail: r.lead.email,
          fromEmail: acc.fromEmail,
          subject,
          bodyRendered: '', // placeholder, set after rendering
          messageIdHeader: messageIdHeader.replace(/[<>]/g, ''), // store bare form for IN-clause matching
        },
      });

      const base = (env as any).PUBLIC_URL ?? 'http://localhost:4000';
      const trackingPixelUrl = `${base}/api/v1/track/open/${send.id}.png`;
      const unsubUrl = `${base}/api/v1/track/unsubscribe/${unsub.token}`;
      const html = renderHtml(textBody, {
        trackingPixelUrl,
        clickRewriter: (url) => `${base}/api/v1/track/click/${send.id}?u=${encodeURIComponent(url)}`,
        unsubscribeUrl: unsubUrl,
      });

      // Update with rendered HTML
      await prisma.emailSend.update({ where: { id: send.id }, data: { bodyRendered: html } });

      // Actually send (pass the pre-generated Message-ID so we can correlate replies via IMAP)
      const result = await sendOne(acc, r.lead.email, subject, html, textBody, { messageIdHeader });

      if (result.ok) {
        const nextStep = campaign.steps.find((s) => s.order === r.currentStep + 1);
        const nextSendAt = nextStep
          ? new Date(Date.now() + nextStep.delayDays * 24 * 60 * 60 * 1000)
          : null;

        await prisma.$transaction([
          prisma.emailSend.update({
            where: { id: send.id },
            data: { status: 'SENT', sentAt: new Date(), providerMessageId: result.providerMessageId },
          }),
          prisma.campaignRecipient.update({
            where: { id: r.id },
            data: {
              currentStep: r.currentStep + 1,
              lastSentAt: new Date(),
              nextSendAt,
              status: nextStep ? 'IN_PROGRESS' : 'SENT',
            },
          }),
          prisma.campaign.update({
            where: { id: campaignId },
            data: { sentCount: { increment: 1 } },
          }),
          prisma.sendingAccount.update({
            where: { id: acc.id },
            data: { sentToday: { increment: 1 }, lastSendAt: new Date() },
          }),
        ]);
      } else {
        await prisma.$transaction([
          prisma.emailSend.update({
            where: { id: send.id },
            data: { status: 'FAILED', errorMessage: result.error },
          }),
          prisma.campaignRecipient.update({
            where: { id: r.id },
            data: { status: 'FAILED' },
          }),
        ]);
        logger.warn({ recipientId: r.id, error: result.error }, 'send failed');
      }
    }

    // Re-queue ourselves to keep going
    await campaignQueue.add('tick', { campaignId }, { delay: TICK_INTERVAL_MS });
  },
  { connection: redis, concurrency: 2 },
);
