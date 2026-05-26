'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Sparkles } from 'lucide-react';
import { Sidebar } from './sidebar';

interface Team {
  id: string;
  name: string;
  planTier: string;
  creditsTotal: number;
  creditsUsed: number;
}

/**
 * Responsive shell:
 *   • Desktop (md+) — sidebar sits beside content as before
 *   • Mobile (sm-) — sidebar collapses behind a hamburger; tapping it slides in
 *     a full-height drawer. Closes on link tap or backdrop press.
 *
 * The Sidebar component is rendered TWICE — once as a permanent column for
 * desktop, once inside the drawer for mobile — both fed the same team prop.
 * Cheap because Sidebar is pure, and avoids juggling display: states that
 * break sticky positioning.
 */
export function DashboardShell({
  team,
  topBarSlot,
  children,
}: {
  team: Team | null;
  topBarSlot: React.ReactNode;     // credits widget + UserButton (from server layout)
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  // Close drawer on route change
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  // Lock body scroll while drawer is open
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  // Close on Escape
  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setDrawerOpen(false); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <div className="min-h-svh bg-muted/20 md:grid md:min-h-screen md:grid-cols-[260px_1fr]">
      {/* ─── Desktop sidebar (always rendered, hidden on mobile) ─────────── */}
      <div className="hidden md:block">
        <Sidebar team={team} />
      </div>

      {/* ─── Mobile drawer (off-canvas, slides from left) ────────────────── */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div
            className="fixed inset-y-0 left-0 z-50 w-[85vw] max-w-[320px] safe-top safe-bottom shadow-2xl md:hidden animate-in slide-in-from-left duration-200"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <Sidebar team={team} onNavigate={() => setDrawerOpen(false)} />
          </div>
        </>
      )}

      {/* ─── Main column ─────────────────────────────────────────────────── */}
      <main className="flex flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border/60 bg-background/85 px-3 backdrop-blur-md safe-top md:h-16 md:px-6">
          {/* Mobile-only: hamburger + brand */}
          <div className="flex items-center gap-2 md:hidden">
            <button
              onClick={() => setDrawerOpen(true)}
              className="tap grid place-items-center rounded-md text-foreground hover:bg-accent active:bg-accent/80"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Link href="/dashboard" className="flex items-center gap-1.5 text-base font-bold tracking-tight">
              <div className="grid h-7 w-7 place-items-center rounded-md bg-grad-brand">
                <Sparkles className="h-3.5 w-3.5 text-white" />
              </div>
              <span>LeadForge</span>
            </Link>
          </div>

          {/* Desktop and mobile: credits + user button (passed from server layout) */}
          <div className="flex flex-1 items-center justify-end gap-3 md:justify-between">
            {topBarSlot}
          </div>
        </header>

        <div className="flex-1 p-3 safe-x sm:p-4 md:p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
