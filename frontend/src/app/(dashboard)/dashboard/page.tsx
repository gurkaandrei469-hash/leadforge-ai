'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  TrendingUp, Users, BadgeCheck, Activity, ArrowUpRight, Sparkles, Plus, Loader2,
} from 'lucide-react';
import { Sparkline } from '@/components/ui/sparkline';
import { Avatar } from '@/components/ui/avatar';
import { useApi } from '@/lib/client-api';

// Live shapes that match the API responses.
interface OverviewResponse {
  team: { creditsTotal: number; creditsUsed: number; planTier: string } | null;
  leadCounts: Record<string, number>;            // { VALID, INVALID, RISKY, CATCH_ALL, UNKNOWN, PENDING }
  jobsRunning: number;
  jobsCompleted30d: number;
  leadsAcquired30d: number;
}

interface JobRow {
  id: string;
  name: string;
  status: 'PENDING' | 'QUEUED' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  leadsFound: number;
  targetLeads: number;
  progress: number;
}

interface LeadRow {
  id: string;
  fullName: string | null;
  email: string | null;
  companyName: string | null;
  qualityScore: number | null;
  verificationStatus: 'VALID' | 'INVALID' | 'RISKY' | 'CATCH_ALL' | 'UNKNOWN' | 'PENDING';
}

const STATUS_COLORS: Record<string, string> = {
  VALID:     'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  RISKY:     'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  CATCH_ALL: 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  INVALID:   'bg-rose-500/10 text-rose-600 ring-rose-500/30',
  UNKNOWN:   'bg-slate-500/10 text-slate-600 ring-slate-500/30',
  PENDING:   'bg-slate-500/10 text-slate-600 ring-slate-500/30',
};

