import { Router } from 'express';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import crypto from 'node:crypto';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { prisma } from '../../db/prisma.js';
import { Errors } from '../../utils/errors.js';
import { imapPollQueue } from '../../workers/imap-poll.worker.js';
import {
  buildGmailAuthUrl,
  exchangeCodeForTokens,
  hasMailScope,
  revokeToken,
  fetchGoogleUserInfo,
  isGmailOAuthConfigured,
} from '../../services/gmail-oauth.js';
import {
  buildMicrosoftAuthUrl,
  exchangeCodeForMicrosoftTokens,
  fetchMicrosoftUserInfo,
  hasSmtpSendScope,
  isMicrosoftOAuthConfigured,
} from '../../services/microsoft-oauth.js';
import { env } from '../../config/env.js';

const r = Router();

const ImapBlock = z.object({
  imapEnabled: z.boolean().default(false),
  imapHost: z.string().optional(),
  imapPort: z.number().int().min(1).max(65535).optional(),
  imapUser: z.string().optional(),
  imapPass: z.string().optional(),
  imapSecure: z.boolean().default(true),
});

const SmtpInput = z.object({
  provider: z.literal('SMTP'),
  name: z.string().min(1).max(120),
  fromName: z.string().min(1).max(120),
  fromEmail: z.string().email(),
  smtpHost: z.string().min(1),
  smtpPort: z.number().int().min(1).max(65535).default(587),
  smtpUser: z.string().min(1),
  smtpPass: z.string().min(1),
  smtpSecure: z.boolean().default(false),
  dailyLimit: z.number().int().min(1).max(2000).default(50),
}).merge(ImapBlock);

const SendgridInput = z.object({
  provider: z.literal('SENDGRID'),
  name: z.string().min(1).max(120),
  fromName: z.string().min(1).max(120),
  fromEmail: z.string().email(),
  apiKey: z.string().min(20),
  dailyLimit: z.number().int().min(1).max(2000).default(200),
}).merge(ImapBlock);

const SesInput = z.object({
  provider: z.literal('SES'),
  name: z.string().min(1).max(120),
  fromName: z.string().min(1).max(120),
  fromEmail: z.string().email(),
  apiKey: z.string().min(20),
  dailyLimit: z.number().int().min(1).max(2000).default(200),
}).merge(ImapBlock);

const TurboMxInput = z.object({
  provider: z.literal('TURBOMX'),
  name: z.string().min(1).max(120),
  fromName: z.string().min(1).max(120),
  fromEmail: z.string().email(),
  heloHostname: z.string().min(1),
  dkimDomain: z.string().optional(),
  dkimKeySelector: z.string().optional(),
  dkimPrivateKey: z.string().optional(),
  dailyLimit: z.number().int().min(1).max(10000).default(200),
}).merge(ImapBlock);

const ConnectInput = z.discriminatedUnion('provider', [SmtpInput, SendgridInput, SesInput, TurboMxInput]);

r.post('/', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res, next) => {
  try {
    const body = ConnectInput.parse(req.body);
    const data: any = {
      teamId: req.auth!.teamId,
      provider: body.provider,
      name: body.name,
      fromName: body.fromName,
      fromEmail: body.fromEmail,
      dailyLimit: body.dailyLimit,
      // IMAP config (optional on every provider)
      imapEnabled: body.imapEnabled,
      imapHost: body.imapHost ?? null,
      imapPort: body.imapPort ?? (body.imapHost ? 993 : null),
      imapUser: body.imapUser ?? null,
      imapPassEnc: body.imapPass ?? null, // TODO: real encryption
      imapSecure: body.imapSecure,
    };
    if (body.provider === 'SMTP') {
      data.smtpHost = body.smtpHost;
      data.smtpPort = body.smtpPort;
      data.smtpUser = body.smtpUser;
      data.smtpPassEnc = body.smtpPass;
      data.smtpSecure = body.smtpSecure;
    } else if (body.provider === 'TURBOMX') {
      data.heloHostname = body.heloHostname;
      data.dkimDomain = body.dkimDomain ?? body.fromEmail.split('@')[1] ?? null;
      data.dkimKeySelector = body.dkimKeySelector ?? null;
      data.dkimPrivateKeyEnc = body.dkimPrivateKey ?? null;
    } else {
      data.apiKeyEnc = body.apiKey;
    }

    const account = await prisma.sendingAccount.create({ data });

    // If IMAP is enabled, seed a poll job right away
    if (account.imapEnabled && account.imapHost) {
      await imapPollQueue.add('poll', { accountId: account.id }, { delay: 5_000 });
    }

    res.status(201).json({ account: sanitize(account) });
  } catch (e) { next(e); }
});

