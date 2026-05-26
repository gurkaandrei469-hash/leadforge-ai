import { auth } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const ACTIVE_TEAM_KEY = 'lf:active-team-id';

async function authHeader(): Promise<Record<string, string>> {
  const { getToken } = await auth();
  const token = await getToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  // Mirror the client-side active-team cookie into the server-to-server API call,
  // so the server's auth middleware scopes data to the workspace the user picked.
  try {
    const c = await cookies();
    const teamId = c.get(ACTIVE_TEAM_KEY)?.value;
    if (teamId) headers['x-team-id'] = teamId;
  } catch { /* outside request context — fine */ }
  return headers;
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T | null> {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(await authHeader()) },
    cache: 'no-store',
  });
  if (!res.ok) {
    console.error(`API ${res.status} ${path}:`, await res.text().catch(() => ''));
    return null;
  }
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body?: unknown, init?: RequestInit): Promise<T | null> {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}), ...(await authHeader()) },
  });
  if (!res.ok) {
    console.error(`API ${res.status} ${path}:`, await res.text().catch(() => ''));
    return null;
  }
  return res.json() as Promise<T>;
}

export const api = { get: apiGet, post: apiPost };

// Types matching backend responses
export interface MeResponse {
  user: {
    id: string;
    email: string;
    fullName: string | null;
    memberships: Array<{
      role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
      team: {
        id: string;
        name: string;
        slug: string;
        planTier: string;
        creditsTotal: number;
        creditsUsed: number;
      };
    }>;
  };
  currentTeamId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
}
