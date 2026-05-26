import axios from 'axios';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../utils/logger.js';

/**
 * Gmail OAuth helper. We use the "installed app" / web-app flow:
 *   1. User clicks "Connect Gmail" → we redirect to Google's consent screen
 *   2. Google posts back to /sending-accounts/gmail/callback with an authorization code
 *   3. We trade the code for a refresh_token + access_token, save the refresh_token
 *   4. On send, we call getGmailAccessToken(accountId) which auto-refreshes the access token
 *
 * Scopes we request:
 *   - https://mail.google.com/      → SMTP send + IMAP read (full mailbox access)
 *
 * NOTE: For production, encrypt oauthRefreshTokenEnc at rest. We're storing plain for MVP — same
 * pattern as smtpPassEnc / apiKeyEnc, all flagged with TODO in the schema.
 */

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';

const REQUIRED_SCOPES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

export function isGmailOAuthConfigured(): boolean {
  return !!(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REDIRECT_URI);
}

/** Build the consent URL the user clicks to authorize their Gmail account. */
export function buildGmailAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI!,
    response_type: 'code',
    scope: REQUIRED_SCOPES.join(' '),
    access_type: 'offline',          // request a refresh_token
    prompt: 'consent',                // force re-consent so we always get a refresh_token
    include_granted_scopes: 'true',   // pre-fill checkboxes if user previously granted
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/** Returns true if the granted scope string contains the SMTP/IMAP send permission. */
export function hasMailScope(grantedScopes: string | null | undefined): boolean {
  if (!grantedScopes) return false;
  return grantedScopes.split(/\s+/).includes('https://mail.google.com/');
}

/** Revoke a token (refresh or access) at Google so the user can start clean. Best-effort. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await axios.post(
      'https://oauth2.googleapis.com/revoke',
      new URLSearchParams({ token }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true },
    );
  } catch { /* best-effort */ }
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

/** Trade the auth code returned from Google for tokens. */
export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await axios.post<TokenResponse>(
    TOKEN_ENDPOINT,
    new URLSearchParams({
      code,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI!,
      grant_type: 'authorization_code',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true },
  );
  if (res.status >= 200 && res.status < 300) return res.data;
  throw new Error(`Google token exchange failed: ${JSON.stringify(res.data)}`);
}

/** Look up the email + name attached to a freshly-issued access token. */
export async function fetchGoogleUserInfo(accessToken: string): Promise<{ email: string; name?: string }> {
  const res = await axios.get(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
    validateStatus: () => true,
  });
  if (res.status >= 200 && res.status < 300) return res.data;
  throw new Error(`Google userinfo failed: ${JSON.stringify(res.data)}`);
}

/** Refresh an expired access token using the stored refresh_token. */
async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await axios.post<TokenResponse>(
    TOKEN_ENDPOINT,
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true },
  );
  if (res.status >= 200 && res.status < 300) return res.data;
  throw new Error(`Google refresh failed: ${JSON.stringify(res.data)}`);
}

/**
 * Get a valid access token for a Gmail-connected sending account.
 * Returns the cached token if it's still valid for >60s; otherwise refreshes.
 */
export async function getGmailAccessToken(accountId: string): Promise<string> {
  const account = await prisma.sendingAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error('Sending account not found');
  if (account.provider !== 'GMAIL_OAUTH') throw new Error('Not a Gmail OAuth account');
  if (!account.oauthRefreshTokenEnc) throw new Error('Gmail account is not authorized — reconnect required');
  if (!hasMailScope(account.oauthScopes)) {
    throw new Error(
      'Gmail account is missing the "Send mail" permission. Disconnect this account in Sending Accounts → reconnect → tick ALL scope checkboxes (especially "Read, compose, send, and permanently delete all your email").'
    );
  }

  // Reuse cached access token if it has >60s of life left
  if (account.oauthAccessToken && account.oauthExpiresAt && account.oauthExpiresAt.getTime() - Date.now() > 60_000) {
    return account.oauthAccessToken;
  }

  // Otherwise refresh
  const tokens = await refreshAccessToken(account.oauthRefreshTokenEnc);
  const expiresAt = new Date(Date.now() + (tokens.expires_in - 30) * 1000);

  await prisma.sendingAccount.update({
    where: { id: accountId },
    data: {
      oauthAccessToken: tokens.access_token,
      oauthExpiresAt: expiresAt,
    },
  });

  logger.info({ accountId }, 'refreshed gmail access token');
  return tokens.access_token;
}