r.get('/', authenticate, async (req, res, next) => {
  try {
    const accounts = await prisma.sendingAccount.findMany({
      where: { teamId: req.auth!.teamId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ accounts: accounts.map(sanitize) });
  } catch (e) { next(e); }
});

r.post('/:id/test', authenticate, async (req, res, next) => {
  try {
    const account = await prisma.sendingAccount.findFirst({
      where: { id: req.params.id, teamId: req.auth!.teamId },
    });
    if (!account) throw Errors.notFound('Sending account');

    // TurboMX: verify port 25 is reachable by connecting to a known MX host
    if (account.provider === 'TURBOMX') {
      try {
        const { promises: dns } = await import('node:dns');
        const records = await dns.resolveMx('gmail.com');
        const mxHost = records.sort((a, b) => a.priority - b.priority)[0]?.exchange;
        if (!mxHost) return res.json({ ok: false, message: 'Could not resolve test MX (gmail.com).' });
        const transport = nodemailer.createTransport({
          host: mxHost,
          port: 25,
          secure: false,
          name: account.heloHostname || account.fromEmail.split('@')[1] || 'localhost',
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          tls: { rejectUnauthorized: false },
        });
        await transport.verify();
        const dkimNote = account.dkimPrivateKeyEnc ? ' DKIM key configured.' : ' No DKIM key — deliverability may be lower.';
        return res.json({ ok: true, message: `Port 25 reachable (tested via ${mxHost}).${dkimNote}` });
      } catch (e: any) {
        return res.json({ ok: false, message: humanizeMailError(e.message) + ' — Port 25 is blocked by most cloud providers. You need a VPS or dedicated server with port 25 open.' });
      }
    }

    if (account.provider !== 'SMTP' && account.provider !== 'GMAIL_OAUTH' && account.provider !== 'MICROSOFT_OAUTH') {
      return res.json({ ok: !!account.apiKeyEnc, message: 'API key stored. Real send will validate.' });
    }

    // Build auth synchronously — nodemailer doesn't unwrap Promises in the auth field.
    let auth: any;
    let host: string;
    let port: number;
    let secure: boolean;
    let extraTls: any = {};

    if (account.provider === 'GMAIL_OAUTH') {
      const { getGmailAccessToken } = await import('../../services/gmail-oauth.js');
      const accessToken = await getGmailAccessToken(account.id);
      auth = {
        type: 'OAuth2',
        user: account.fromEmail,
        clientId: env.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        refreshToken: account.oauthRefreshTokenEnc!,
        accessToken,
      };
      host = 'smtp.gmail.com'; port = 465; secure = true;
    } else if (account.provider === 'MICROSOFT_OAUTH') {
      const { getMicrosoftAccessToken } = await import('../../services/microsoft-oauth.js');
      const accessToken = await getMicrosoftAccessToken(account.id);
      auth = {
        type: 'OAuth2',
        user: account.fromEmail,
        clientId: env.MICROSOFT_OAUTH_CLIENT_ID,
        clientSecret: env.MICROSOFT_OAUTH_CLIENT_SECRET,
        refreshToken: account.oauthRefreshTokenEnc!,
        accessToken,
      };
      host = 'smtp.office365.com'; port = 587; secure = false;
      extraTls = { requireTLS: true, tls: { ciphers: 'TLSv1.2' } };
    } else {
      auth = { user: account.smtpUser!, pass: account.smtpPassEnc! };
      host = account.smtpHost!; port = account.smtpPort ?? 587; secure = account.smtpSecure ?? false;
    }

    const transport = nodemailer.createTransport({ host, port, secure, auth, ...extraTls });
    await transport.verify();
    res.json({ ok: true, message: 'Connection verified' });
  } catch (e: any) {
    res.json({ ok: false, message: humanizeMailError(e.message) });
  }
});

// Quick IMAP credentials check — used by the "test IMAP" button in the UI
r.post('/:id/test-imap', authenticate, async (req, res) => {
  let client: ImapFlow | null = null;
  try {
    const account = await prisma.sendingAccount.findFirst({
      where: { id: req.params.id, teamId: req.auth!.teamId },
    });
    if (!account || !account.imapHost || !account.imapUser || !account.imapPassEnc) {
      return res.json({ ok: false, message: 'IMAP is not configured for this account.' });
    }

    // OAuth accounts (Gmail / Microsoft) use XOAUTH2 — fetch a live access token instead of a password.
    // imapPassEnc is set to the sentinel string "OAUTH" for these accounts.
    let auth: any;
    if (account.imapPassEnc === 'OAUTH' && account.provider === 'GMAIL_OAUTH') {
      const { getGmailAccessToken } = await import('../../services/gmail-oauth.js');
      const accessToken = await getGmailAccessToken(account.id);
      auth = { user: account.imapUser, accessToken };
    } else if (account.imapPassEnc === 'OAUTH' && account.provider === 'MICROSOFT_OAUTH') {
      const { getMicrosoftAccessToken } = await import('../../services/microsoft-oauth.js');
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
      socketTimeout: 15_000,
    });
    await client.connect();
    // Verify INBOX is openable — proves both auth AND mailbox access work
    const lock = await client.getMailboxLock('INBOX');
    lock.release();
    return res.json({ ok: true, message: 'IMAP connection verified — reply detection is ready.' });
  } catch (e: any) {
    return res.json({ ok: false, message: humanizeMailError(e.message ?? String(e)) });
  } finally {
    if (client) {
      try { await client.logout(); } catch { /* ignore */ }
    }
  }
});

