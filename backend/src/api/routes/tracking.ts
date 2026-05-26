import { Router } from 'express';
import { prisma } from '../../db/prisma.js';

const r = Router();

// 1×1 transparent PNG (43 bytes)
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

// Open tracking pixel — endpoint includes `.png` so it loads naturally in inboxes.
r.get('/open/:sendId([a-z0-9]+).png', async (req, res) => {
  try {
    const sendId = req.params.sendId;
    const userAgent = req.headers['user-agent'] ?? null;
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? null;

    const send = await prisma.emailSend.findUnique({ where: { id: sendId } });
    if (send && !send.openedAt) {
      await prisma.$transaction([
        prisma.emailSend.update({
          where: { id: sendId },
          data: { status: 'OPENED', openedAt: new Date() },
        }),
        prisma.emailEvent.create({
          data: { sendId, type: 'open', userAgent, ipAddress },
        }),
        prisma.campaign.update({
          where: { id: send.campaignId },
          data: { openedCount: { increment: 1 } },
        }),
      ]);
    } else if (send) {
      await prisma.emailEvent.create({
        data: { sendId, type: 'open', userAgent, ipAddress },
      });
    }
  } catch { /* ignore — never break the pixel */ }

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.send(PIXEL);
});

r.get('/click/:sendId', async (req, res) => {
  const sendId = req.params.sendId;
  const target = req.query.u as string | undefined;
  const safeTarget = target && /^https?:\/\//i.test(target) ? target : 'https://leadforge.ai';

  try {
    const send = await prisma.emailSend.findUnique({ where: { id: sendId } });
    if (send) {
      const isFirstClick = !send.clickedAt;
      await prisma.$transaction([
        prisma.emailSend.update({
          where: { id: sendId },
          data: isFirstClick ? { status: 'CLICKED', clickedAt: new Date() } : {},
        }),
        prisma.emailEvent.create({
          data: { sendId, type: 'click', url: safeTarget, userAgent: req.headers['user-agent'] ?? null, ipAddress: req.ip ?? null },
        }),
        ...(isFirstClick ? [
          prisma.campaign.update({
            where: { id: send.campaignId },
            data: { clickedCount: { increment: 1 } },
          }),
        ] : []),
      ]);
    }
  } catch { /* ignore */ }

  res.redirect(302, safeTarget);
});

// Unsubscribe — public, GET shows confirmation, POST actually unsubs
r.get('/unsubscribe/:token', async (req, res) => {
  const token = req.params.token;
  const t = await prisma.unsubscribeToken.findUnique({ where: { token } });
  if (!t) return res.status(404).type('html').send('<h1>Invalid unsubscribe link</h1>');

  if (t.unsubscribedAt) {
    return res.type('html').send(`<!doctype html>
      <html><body style="font-family:system-ui;max-width:540px;margin:80px auto;padding:24px;color:#0f172a">
        <h1>You're unsubscribed</h1>
        <p>You'll no longer receive emails from this sender.</p>
      </body></html>`);
  }

  res.type('html').send(`<!doctype html>
    <html><body style="font-family:system-ui;max-width:540px;margin:80px auto;padding:24px;color:#0f172a">
      <h1>Confirm unsubscribe</h1>
      <p>Click the button below to stop receiving emails from this sender.</p>
      <form method="POST" action="/api/v1/track/unsubscribe/${token}">
        <button type="submit" style="background:#dc2626;color:white;padding:12px 24px;border:none;border-radius:8px;font-weight:600;cursor:pointer">
          Unsubscribe me
        </button>
      </form>
    </body></html>`);
});

r.post('/unsubscribe/:token', async (req, res) => {
  const token = req.params.token;
  const t = await prisma.unsubscribeToken.findUnique({ where: { token } });
  if (!t) return res.status(404).type('html').send('<h1>Invalid unsubscribe link</h1>');

  if (!t.unsubscribedAt) {
    await prisma.$transaction([
      prisma.unsubscribeToken.update({ where: { token }, data: { unsubscribedAt: new Date() } }),
      // Mark all this lead's campaign recipients as unsubscribed
      prisma.campaignRecipient.updateMany({
        where: { leadId: t.leadId, status: { in: ['QUEUED', 'IN_PROGRESS'] } },
        data: { status: 'UNSUBSCRIBED' },
      }),
      // Mark lead as hidden so they don't reappear in extractions
      prisma.lead.update({ where: { id: t.leadId }, data: { isHidden: true } }),
      ...(t.campaignId ? [
        prisma.campaign.update({
          where: { id: t.campaignId },
          data: { unsubCount: { increment: 1 } },
        }),
      ] : []),
    ]);
  }

  res.type('html').send(`<!doctype html>
    <html><body style="font-family:system-ui;max-width:540px;margin:80px auto;padding:24px;color:#0f172a">
      <h1>You're unsubscribed</h1>
      <p>You'll no longer receive emails from this sender. Thanks for letting us know.</p>
    </body></html>`);
});

export default r;
