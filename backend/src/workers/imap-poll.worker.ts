import { Worker, Job, Queue } from 'bullmq';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { redis } from '../db/redis.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../utils/logger.js';

export const imapPollQueue = new Queue('imap-poll', { connection: redis });

const POLL_INTERVAL_MS = 5 * 60 * 1000; // poll each account every 5 minutes
const LOOKBACK_DAYS = 30; // only scan messages from the last 30 days

/**
 * Worker that polls IMAP inboxes for each enabled SendingAccount and detects replies
 * to outbound emails sent by our campaigns. Matches by In-Reply-To / References → EmailSend.messageIdHeader.
 */
export const imapPollWorker = new Worker(
  'imap-poll',
  async (job: Job<{ accountId: string }>) => {
    const account = await prisma.sendingAccount.findUnique({ where: { id: job.data.accountId } });
    if (!account || !account.imapEnabled || !account.imapHost || !account.imapUser || !account.imapPassEnc) return;

    let client: ImapFlow | null = null;
    try {
      // For OAuth-connected accounts (Gmail / Microsoft) the password slot holds the sentinel
      // "OAUTH" — fetch a live access token instead of using a static password.
      let auth: any;
      if (account.imapPassEnc === 'OAUTH' && account.provider === 'GMAIL_OAUTH') {
        const { getGmailAccessToken } = await import('../services/gmail-oauth.js');
        const accessToken = await getGmailAccessToken(account.id);
        auth = { user: account.imapUser, accessToken };
      } else if (account.imapPassEnc === 'OAUTH' && account.provider === 'MICROSOFT_OAUTH') {
        const { getMicrosoftAccessToken } = await import('../services/microsoft-oauth.js');
        const accessToken = await getMicrosoftAccessToken(account.id);
        auth = { user: account.imapUser, accessToken };
      } else {
        auth = { user: account.imapUser, pass: account.imapPassEnc };
      }

      client = new ImapFlow({
        host: account.imapHost,
        port: account.imapPort ?? 993,
        secure: account.imapSecure ?? true,
        auth,
        logger: false,
        // Sane connect timeout — Gmail can be slow
        socketTimeout: 30_000,
      });

      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000);

        // Use UID search for "since N days ago" then fetch headers
        const uids = await client.search({ since }, { uid: true });
        if (!uids || uids.length === 0) return;

        // Only look at messages we haven't already processed: filter by date locally
        let matchedReplies = 0;
        for await (const msg of client.fetch(uids, { uid: true, source: true, envelope: true, internalDate: true }, { uid: true })) {
          if (!msg.source) continue;
          if (msg.internalDate && account.lastImapPollAt && msg.internalDate < account.lastImapPollAt) {
            // Already processed in a previous poll window
            continue;
          }

          try {
            const parsed = await simpleParser(msg.source);
            const inReplyTo = (parsed.inReplyTo ?? '').replace(/[<>]/g, '').trim();
            const refs = (Array.isArray(parsed.references) ? parsed.references : [parsed.references])
              .filter(Boolean)
              .map((r: any) => String(r).replace(/[<>]/g, '').trim());

            const candidates = [inReplyTo, ...refs].filter(Boolean);
            if (candidates.length === 0) continue;

            // Find an EmailSend with a matching Message-ID header
            const send = await prisma.emailSend.findFirst({
              where: { messageIdHeader: { in: candidates } },
              include: { recipient: true },
            });
            if (!send || send.repliedAt) continue;

            // Mark as replied
            await prisma.$transaction([
              prisma.emailSend.update({
                where: { id: send.id },
                data: { status: 'REPLIED', repliedAt: new Date() },
              }),
              prisma.emailEvent.create({
                data: { sendId: send.id, type: 'reply' },
              }),
              prisma.campaignRecipient.update({
                where: { id: send.recipientId },
                data: { status: 'REPLIED' },
              }),
              prisma.campaign.update({
                where: { id: send.campaignId },
                data: { repliedCount: { increment: 1 } },
              }),
            ]);
            matchedReplies++;
            logger.info({ sendId: send.id, accountId: account.id }, 'reply detected');
          } catch (e: any) {
            logger.warn({ err: e.message }, 'failed to parse imap message');
          }
        }

        await prisma.sendingAccount.update({
          where: { id: account.id },
          data: { lastImapPollAt: new Date() },
        });

        if (matchedReplies > 0) {
          logger.info({ accountId: account.id, matchedReplies }, 'imap poll complete');
        }
      } finally {
        lock.release();
      }
    } catch (err: any) {
      logger.warn({ err: err.message, accountId: account.id }, 'imap poll failed');
    } finally {
      if (client) try { await client.logout(); } catch {}
    }

    // Re-schedule next poll for this account
    await imapPollQueue.add('poll', { accountId: account.id }, { delay: POLL_INTERVAL_MS });
  },
  { connection: redis, concurrency: 3 },
);

/**
 * Bootstrap function — call this at worker startup to seed initial poll jobs for every enabled account.
 */
export async function bootstrapImapPolls() {
  const enabled = await prisma.sendingAccount.findMany({ where: { imapEnabled: true, isActive: true } });
  for (const acc of enabled) {
    await imapPollQueue.add('poll', { accountId: acc.id }, { delay: 30_000 }); // wait 30s after startup
  }
  if (enabled.length > 0) logger.info({ count: enabled.length }, 'imap polling started');
}