// Toggle the imapEnabled flag without re-submitting the whole form
r.patch('/:id/imap', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res, next) => {
  try {
    const body = z.object({
      imapEnabled: z.boolean().optional(),
      imapHost: z.string().nullable().optional(),
      imapPort: z.number().int().nullable().optional(),
      imapUser: z.string().nullable().optional(),
      imapPass: z.string().nullable().optional(),
      imapSecure: z.boolean().optional(),
    }).parse(req.body);

    const account = await prisma.sendingAccount.findFirst({
      where: { id: req.params.id, teamId: req.auth!.teamId },
    });
    if (!account) throw Errors.notFound('Sending account');

    const updated = await prisma.sendingAccount.update({
      where: { id: account.id },
      data: {
        imapEnabled: body.imapEnabled ?? account.imapEnabled,
        imapHost: body.imapHost === undefined ? account.imapHost : body.imapHost,
        imapPort: body.imapPort === undefined ? account.imapPort : body.imapPort,
        imapUser: body.imapUser === undefined ? account.imapUser : body.imapUser,
        imapPassEnc: body.imapPass === undefined ? account.imapPassEnc : body.imapPass,
        imapSecure: body.imapSecure ?? account.imapSecure,
      },
    });

    if (updated.imapEnabled && updated.imapHost) {
      await imapPollQueue.add('poll', { accountId: updated.id }, { delay: 5_000 });
    }

    res.json({ account: sanitize(updated) });
  } catch (e) { next(e); }
});

// ───────────────────── Gmail OAuth flow ─────────────────────
//
// /gmail/start    → returns the Google consent URL (front-end opens it in a popup or full redirect)
// /gmail/callback → Google sends the user back here with ?code=... ; we exchange & store the refresh_token

const oauthStateStore = new Map<string, { teamId: string; expiresAt: number }>();

// Garbage-collect expired states every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of oauthStateStore) if (v.expiresAt < now) oauthStateStore.delete(k);
}, 5 * 60 * 1000).unref();

r.get('/gmail/start', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res) => {
  if (!isGmailOAuthConfigured()) {
    return res.status(400).json({
      error: 'Gmail OAuth isn\'t configured on the server. Add GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REDIRECT_URI to your .env.',
    });
  }
  const state = crypto.randomBytes(24).toString('hex');
  oauthStateStore.set(state, { teamId: req.auth!.teamId, expiresAt: Date.now() + 10 * 60 * 1000 });
  res.json({ authUrl: buildGmailAuthUrl(state) });
});

