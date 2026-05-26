import Link from 'next/link';
import {
  TrendingUp, Users, BadgeCheck, Activity, ArrowRight, ArrowUpRight, Sparkles, Plus,
} from 'lucide-react';
import { Sparkline } from '@/components/ui/sparkline';
import { Avatar } from '@/components/ui/avatar';

// In production these'd come from /analytics/overview + leads-timeseries.
// Today they're representative placeholders so the page reads as live.
const STATS = [
  {
    label: 'Total leads',     value: '12,418', delta: '+8.2%',  positive: true,
    icon: Users,              tint: 'from-blue-500/20 to-blue-500/0',     iconColor: 'text-blue-500',
    spark: [12, 15, 13, 18, 21, 24, 22, 28, 30, 27, 32, 38],
    sparkColor: 'text-blue-500',
  },
  {
    label: 'Verified emails', value: '9,237',  delta: '+11.4%', positive: true,
    icon: BadgeCheck,         tint: 'from-emerald-500/20 to-emerald-500/0', iconColor: 'text-emerald-500',
    spark: [40, 42, 45, 43, 48, 52, 55, 58, 62, 65, 68, 74],
    sparkColor: 'text-emerald-500',
  },
  {
    label: 'Active jobs',     value: '3',      delta: 'running',positive: true,
    icon: Activity,           tint: 'from-violet-500/20 to-violet-500/0',   iconColor: 'text-violet-500',
    spark: [1, 2, 1, 0, 1, 2, 2, 3, 2, 3, 3, 3],
    sparkColor: 'text-violet-500',
  },
  {
    label: 'Avg quality score', value: '72.4', delta: '+2.1',   positive: true,
    icon: TrendingUp,         tint: 'from-amber-500/20 to-amber-500/0',     iconColor: 'text-amber-500',
    spark: [62, 64, 65, 63, 66, 68, 67, 70, 71, 70, 72, 72],
    sparkColor: 'text-amber-500',
  },
];

const ACTIVE_JOBS = [
  { name: 'SaaS founders — US',         leadsFound: 128, target: 200, status: 'RUNNING' },
  { name: 'Shopify stores — beauty',     leadsFound: 44,  target: 200, status: 'RUNNING' },
  { name: 'Marketing agencies — EU',     leadsFound: 182, target: 200, status: 'RUNNING' },
];

const RECENT_LEADS = [
  { name: 'Anna Müller',  email: 'anna@stripe-clone.io',  company: 'Stripe Clone', score: 92, status: 'VALID' },
  { name: 'Tom Chen',     email: 'tom@retailpro.shop',    company: 'RetailPro',    score: 78, status: 'VALID' },
  { name: 'Lina Park',    email: 'lina@acme-saas.io',     company: 'Acme SaaS',    score: 85, status: 'VALID' },
  { name: 'Marcus Reyes', email: 'marcus@orbital.ai',     company: 'Orbital Labs', score: 71, status: 'RISKY' },
  { name: 'Hannah Bauer', email: 'hannah@flux-eng.com',   company: 'Flux Eng',     score: 65, status: 'VALID' },
];

const STATUS_COLORS: Record<string, string> = {
  VALID:   'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  RISKY:   'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  INVALID: 'bg-rose-500/10 text-rose-600 ring-rose-500/30',
};

export default function DashboardPage() {
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
                  <div className="text-3xl font-bold tabular-nums tracking-tight">{s.value}</div>
                  <div className={`mt-0.5 text-xs font-semibold ${s.positive ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {s.positive && s.delta.startsWith('+') && <ArrowUpRight className="mr-0.5 inline h-3 w-3" />}
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
          <div className="mt-5 space-y-4">
            {ACTIVE_JOBS.map((j) => {
              const pct = Math.round((j.leadsFound / j.target) * 100);
              return (
                <div key={j.name}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate font-medium">{j.name}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {j.leadsFound} / {j.target}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-grad-brand transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    </span>
                    {j.status.toLowerCase()} · {pct}%
                  </div>
                </div>
              );
            })}
          </div>
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
                {RECENT_LEADS.map((l) => (
                  <tr key={l.email} className="group border-t border-border/50 transition-colors hover:bg-muted/40">
                    <td className="px-2 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={l.name} size="sm" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{l.name}</div>
                          <div className="truncate text-xs text-muted-foreground">{l.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-3 text-sm">{l.company}</td>
                    <td className="px-2 py-3">
                      <div className="inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums">
                        <div className="relative h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                          <div
                            className="absolute inset-y-0 left-0 rounded-full bg-grad-brand"
                            style={{ width: `${l.score}%` }}
                          />
                        </div>
                        {l.score}
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${STATUS_COLORS[l.status]}`}>
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {l.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
            <p className="mt-0.5 text-sm text-muted-foreground">
              "Extract 50 marketing director emails from US SaaS companies" — and it just happens.
            </p>
          </div>
          <Link
            href="/assistant"
            className="inline-flex items-center gap-2 rounded-lg bg-grad-brand px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-transform hover:scale-[1.02]"
          >
            Try it <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
