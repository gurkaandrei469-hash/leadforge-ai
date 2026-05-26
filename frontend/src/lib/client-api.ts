'use client';
import { useAuth } from '@clerk/nextjs';

// Goes through Next.js rewrite (see next.config.mjs) — same-origin, no CORS hassle
const BASE = '/api/backend';

// localStorage key for the active workspace. The backend's auth middleware reads
// the x-team-id header and falls back to "first team I'm a member of" if absent.
export const ACTIVE_TEAM_KEY = 'lf:active-team-id';

export function getActiveTeamId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACTIVE_TEAM_KEY);
}

/** Compact device-class hint for the backend ("ios" / "android" / "desktop"). Cheap, no UA-parsing in production deps. */
function deviceHint(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if ((navigator as any).platform === 'MacIntel' && navigator.maxTouchPoints > 1) return 'ios';  // iPad
  return 'desktop';
}

export function setActiveTeamId(teamId: string | null) {
  if (typeof window === 'undefined') return;
  // Use Secure on HTTPS — mobile Safari and Android Chrome silently REJECT
  // SameSite cookies set without Secure over HTTPS (especially over tunnels).
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  if (teamId) {
    window.localStorage.setItem(ACTIVE_TEAM_KEY, teamId);
    document.cookie = `${ACTIVE_TEAM_KEY}=${teamId}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  } else {
    window.localStorage.removeItem(ACTIVE_TEAM_KEY);
    document.cookie = `${ACTIVE_TEAM_KEY}=; Path=/; Max-Age=0${secure}`;
  }
  window.dispatchEvent(new CustomEvent('lf:workspace-changed', { detail: { teamId } }));
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

export function useApi() {
  const { getToken } = useAuth();

  async function authedFetch(path: string, init: RequestInit = {}) {
    const token = await getToken();
    const activeTeamId = getActiveTeamId();
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(activeTeamId ? { 'x-team-id': activeTeamId } : {}),
        // Lightweight device hint for backend telemetry — server doesn't trust
        // this for auth, just uses it for logging & analytics segmentation.
        ...(typeof window !== 'undefined' ? { 'x-device-hint': deviceHint() } : {}),
      },
    });
    if (!res.ok) {
      let body: unknown;
      try { body = await res.json(); } catch { body = await res.text(); }
      const msg = (body as any)?.error?.message ?? `API ${res.status}`;
      throw new ApiError(res.status, msg, body);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  return {
    get: <T = any>(path: string) => authedFetch(path) as Promise<T>,
    post: <T = any>(path: string, body: unknown) =>
      authedFetch(path, { method: 'POST', body: JSON.stringify(body) }) as Promise<T>,
    patch: <T = any>(path: string, body: unknown) =>
      authedFetch(path, { method: 'PATCH', body: JSON.stringify(body) }) as Promise<T>,
    del: <T = any>(path: string) => authedFetch(path, { method: 'DELETE' }) as Promise<T>,
  };
}

// SSE helper — returns a cleanup function
export async function subscribeJobProgress(
  jobId: string,
  token: string,
  onMessage: (p: { progress: number; leadsFound: number; pagesScraped: number }) => void,
): Promise<() => void> {
  // EventSource can't send headers, so we go via the API directly with a one-shot fetch + ReadableStream
  const ctrl = new AbortController();
  fetch(`${BASE}/jobs/${jobId}/stream`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: ctrl.signal,
  })
    .then(async (res) => {
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop() ?? '';
        for (const e of events) {
          const line = e.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          try {
            onMessage(JSON.parse(line.slice(5).trim()));
          } catch { /* keep-alive ping or non-JSON */ }
        }
      }
    })
    .catch(() => {});
  return () => ctrl.abort();
}
