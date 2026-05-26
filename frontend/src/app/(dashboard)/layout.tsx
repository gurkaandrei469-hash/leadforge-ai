import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { UserButton } from '@clerk/nextjs';
import { cookies } from 'next/headers';
import { apiGet, type MeResponse } from '@/lib/api';
import { AssistantWidget } from '@/components/assistant/widget';
import { SessionGuard } from '@/components/dashboard/session-guard';
import { DashboardShell } from '@/components/dashboard/mobile-shell';

const ACTIVE_TEAM_KEY = 'lf:active-team-id';
const LAST_USER_KEY = 'lf:last-clerk-user';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  if (!userId) redirect('/login');

  // ─── Detect a user-swap and force a fresh session ────────────────────────
  // If a previous user signed out and a different Clerk identity just signed in,
  // wipe the active-team cookie so the new user lands in *their own* workspace
  // (not the previous user's last selection). The middleware does its own
  // membership-validation safeguard, but this avoids the user briefly seeing
  // someone else's workspace name flash in the sidebar before the redirect.
  const c = await cookies();
  const previousClerkUser = c.get(LAST_USER_KEY)?.value;
  const isNewUser = previousClerkUser !== userId;

  let team: MeResponse['user']['memberships'][number]['team'] | undefined;
  try {
    const me = await apiGet<MeResponse>('/auth/me');
    team = me?.user.memberships.find((m) => m.team.id === me.currentTeamId)?.team;
  } catch {
    team = undefined;
  }

  const used = team?.creditsUsed ?? 0;
  const total = team?.creditsTotal ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

  return (
    <>
      <SessionGuard clerkUserId={userId} isNewUser={isNewUser} />
      <DashboardShell
        team={team ?? null}
        topBarSlot={
          <>
            <div className="flex items-center gap-2 md:gap-3">
              <div className="hidden flex-col sm:flex">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Credits</span>
                <span className="text-sm font-semibold tabular-nums">
                  {used.toLocaleString()} <span className="text-muted-foreground">/ {total.toLocaleString()}</span>
                </span>
              </div>
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:h-2 sm:w-32">
                <div
                  className="h-full rounded-full bg-grad-brand transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            <UserButton
              afterSignOutUrl="/"
              appearance={{ elements: { avatarBox: 'h-8 w-8 sm:h-9 sm:w-9 ring-2 ring-border' } }}
            />
          </>
        }
      >
        {children}
      </DashboardShell>
      <AssistantWidget />
    </>
  );
}