r.get('/gmail/callback', async (req, res) => {
  const code = String(req.query.code ?? '');
  const state = String(req.query.state ?? '');
  const stateRecord = oauthStateStore.get(state);
  const appUrl = env.PUBLIC_APP_URL ?? env.CORS_ORIGIN ?? 'http://localhost:3000';

  if (!code || !stateRecord) {
    return res.redirect(`${appUrl}/settings/sending-accounts?gmail=invalid_state`);
  }
  oauthStateStore.delete(state);

  try {
    const tokens = await exchangeCodeForTokens(code);
    const userInfo = await fetchGoogleUserInfo(tokens.access_token);
    if (!tokens.refresh_token) {
      // Google only sends a refresh_token on the FIRST consent — if the user has previously
      // authorized our app, they need to revoke access at myaccount.google.com first.
      return res.redirect(`${appUrl}/settings/sending-accounts?gmail=no_refresh_token`);
    }

    // CRITICAL: Google only grants restricted scopes (mail.google.com) if the user explicitly
    // ticks the "Read, compose, send..." checkbox on the consent screen. If they skipped it,
    // we get an access token that can't send mail — every campaign send fails with 535-5.7.8.
    // Reject the connection immediately and revoke so the user can re-auth cleanly.
    if (!hasMailScope(tokens.scope)) {
      await revokeToken(tokens.refresh_token);
      return res.redirect(
        `${appUrl}/settings/sending-accounts?gmail=missing_scope&granted=${encodeURIComponent(tokens.scope ?? '')}`,
      );
    }

    // Upsert: if a Gmail account with the same email already exists for this team, refresh its tokens
    const existing = await prisma.sendingAccount.findFirst({
      where: { teamId: stateRecord.teamId, fromEmail: userInfo.email, provider: 'GMAIL_OAUTH' },
    });

    const accountData = {
      provider: 'GMAIL_OAUTH' as const,
      name: existing?.name ?? `Gmail · ${userInfo.email}`,
      fromName: existing?.fromName ?? (userInfo.name || userInfo.email.split('@')[0]),
      fromEmail: userInfo.email,
      oauthRefreshTokenEnc: tokens.refresh_token,
      oauthAccessToken: tokens.access_token,
      oauthExpiresAt: new Date(Date.now() + (tokens.expires_in - 30) * 1000),
      oauthScopes: tokens.scope,
      // Auto-enable IMAP for Gmail since the same OAuth grant covers it
      imapEnabled: true,
      imapHost: 'imap.gmail.com',
      imapPort: 993,
      imapUser: userInfo.email,
      imapSecure: true,
      // For OAuth IMAP, we use the access token instead of a password — handled in imap worker
      imapPassEnc: 'OAUTH', // sentinel value so imap worker knows to fetch a live access token
    };

    const account = existing
      ? await prisma.sendingAccount.update({ where: { id: existing.id }, data: accountData })
      : await prisma.sendingAccount.create({ data: { teamId: stateRecord.teamId, ...accountData } });

    // Kick off IMAP polling immediately
    await imapPollQueue.add('poll', { accountId: account.id }, { delay: 5_000 });

    return res.redirect(`${appUrl}/settings/sending-accounts?gmail=connected&email=${encodeURIComponent(userInfo.email)}`);
  } catch (err: any) {
    return res.redirect(`${appUrl}/settings/sending-accounts?gmail=error&msg=${encodeURIComponent(err.message ?? 'unknown')}`);
  }
});

// ───────────────────── Microsoft 365 / Outlook OAuth flow ─────────────────
//
// /microsoft/start    → returns the Azure consent URL (frontend opens it)
// /microsoft/callback → Microsoft redirects here with ?code=... ; exchange & save

const msOauthStateStore = new Map<string, { teamId: string; expiresAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of msOauthStateStore) if (v.expiresAt < now) msOauthStateStore.delete(k);
}, 5 * 60 * 1000).unref();

r.get('/microsoft/start', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res) => {
  if (!isMicrosoftOAuthConfigured()) {
    return res.status(400).json({
      error: 'Microsoft OAuth isn\'t configured on the server. Add MICROSOFT_OAUTH_CLIENT_ID, MICROSOFT_OAUTH_CLIENT_SECRET, and MICROSOFT_OAUTH_REDIRECT_URI to your .env.',
    });
  }
  const state = crypto.randomBytes(24).toString('hex');
  msOauthStateStore.set(state, { teamId: req.auth!.teamId, expiresAt: Date.now() + 10 * 60 * 1000 });
  res.json({ authUrl: buildMicrosoftAuthUrl(state) });
});

