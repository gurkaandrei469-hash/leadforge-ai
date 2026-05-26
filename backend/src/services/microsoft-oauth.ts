import axios from 'axios';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../utils/logger.js';

/**
 * Microsoft 365 / Outlook OAuth helper. Same pattern as Gmail:
 *   1. User clicks "Connect Outlook" → we redirect to Microsoft consent
 *   2. Microsoft posts back to /sending-accounts/microsoft/callback with a code
 *   3. We exchange the code for an access_token + refresh_token, save the refresh_token
 *   4. On send, getMicrosoftAccessToken(accountId) auto-refreshes the access token
 *
 * Scopes:
 *   - SMTP.Send             → outbound mail via Microsoft's SMTP (smtp.office365.com:587 STARTTLS, XOAUTH2)
 *   - IMAP.AccessAsUser.All → inbound mail via outlook.office365.com:993 IMAP (XOAUTH2)
 *   - offline_access        → required to get a refresh_token
 *   - openid + email + profile → identify the user
 *
 * The Microsoft "common" tenant accepts both personal Outlook.com accounts and work/school
 * accounts. Single-tenant orgs can set MICROSOFT_OAUTH_TENANT to their tenant ID instead.
 */

const REQUIRED_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'https://outlook.office.com/SMTP.Send',
  'https://outlook.office.com/IMAP.AccessAsUser.All',
];

function endpoints() {
  const tenant = env.MICROSOFT_OAUTH_TENANT || 'common';
  return {
    AUTH:     `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    TOKEN:    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    USERINFO: 'https://graph.microsoft.com/v1.0/me',
  };
}

export function isMicrosoftOAuthConfigured(): boolean {
  return !!(env.MICROSOFT_OAUTH_CLIENT_ID && env.MICROSOFT_OAUTH_CLIENT_SECRET && env.MICROSOFT_OAUTH_REDIRECT_URI);
}

/** Build the Microsoft consent URL. */
export function buildMicrosoftAuthUrl(state: string): string {
  const ep = endpoints();
  const params = new URLSearchParams({
    client_id: env.MICROSOFT_OAUTH_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: env.MICROSOFT_OAUTH_REDIRECT_URI!,
    response_mode: 'query',
    scope: REQUIRED_SCOPES.join(' '),
    prompt: 'consent',
    state,
  });
  return `${ep.AUTH}?${params.toString()}`;
}

interface TokenResponse {
  token_type: string;
  scope: string;
  expires_in: number;
  ext_expires_in?: number;
  access_token: string;
  refresh_token?: string;
  id_token?: string;
}

export async function exchangeCodeForMicrosoftTokens(code: string): Promise<TokenResponse> {
  const ep = endpoints();
  const res = await axios.post<TokenResponse>(
    ep.TOKEN,
    new URLSearchParams({
      client_id: env.MICROSOFT_OAUTH_CLIENT_ID!,
      client_secret: env.MICROSOFT_OAUTH_CLIENT_SECRET!,
      code,
      redirect_uri: env.MICROSOFT_OAUTH_REDIRECT_URI!,
      grant_type: 'authorization_code',
      scope: REQUIRED_SCOPES.join(' '),
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true },
  );
  if (res.status >= 200 && res.status < 300) return res.data;
  throw new Error(`Microsoft token exchange failed: ${JSON.stringify(res.data)}`);
}

/** Resolve who owns the access token. Returns the primary email + display name. */
export async function fetchMicrosoftUserInfo(accessToken: string): Promise<{ email: string; name?: string }> {
  const ep = endpoints();
  const res = await axios.get(ep.USERINFO, {
    headers: { Authorization: `Bearer ${accessToken}` },
    validateStatus: () => true,
  });
  if (res.status >= 200 && res.status < 300) {
    return {
      email: res.data.mail ?? res.data.userPrincipalName,
      name: res.data.displayName,
    };
  }
  throw new Error(`Microsoft userinfo failed: ${JSON.stringify(res.data)}`);
}

async function refreshMicrosoftAccessToken(refreshToken: string): Promise<TokenResponse> {
  const ep = endpoints();
  const res = await axios.post<TokenResponse>(
    ep.TOKEN,
    new URLSearchParams({
      client_id: env.MICROSOFT_OAUTH_CLIENT_ID!,
      client_secret: env.MICROSOFT_OAUTH_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: REQUIRED_SCOPES.join(' '),
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true },
  );
  if (res.status >= 200 && res.status < 300) return res.data;
  throw new Error(`Microsoft refresh failed: ${JSON.stringify(res.data)}`);
}

/** Get a valid access token for a Microsoft-connected sending account. Auto-refreshes. */
export async function getMicrosoftAccessToken(accountId: string): Promise<string> {
  const account = await prisma.sendingAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error('Sending account not found');
  if (account.provider !== 'MICROSOFT_OAUTH') throw new Error('Not a Microsoft OAuth account');
  if (!account.oauthRefreshTokenEnc) throw new Error('Microsoft account is not authorized — reconnect required');
  if (!hasSmtpSendScope(account.oauthScopes)) {
    throw new Error(
      'Outlook account is missing the "Send mail" permission. Disconnect this account and reconnect, granting ALL requested permissions.',
    );
  }

  // Reuse cached access token if it has >60s of life left
  if (account.oauthAccessToken && account.oauthExpiresAt && account.oauthExpiresAt.getTime() - Date.now() > 60_000) {
    return account.oauthAccessToken;
  }

  const tokens = await refreshMicrosoftAccessToken(account.oauthRefreshTokenEnc);
  const expiresAt = new Date(Date.now() + (tokens.expires_in - 30) * 1000);

  await prisma.sendingAccount.update({
    where: { id: accountId },
    data: {
      oauthAccessToken: tokens.access_token,
      oauthExpiresAt: expiresAt,
      // Microsoft sometimes rotates the refresh token on refresh — keep the new one if returned
      ...(tokens.refresh_token ? { oauthRefreshTokenEnc: tokens.refresh_token } : {}),
    },
  });

  logger.info({ accountId }, 'refreshed microsoft access token');
  return tokens.access_token;
}

/** True if the granted scope includes SMTP.Send (case-insensitive substring match). */
export function hasSmtpSendScope(granted: string | null | undefined): boolean {
  if (!granted) return false;
  return /SMTP\.Send/i.test(granted);
}

/** Best-effort revoke for a Microsoft token (the /logout endpoint is for the user, not the app). */
export async function revokeMicrosoftToken(_token: string): Promise<void> {
  // Microsoft doesn't expose a token-revoke endpoint for confidential clients — the only way to
  // invalidate is for the user to remove our app at https://account.live.com/consent/Manage.
  // No-op here; the function exists for parity with revokeToken() in gmail-oauth.ts.
}
