import nodemailer, { type Transporter } from 'nodemailer';
import axios from 'axios';
import type { SendingAccount } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { lookupMx } from '../verification/mx.js';

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  messageIdHeader?: string; // RFC 5322 Message-ID used to correlate IMAP replies
  error?: string;
}

export interface SendOptions {
  messageIdHeader?: string;
  replyTo?: string;
}

/**
 * Generate a stable RFC 5322 Message-ID.
 * Format: <local@domain> — IMAP servers preserve this exact value in headers,
 * which is how we match incoming replies (In-Reply-To / References) back to the original send.
 */
export function generateMessageId(fromEmail: string): string {
  const domain = fromEmail.split('@')[1] || 'leadforge.ai';
  const random = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `<lf-${ts}-${random}@${domain}>`;
}

/** Send a single email via the chosen sending account. */
export async function sendOne(
  account: SendingAccount,
  to: string,
  subject: string,
  htmlBody: string,
  textBody?: string,
  opts: SendOptions = {},
): Promise<SendResult> {
  const messageIdHeader = opts.messageIdHeader ?? generateMessageId(account.fromEmail);
  try {
    let result: SendResult;
    if (account.provider === 'SMTP' || account.provider === 'GMAIL_OAUTH' || account.provider === 'MICROSOFT_OAUTH')
      result = await sendViaSmtp(account, to, subject, htmlBody, textBody, messageIdHeader);
    else if (account.provider === 'SENDGRID')
      result = await sendViaSendGrid(account, to, subject, htmlBody, textBody, messageIdHeader);
    else if (account.provider === 'SES')
      result = await sendViaSes(account, to, subject, htmlBody, textBody, messageIdHeader);
    else if (account.provider === 'TURBOMX')
      result = await sendViaTurboMx(account, to, subject, htmlBody, textBody, messageIdHeader);
    else return { ok: false, error: `Unsupported provider: ${account.provider}` };

    return { ...result, messageIdHeader };
  } catch (err: any) {
    logger.error({ err, provider: account.provider }, 'send failed');
    return { ok: false, error: humanizeSendError(err, account.provider), messageIdHeader };
  }
}

/** Translate raw provider errors into actionable user-facing messages. */
function humanizeSendError(err: any, provider: string): string {
  const raw = String(err?.message ?? err ?? 'Send failed');
  // Gmail SMTP — bad credentials / missing scope
  if (/535-?5?\.?7\.?8|BadCredentials|invalid_grant/i.test(raw)) {
    if (provider === 'GMAIL_OAUTH') {
      return 'Gmail rejected the access token. Reconnect this account in Settings → Sending Accounts and tick ALL scope checkboxes on Google\'s consent screen.';
    }
    return 'Gmail rejected the username/password. Use a Google App Password (with 2FA enabled) instead of your regular password — or switch to "Connect Gmail" for OAuth.';
  }
  if (/missing the "Send mail" permission/i.test(raw)) return raw;
  // Microsoft 365 SMTP — auth or scope issues
  if (/535.*5\.7\.3|SmtpClientAuthentication is disabled|disabled tenant/i.test(raw)) {
    return 'Microsoft rejected the send. Your tenant has SMTP AUTH disabled — enable "Authenticated SMTP" in Microsoft 365 Admin Center → Active users → Mail → Manage email apps, OR ask your admin to enable it for this mailbox.';
  }
  if (/AADSTS|invalid_client|invalid_grant.*Microsoft/i.test(raw)) {
    return 'Microsoft authentication failed. Reconnect the Outlook account in Settings → Sending Accounts.';
  }
  // SendGrid sender identity
  if (/verified Sender Identity|sender identity/i.test(raw)) {
    return 'SendGrid blocked this send because the from-address isn\'t a verified sender. Go to sendgrid.com → Settings → Sender Authentication and verify the domain or single sender.';
  }
  // SES sandbox / unverified
  if (/Email address.*not verified|MessageRejected/i.test(raw)) {
    return 'AWS SES rejected this send — your account is in the sandbox or the from-address isn\'t verified. Verify the sender in the SES console.';
  }
  // Generic SMTP errors
  if (/ETIMEDOUT|ECONNREFUSED/i.test(raw)) {
    return 'Couldn\'t reach the SMTP server. Check the host/port and that your network allows outbound SMTP.';
  }
  if (/ENOTFOUND/i.test(raw)) {
    return 'SMTP host not found. Double-check the hostname in this account\'s settings.';
  }
  return raw.length > 240 ? raw.slice(0, 240) + '…' : raw;
}