r.get('/microsoft/callback', async (req, res) => {
  const code = String(req.query.code ?? '');
  const state = String(req.query.state ?? '');
  const stateRecord = msOauthStateStore.get(state);
  const appUrl = env.PUBLIC_APP_URL ?? env.CORS_ORIGIN ?? 'http://localhost:3000';

  if (!code || !stateRecord) {
    return res.redirect(`${appUrl}/settings/sending-accounts?microsoft=invalid_state`);
  }
  msOauthStateStore.delete(state);

  try {
    const tokens = await exchangeCodeForMicrosoftTokens(code);
    const userInfo = await fetchMicrosoftUserInfo(tokens.access_token);

    if (!tokens.refresh_token) {
      return res.redirect(`${appUrl}/settings/sending-accounts?microsoft=no_refresh_token`);
    }

    // Microsoft must grant SMTP.Send for outbound — if not, the connection is useless
    if (!hasSmtpSendScope(tokens.scope)) {
      return res.redirect(
        `${appUrl}/settings/sending-accounts?microsoft=missing_scope&granted=${encodeURIComponent(tokens.scope ?? '')}`,
      );
    }

    const existing = await prisma.sendingAccount.findFirst({
      where: { teamId: stateRecord.teamId, fromEmail: userInfo.email, provider: 'MICROSOFT_OAUTH' },
    });

    const accountData = {
      provider: 'MICROSOFT_OAUTH' as const,
      name: existing?.name ?? `Outlook · ${userInfo.email}`,
      fromName: existing?.fromName ?? (userInfo.name || userInfo.email.split('@')[0]),
      fromEmail: userInfo.email,
      oauthRefreshTokenEnc: tokens.refresh_token,
      oauthAccessToken: tokens.access_token,
      oauthExpiresAt: new Date(Date.now() + (tokens.expires_in - 30) * 1000),
      oauthScopes: tokens.scope,
      // Auto-enable IMAP for Outlook since the same OAuth grant covers it
      imapEnabled: true,
      imapHost: 'outlook.office365.com',
      imapPort: 993,
      imapUser: userInfo.email,
      imapSecure: true,
      imapPassEnc: 'OAUTH',
    };

    const account = existing
      ? await prisma.sendingAccount.update({ where: { id: existing.id }, data: accountData })
      : await prisma.sendingAccount.create({ data: { teamId: stateRecord.teamId, ...accountData } });

    await imapPollQueue.add('poll', { accountId: account.id }, { delay: 5_000 });

    return res.redirect(`${appUrl}/settings/sending-accounts?microsoft=connected&email=${encodeURIComponent(userInfo.email)}`);
  } catch (err: any) {
    return res.redirect(`${appUrl}/settings/sending-accounts?microsoft=error&msg=${encodeURIComponent(err.message ?? 'unknown')}`);
  }
});

r.delete('/:id', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res, next) => {
  try {
    await prisma.sendingAccount.deleteMany({
      where: { id: req.params.id, teamId: req.auth!.teamId },
    });
    res.status(204).end();
  } catch (e) { next(e); }
});

// Strip secrets before sending back to client
function sanitize(a: any) {
  const { smtpPassEnc, apiKeyEnc, imapPassEnc, oauthRefreshTokenEnc, dkimPrivateKeyEnc, ...rest } = a;
  return {
    ...rest,
    hasSecret: !!(smtpPassEnc || apiKeyEnc || oauthRefreshTokenEnc || dkimPrivateKeyEnc),
    hasDkim: !!dkimPrivateKeyEnc,
    imapConfigured: !!(rest.imapHost && rest.imapUser && imapPassEnc),
  };
}

function humanizeMailError(msg: string | undefined): string {
  if (!msg) return 'Connection failed';
  const lower = msg.toLowerCase();
  // Gmail OAuth scope problems
  if (lower.includes('missing the "send mail" permission') || lower.includes('mail.google.com')) {
    return 'This Gmail account is missing the "Read & send mail" permission. Disconnect it, reconnect via Connect Gmail, and tick EVERY checkbox on Google\'s consent screen.';
  }
  if (lower.includes('xoauth2') || lower.includes('authenticate failed')) {
    return 'Gmail rejected the access token. Reconnect this Gmail account and grant all permissions on the consent screen.';
  }
  if (lower.includes('invalid login') || lower.includes('authentication') || lower.includes('badcredentials')) {
    return 'Login was rejected — check the username and password / app-password.';
  }
  if (lower.includes('timeout') || lower.includes('etimedout')) return 'Connection timed out — verify the host and port.';
  if (lower.includes('econnrefused')) return 'Server refused the connection — wrong host or port?';
  if (lower.includes('certificate')) return 'TLS certificate problem — try toggling the secure / TLS option.';
  return msg.length > 160 ? msg.slice(0, 160) + '…' : msg;
}

export default r;
