'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Check, ChevronsUpDown, Plus, Loader2, Building2, X as XIcon, Sparkles, Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useApi, ApiError, getActiveTeamId, setActiveTeamId } from '@/lib/client-api';

interface Workspace {
  id: string;
  name: string;
  slug: string;
  planTier: string;
  creditsTotal: number;
  creditsUsed: number;
  _count: { memberships: number; leads: number; jobs: number };
}

const PLAN_COLORS: Record<string, string> = {
  FREE:       'bg-slate-500/15 text-slate-600 dark:text-slate-300',
  STARTER:    'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  PRO:        'bg-grad-brand text-white',
  BUSINESS:   'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  ENTERPRISE: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
};

/**
 * Pinned in the sidebar. Shows the active workspace, opens a dropdown listing
 * all workspaces the user belongs to, and lets them create new ones.
 * Switching writes localStorage + a cookie, then forces a full app reload so
 * every page picks up the new x-team-id header.
 */
export function WorkspaceSwitcher({ initialTeam }: { initialTeam: { id: string; name: string; planTier: string } | null }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loaded, setLoaded] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Resolve the currently-active workspace from localStorage; fall back to the SSR-passed team
  const activeId = (typeof window !== 'undefined' ? getActiveTeamId() : null) ?? initialTeam?.id ?? null;
  const active = workspaces.find((w) => w.id === activeId) ?? null;

  // Fetch on demand (when dropdown opens — fast, fresh)
  async function loadWorkspaces() {
    try {
      const res = await api.get<{ teams: Workspace[] }>('/teams');
      setWorkspaces(res.teams);
      setLoaded(true);
    } catch (e) {
      // 429 is handled centrally in client-api.ts (deduplicated toast).
      // Anything else gets a normal error toast.
      if (e instanceof ApiError && e.status !== 429) {
        toast.error(e.message);
      } else if (!(e instanceof ApiError)) {
        toast.error('Failed to load workspaces');
      }
    }
  }

  // Load once on mount so the trigger button shows the real workspace name
  // even before the user opens the dropdown. Without this it got stuck on
  // "Loading…" forever whenever the SSR initialTeam prop was unavailable
  // (e.g. /auth/me hit a transient rate-limit during layout hydration).
  useEffect(() => {
    if (!loaded) loadWorkspaces();
  }, [loaded]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  async function switchTo(workspace: Workspace) {
    if (workspace.id === activeId) { setOpen(false); return; }
    setActiveTeamId(workspace.id);
    toast.success(`Switched to ${workspace.name}`);
    // Hard reload so SSR layout + every data-fetching page picks up the new active team.
    // Soft re-render (router.refresh) would miss client-cached state in useEffect hooks.
    window.location.href = '/dashboard';
  }

  async function createWorkspace() {
    if (!newName.trim()) return toast.error('Name is required');
    setBusy(true);
    try {
      const res = await api.post<{ team: Workspace }>('/teams', { name: newName.trim() });
      toast.success(`Created "${res.team.name}"`);
      setActiveTeamId(res.team.id);
      window.location.href = '/dashboard';
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create workspace');
      setBusy(false);
    }
  }

  // What to show in the trigger button — prefer freshly-loaded workspace data when available
  const triggerName = active?.name ?? initialTeam?.name ?? 'Loading…';
  const triggerPlan = active?.planTier ?? initialTeam?.planTier ?? 'FREE';

  return (
    <div className="relative" ref={popoverRef}>
      {/* Trigger card — replaces the static workspace card */}
      <button
        onClick={() => setOpen(!open)}
        className="group w-full rounded-xl border bg-gradient-to-br from-muted/40 to-transparent p-3 text-left transition-all hover:from-muted/60 hover:shadow-sm"
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Workspace</span>
          <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${PLAN_COLORS[triggerPlan] ?? PLAN_COLORS.FREE}`}>
            {triggerPlan}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold">{triggerName}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:text-foreground" />
        </div>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border bg-card shadow-2xl ring-1 ring-border/50">
          {creating ? (
            // ── Create new workspace pane ─────────────────────────────────────
            <div className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">New workspace</span>
                <button onClick={() => setCreating(false)} className="rounded p-0.5 text-muted-foreground hover:bg-accent">
                  <XIcon className="h-3 w-3" />
                </button>
              </div>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Acme Marketing"
                className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                onKeyDown={(e) => { if (e.key === 'Enter') createWorkspace(); }}
                disabled={busy}
              />
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                Brand-new isolated workspace. Leads, campaigns, sending accounts — all separate.
              </p>
              <button
                onClick={createWorkspace}
                disabled={busy || !newName.trim()}
                className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-grad-brand px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Create workspace
              </button>
            </div>
          ) : (
            <>
              {/* List header */}
              <div className="border-b px-3 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Your workspaces</span>
              </div>

              {/* List */}
              <ul className="max-h-64 overflow-y-auto p-1">
                {!loaded ? (
                  <li className="px-3 py-4 text-center text-xs text-muted-foreground">
                    <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" />
                  </li>
                ) : workspaces.length === 0 ? (
                  <li className="px-3 py-4 text-center text-xs text-muted-foreground">No workspaces yet</li>
                ) : (
                  workspaces.map((w) => {
                    const isActive = w.id === activeId;
                    return (
                      <li key={w.id}>
                        <button
                          onClick={() => switchTo(w)}
                          className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                            isActive ? 'bg-primary/10' : 'hover:bg-accent'
                          }`}
                        >
                          <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${isActive ? 'bg-grad-brand text-white' : 'bg-muted text-muted-foreground'}`}>
                            <Building2 className="h-3.5 w-3.5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium">{w.name}</span>
                              <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider ${PLAN_COLORS[w.planTier] ?? PLAN_COLORS.FREE}`}>
                                {w.planTier}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                              <span className="inline-flex items-center gap-0.5">
                                <Users className="h-2.5 w-2.5" /> {w._count.memberships}
                              </span>
                              <span>·</span>
                              <span>{w._count.leads.toLocaleString()} leads</span>
                              <span>·</span>
                              <span>{w._count.jobs} jobs</span>
                            </div>
                          </div>
                          {isActive && <Check className="h-4 w-4 shrink-0 text-primary" />}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>

              {/* Footer */}
              <div className="border-t bg-muted/20 p-1">
                <button
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-primary hover:bg-primary/10"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create new workspace
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