async function sendViaSmtp(
  account: SendingAccount, to: string, subject: string, html: string, text: string | undefined, messageId: string,
): Promise<SendResult> {
  // OAuth providers (Gmail / Microsoft) use XOAUTH2; plain SMTP uses user/pass.
  let auth: any;
  let host: string;
  let port: number;
  let secure: boolean;

  if (account.provider === 'GMAIL_OAUTH') {
    const { getGmailAccessToken } = await import('./gmail-oauth.js');
    const { env } = await import('../config/env.js');
    const accessToken = await getGmailAccessToken(account.id);
    auth = {
      type: 'OAuth2',
      user: account.fromEmail,
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refreshToken: account.oauthRefreshTokenEnc!,
      accessToken,
    };
    host = 'smtp.gmail.com';
    port = 465;
    secure = true;
  } else if (account.provider === 'MICROSOFT_OAUTH') {
    const { getMicrosoftAccessToken } = await import('./microsoft-oauth.js');
    const { env } = await import('../config/env.js');
    const accessToken = await getMicrosoftAccessToken(account.id);
    auth = {
      type: 'OAuth2',
      user: account.fromEmail,
      clientId: env.MICROSOFT_OAUTH_CLIENT_ID,
      clientSecret: env.MICROSOFT_OAUTH_CLIENT_SECRET,
      refreshToken: account.oauthRefreshTokenEnc!,
      accessToken,
    };
    // Microsoft requires STARTTLS on port 587 — port 465 is rejected
    host = 'smtp.office365.com';
    port = 587;
    secure = false; // STARTTLS upgrades the connection
  } else {
    auth = { user: account.smtpUser!, pass: account.smtpPassEnc! };
    host = account.smtpHost!;
    port = account.smtpPort ?? 587;
    secure = account.smtpSecure ?? false;
  }

  const transport: Transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth,
    // Microsoft sometimes needs explicit TLS settings to negotiate STARTTLS
    ...(account.provider === 'MICROSOFT_OAUTH' && { requireTLS: true, tls: { ciphers: 'TLSv1.2' } }),
  });
  const info = await transport.sendMail({
    from: `"${account.fromName}" <${account.fromEmail}>`,
    to,
    subject,
    html,
    text: text ?? html.replace(/<[^>]*>/g, ''),
    messageId,
  });
  return { ok: true, providerMessageId: info.messageId };
}

