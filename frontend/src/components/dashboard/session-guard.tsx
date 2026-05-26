'use client';
import { useEffect } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { setActiveTeamId } from '@/lib/client-api';

const LAST_USER_KEY = 'lf:last-clerk-user';

/**
 * Owns client-side session hygiene. Runs as an invisible mount in the dashboard
 * layout. Responsibilities:
 *
 *  1. Track which Clerk user is currently signed in (via a cookie + localStorage).
 *  2. Detect when the signed-in user CHANGED across requests and wipe any state
 *     that was scoped to the previous user (the active-workspace cookie,
 *     cached team metadata, etc.) — so signing out as User A and signing in as
 *     User B never leaks A's last workspace selection into B's session.
 *  3. On sign-out (auth state flips to "not signed in"), clear everything so
 *     a fresh login starts clean.
 */
export function SessionGuard({
  clerkUserId,
  isNewUser,
}: {
  clerkUserId: string;
  isNewUser: boolean;
}) {
  const { isSignedIn } = useAuth();
  useUser(); // subscribe to user changes — triggers re-render on sign-in/out

  // ─── First mount or user-swap detection ──────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // SSR detected that this clerkUserId differs from the previous one in the cookie.
    // Clean every per-user piece of client state so we don't leak across identities.
    if (isNewUser) {
      setActiveTeamId(null);              // wipe active workspace
      try {
        // Clear any other namespaced caches the app might have
        for (let i = window.localStorage.length - 1; i >= 0; i--) {
          const key = window.localStorage.key(i);
          if (!key) continue;
          // Wipe app-scoped caches but preserve Clerk's own session storage
          if (key.startsWith('lf:') && key !== 'lf:last-clerk-user') {
            window.localStorage.removeItem(key);
          }
        }
      } catch { /* localStorage disabled — fine */ }
    }

    // Record who's logged in now, in both a cookie (read SSR-side) and localStorage.
    // Secure flag required on HTTPS — without it iOS/Android silently drop the cookie,
    // which makes EVERY page navigation look like a "new user" event and triggers
    // a state wipe on every route change.
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${LAST_USER_KEY}=${clerkUserId}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    try { window.localStorage.setItem(LAST_USER_KEY, clerkUserId); } catch { /* ignore */ }
  }, [clerkUserId, isNewUser]);

  // ─── Sign-out cleanup ────────────────────────────────────────────────────
  // When the user signs out, Clerk flips isSignedIn → false. Wipe everything.
  useEffect(() => {
    if (isSignedIn === false) {
      setActiveTeamId(null);
      try {
        for (let i = window.localStorage.length - 1; i >= 0; i--) {
          const key = window.localStorage.key(i);
          if (key?.startsWith('lf:')) window.localStorage.removeItem(key);
        }
        // Also nuke the user-tracking cookie itself
        const secure = window.location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = `${LAST_USER_KEY}=; Path=/; Max-Age=0${secure}`;
      } catch { /* ignore */ }
    }
  }, [isSignedIn]);

  return null;
}