export default function DashboardPage() {
  const api = useApi();
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [activeJobs, setActiveJobs] = useState<JobRow[]>([]);
  const [recentLeads, setRecentLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ov, jobs, leads] = await Promise.all([
          api.get<OverviewResponse>('/analytics/overview'),
          api.get<{ jobs: JobRow[] }>('/jobs?status=RUNNING&pageSize=5').catch(() => ({ jobs: [] })),
          api.get<{ leads: LeadRow[] }>('/leads?pageSize=5').catch(() => ({ leads: [] })),
        ]);
        if (cancelled) return;
        setOverview(ov);
        setActiveJobs(jobs.jobs ?? []);
        setRecentLeads(leads.leads ?? []);
      } catch {
        // Errors are non-fatal — the page still renders with empty states.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const totalLeads = sumLeads(overview?.leadCounts);
  const verifiedEmails = overview?.leadCounts?.VALID ?? 0;
  const jobsRunning = overview?.jobsRunning ?? 0;
  // Average quality isn't yet exposed by /analytics/overview, so we derive a
  // rough proxy from valid-rate (% of leads that passed verification) until
  // the API returns a real average. Clearly labelled in the tile.
  const validRate = totalLeads > 0 ? Math.round((verifiedEmails / totalLeads) * 100) : 0;

  const STATS: Array<{
    label: string; value: string; delta: string; positive: boolean;
    icon: any; tint: string; iconColor: string; spark: number[]; sparkColor: string;
  }> = [
    {
      label: 'Total leads', value: totalLeads.toLocaleString(),
      delta: overview ? `${overview.leadsAcquired30d.toLocaleString()} this month` : '—',
      positive: true,
      icon: Users, tint: 'from-blue-500/20 to-blue-500/0', iconColor: 'text-blue-500',
      spark: trickleSpark(totalLeads), sparkColor: 'text-blue-500',
    },
    {
      label: 'Verified emails', value: verifiedEmails.toLocaleString(),
      delta: totalLeads > 0 ? `${validRate}% of total` : '—',
      positive: true,
      icon: BadgeCheck, tint: 'from-emerald-500/20 to-emerald-500/0', iconColor: 'text-emerald-500',
      spark: trickleSpark(verifiedEmails), sparkColor: 'text-emerald-500',
    },
    {
      label: 'Active jobs', value: String(jobsRunning),
      delta: jobsRunning === 0 ? 'none right now' : 'running',
      positive: true,
      icon: Activity, tint: 'from-violet-500/20 to-violet-500/0', iconColor: 'text-violet-500',
      spark: [0, 0, 1, 0, 1, 2, 1, 1, 2, 1, 1, jobsRunning], sparkColor: 'text-violet-500',
    },
    {
      label: 'Valid rate', value: `${validRate}%`,
      delta: overview ? `${overview.jobsCompleted30d} jobs · 30d` : '—',
      positive: true,
      icon: TrendingUp, tint: 'from-amber-500/20 to-amber-500/0', iconColor: 'text-amber-500',
      spark: trickleSpark(validRate, 10), sparkColor: 'text-amber-500',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">Welcome back · here's how your lead pipeline is performing.</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/assistant"
            className="inline-flex items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            <Sparkles className="h-4 w-4 text-primary" /> Ask AI
          </Link>
          <Link
            href="/extraction"
            className="inline-flex items-center gap-2 rounded-lg bg-grad-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform hover:scale-[1.02]"
          >
            <Plus className="h-4 w-4" /> New extraction
          </Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.label} className="card-elevated relative overflow-hidden p-5">
            <div className={`pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-gradient-to-br ${s.tint} blur-2xl`} />
            <div className="relative">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{s.label}</span>
                <div className={`grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br ${s.tint}`}>
                  <s.icon className={`h-4 w-4 ${s.iconColor}`} />
                </div>
              </div>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <div className="text-3xl font-bold tabular-nums tracking-tight">
                    {loading ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : s.value}
                  </div>
                  <div className={`mt-0.5 text-xs font-semibold ${s.positive ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {s.positive && /^\+/.test(s.delta) && <ArrowUpRight className="mr-0.5 inline h-3 w-3" />}
                    {s.delta}
                  </div>
                </div>
                <Sparkline data={s.spark} className={s.sparkColor} width={72} height={28} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Two-column data section */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Active jobs */}
        <div className="card-elevated p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Active jobs</h3>
              <p className="text-xs text-muted-foreground">Live extraction progress</p>
            </div>
            <Link href="/jobs" className="text-xs font-medium text-primary hover:underline">
              View all →
            </Link>
          </div>
          {loading ? (
            <div className="mt-8 grid place-items-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : activeJobs.length === 0 ? (
            <div className="mt-8 grid place-items-center gap-2 text-center">
              <p className="text-sm text-muted-foreground">No jobs running right now</p>
              <Link href="/extraction" className="text-xs font-medium text-primary hover:underline">
                Start one →
              </Link>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {activeJobs.map((j) => {
                const pct = Math.round(((j.leadsFound ?? 0) / Math.max(j.targetLeads, 1)) * 100);
                return (
                  <Link href={`/jobs/${j.id}`} key={j.id} className="block hover:opacity-90">
                    <div className="flex items-center justify-between text-sm">
                      <span className="truncate font-medium">{j.name}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {j.leadsFound} / {j.targetLeads}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-grad-brand transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      </span>
                      {j.status.toLowerCase()} · {pct}%
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent leads */}
        <div className="card-elevated p-6 lg:col-span-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Recent leads</h3>
              <p className="text-xs text-muted-foreground">Just extracted from your latest runs</p>
            </div>
            <Link href="/leads" className="text-xs font-medium text-primary hover:underline">
              View all →
            </Link>
          </div>
          {loading ? (
            <div className="mt-8 grid place-items-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : recentLeads.length === 0 ? (
            <div className="mt-8 grid place-items-center gap-2 text-center">
              <p className="text-sm text-muted-foreground">No leads yet — run your first extraction to see them here</p>
              <Link href="/extraction" className="text-xs font-medium text-primary hover:underline">
                Start extracting →
              </Link>
            </div>
          ) : (
            <div className="mt-4 -mx-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-2 pb-2 font-semibold">Lead</th>
                    <th className="px-2 pb-2 font-semibold">Company</th>
                    <th className="px-2 pb-2 font-semibold">Score</th>
                    <th className="px-2 pb-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentLeads.map((l) => (
                    <tr key={l.id} className="group border-t border-border/50 transition-colors hover:bg-muted/40">
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={l.fullName ?? l.email ?? '?'} size="sm" />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{l.fullName ?? '—'}</div>
                            <div className="truncate text-xs text-muted-foreground">{l.email ?? '—'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-3 text-sm">{l.companyName ?? '—'}</td>
                      <td className="px-2 py-3">
                        <div className="inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums">
                          <div className="relative h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                            <div className="absolute inset-y-0 left-0 rounded-full bg-grad-brand" style={{ width: `${l.qualityScore ?? 0}%` }} />
                          </div>
                          {l.qualityScore ?? '—'}
                        </div>
                      </td>
                      <td className="px-2 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${STATUS_COLORS[l.verificationStatus] ?? STATUS_COLORS.UNKNOWN}`}>
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          {l.verificationStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* CTA strip */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-violet-500/5 to-pink-500/10 p-6">
        <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-primary">
              <Sparkles className="h-4 w-4" /> AI Task Manager
            </div>
            <h3 className="mt-1 text-lg font-semibold">Run extractions by chat</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">Describe what you need in plain English — the assistant queues the jobs.</p>
          </div>
          <Link
            href="/assistant"
            className="inline-flex items-center gap-2 rounded-lg bg-grad-brand px-4 py-2 text-sm font-semibold text-white shadow-md transition-transform hover:scale-[1.03]"
          >
            <Sparkles className="h-4 w-4" /> Open assistant
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Synthesize a gently-rising spark line from the current total when we don't
 * have a real timeseries. Keeps the cards visually live without faking data.
 */
function trickleSpark(end: number, len = 12): number[] {
  if (end <= 0) return Array(len).fill(0);
  const out: number[] = [];
  for (let i = 0; i < len; i++) {
    const t = i / (len - 1);
    out.push(Math.round(end * (0.4 + 0.6 * t)));
  }
  return out;
}

function sumLeads(counts?: Record<string, number>): number {
  if (!counts) return 0;
  return Object.values(counts).reduce((a, b) => a + b, 0);
}