async function sendViaSendGrid(
  account: SendingAccount, to: string, subject: string, html: string, text: string | undefined, messageId: string,
): Promise<SendResult> {
  const res = await axios.post(
    'https://api.sendgrid.com/v3/mail/send',
    {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: account.fromEmail, name: account.fromName },
      subject,
      headers: { 'Message-ID': messageId },
      content: [
        { type: 'text/plain', value: text ?? html.replace(/<[^>]*>/g, '') },
        { type: 'text/html', value: html },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${account.apiKeyEnc}`,
        'Content-Type': 'application/json',
      },
      validateStatus: () => true,
    },
  );
  if (res.status >= 200 && res.status < 300) {
    return { ok: true, providerMessageId: res.headers['x-message-id'] ?? `sg-${Date.now()}` };
  }
  return { ok: false, error: JSON.stringify(res.data)?.slice(0, 200) ?? `HTTP ${res.status}` };
}

async function sendViaSes(
  account: SendingAccount, to: string, subject: string, html: string, text: string | undefined, messageId: string,
): Promise<SendResult> {
  // Minimal SES v2 SendEmail call. Expects apiKeyEnc = "accessKeyId:secretAccessKey:region" (region defaults to us-east-1)
  const [accessKeyId, secret, region = 'us-east-1'] = (account.apiKeyEnc ?? '').split(':');
  if (!accessKeyId || !secret) return { ok: false, error: 'SES apiKey must be in form accessKeyId:secretAccessKey:region' };

  // Use AWS SDK lazy-required to avoid a hard dep if user doesn't have SES configured
  try {
    // @ts-ignore - optional peer dep, install only when SES is wired
    const { SESv2Client, SendEmailCommand } = await import('@aws-sdk/client-sesv2');
    const client = new SESv2Client({
      region,
      credentials: { accessKeyId, secretAccessKey: secret },
    });
    const cmd = new SendEmailCommand({
      FromEmailAddress: `${account.fromName} <${account.fromEmail}>`,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject },
          Body: {
            Html: { Data: html },
            Text: { Data: text ?? html.replace(/<[^>]*>/g, '') },
          },
          Headers: [{ Name: 'Message-ID', Value: messageId }],
        },
      },
    });
    const result = await client.send(cmd);
    return { ok: true, providerMessageId: result.MessageId };
  } catch (err: any) {
    if (err.code === 'ERR_MODULE_NOT_FOUND') {
      return { ok: false, error: 'SES not installed. Run: npm i @aws-sdk/client-sesv2' };
    }
    return { ok: false, error: err.message };
  }
}

// ─── TurboMX — direct-to-MX delivery on port 25 ─────────────────────────────
//
// Resolves MX records for the recipient domain, then connects directly to each
// host in priority order on port 25 with no AUTH. This is how mail servers
// actually deliver email to each other.
//
// Requirements for reliable delivery:
//   • Port 25 outbound must be open on your server (blocked by most cloud VMs)
//   • Your sending IP must have a PTR (rDNS) record matching heloHostname
//   • SPF record on the fromEmail domain pointing to your sending IP
//   • DKIM signing strongly recommended (configure dkimDomain / dkimKeySelector /
//     dkimPrivateKeyEnc on the SendingAccount row)
//   • DMARC policy on the fromEmail domain (optional but improves inbox rates)

async function sendViaTurboMx(
  account: SendingAccount,
  to: string,
  subject: string,
  html: string,
  text: string | undefined,
  messageId: string,
): Promise<SendResult> {
  const recipientDomain = to.split('@')[1]?.toLowerCase();
  if (!recipientDomain) return { ok: false, error: 'Invalid recipient address — no domain part' };

  // Resolve MX records (cached 7 days in DomainCache table)
  const { valid, records: mxHosts } = await lookupMx(recipientDomain);
  // RFC 5321 §5.1: if no MX records exist, fall back to an A-record implicit MX
  const hosts = valid && mxHosts.length > 0 ? mxHosts : [recipientDomain];

  const heloName = account.heloHostname || account.fromEmail.split('@')[1] || 'localhost';

  // Build DKIM options if the account has a key configured
  const dkimOptions =
    account.dkimPrivateKeyEnc && account.dkimKeySelector && account.dkimDomain
      ? {
          domainName: account.dkimDomain,
          keySelector: account.dkimKeySelector,
          privateKey: account.dkimPrivateKeyEnc,
        }
      : undefined;

  const mailPayload: any = {
    from: `"${account.fromName}" <${account.fromEmail}>`,
    to,
    subject,
    html,
    text: text ?? html.replace(/<[^>]*>/g, ''),
    messageId,
    ...(dkimOptions && { dkim: dkimOptions }),
  };

  let lastError = 'No MX hosts to try';

  for (const mxHost of hosts) {
    try {
      // Create a fresh transport per MX host — port 25, no auth, no implicit TLS
      const transport: Transporter = nodemailer.createTransport({
        host: mxHost,
        port: 25,
        secure: false,      // plain SMTP; recipient server may upgrade via STARTTLS
        name: heloName,     // EHLO hostname — should match PTR record of sending IP
        connectionTimeout: 12_000,
        greetingTimeout:   12_000,
        socketTimeout:     30_000,
        tls: { rejectUnauthorized: false }, // MX servers often have self-signed certs
      });

      const info = await transport.sendMail(mailPayload);
      logger.debug({ mxHost, recipient: to }, 'TurboMX: delivered');
      return { ok: true, providerMessageId: info.messageId };
    } catch (err: any) {
      lastError = err.message ?? String(err);
      logger.warn({ mxHost, recipient: to, err: lastError }, 'TurboMX: MX host failed, trying next');
    }
  }

  return { ok: false, error: `TurboMX: all MX hosts failed. Last: ${lastError.slice(0, 200)}` };
}

// Variable substitution: {{first_name}}, {{last_name}}, {{full_name}}, {{company}}, {{job_title}}, {{email}}
export function renderTemplate(
  body: string,
  lead: { firstName?: string | null; lastName?: string | null; fullName?: string | null;
          companyName?: string | null; jobTitle?: string | null; email?: string | null },
): string {
  const map: Record<string, string> = {
    first_name: lead.firstName ?? lead.fullName?.split(' ')[0] ?? '',
    last_name:  lead.lastName ?? lead.fullName?.split(' ').slice(1).join(' ') ?? '',
    full_name:  lead.fullName ?? '',
    company:    lead.companyName ?? '',
    job_title:  lead.jobTitle ?? '',
    email:      lead.email ?? '',
  };
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, key: string) => map[key.toLowerCase()] ?? '');
}

/** Convert plain-text + simple markdown to HTML with tracking pixel + click rewrites. */
export function renderHtml(
  body: string,
  opts: { trackingPixelUrl: string; clickRewriter: (originalUrl: string) => string; unsubscribeUrl: string },
): string {
  // Rewrite links: <url>  AND  raw http(s) URLs
  let html = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>')
    // raw http(s) URLs → clickable + rewritten
    .replace(/(https?:\/\/[^\s<>]+)/g, (m) => `<a href="${opts.clickRewriter(m)}" style="color:#3b82f6;text-decoration:underline">${m}</a>`);

  html += `
    <br/><br/>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px"/>
    <p style="color:#94a3b8;font-size:12px;line-height:1.5">
      You're receiving this because we believe it's relevant to your role.
      <a href="${opts.unsubscribeUrl}" style="color:#94a3b8;text-decoration:underline">Unsubscribe</a>.
    </p>
    <img src="${opts.trackingPixelUrl}" width="1" height="1" alt="" style="display:none" />
  `;
  return html;
}
