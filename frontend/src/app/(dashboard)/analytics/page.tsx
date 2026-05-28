'use client';
import { useEffect, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, Cell, Legend, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import {
  Users, BadgeCheck, Activity, TrendingUp, ArrowUpRight, BarChart3 as BarIcon, PieChart as PieIcon, Globe,
} from 'lucide-react';
import { useApi } from '@/lib/client-api';
import { Sparkline } from '@/components/ui/sparkline';

interface Overview {
  team: { creditsTotal: number; creditsUsed: number; planTier: string } | null;
  leadCounts: Record<string, number>;
  jobsRunning: number;
  jobsCompleted30d: number;
  leadsAcquired30d: number;
}

const VERIFY_COLORS: Record<string, string> = {
  VALID:     '#10b981',
  RISKY:     '#f59e0b',
  CATCH_ALL: '#f97316',
  INVALID:   '#ef4444',
  UNKNOWN:   '#94a3b8',
  PENDING:   '#64748b',
};

const QUALITY_BUCKET_LABELS: Record<number, { label: string; color: string }> = {
  20:  { label: '0-20',   color: '#94a3b8' },
  40:  { label: '21-40',  color: '#60a5fa' },
  60:  { label: '41-60',  color: '#6366f1' },
  80:  { label: '61-80',  color: '#8b5cf6' },
  100: { label: '81-100', color: '#a855f7' },
};

export default function AnalyticsPage() {
  const api = useApi();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [series, setSeries] = useState<{ day: string; count: number }[]>([]);
  const [niches, setNiches] = useState<{ niche: string | null; count: number }[]>([]);
  const [quality, setQuality] = useState<{ bucket: number; count: number }[]>([]);
  const [sources, setSources] = useState<{ source: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Don't use Promise.all — one failed endpoint shouldn't blank the whole page.
    // Use Promise.allSettled so each chart loads independently.
    Promise.allSettled([
      api.get<Overview>('/analytics/overview'),
      api.get<{ series: { day: string; count: number }[] }>('/analytics/leads-timeseries'),
      api.get<{ niches: { niche: string | null; count: number }[] }>('/analytics/top-niches'),
      api.get<{ buckets: { bucket: number; count: number }[] }>('/analytics/quality-distribution'),
      api.get<{ sources: { source: string; count: number }[] }>('/analytics/sources'),
    ])
      .then(([o, ts, n, q, s]) => {
        if (o.status === 'fulfilled') setOverview(o.value);
        if (ts.status === 'fulfilled') {
          setSeries(
            (ts.value?.series ?? []).map((r) => ({
              day: new Date(r.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
              count: r.count,
            })),
          );
        }
        if (n.status === 'fulfilled') setNiches(n.value?.niches ?? []);
        if (q.status === 'fulfilled') setQuality(q.value?.buckets ?? []);
        if (s.status === 'fulfilled') setSources(s.value?.sources ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  // Compose verification donut data
  const verificationData = overview
    ? Object.entries(overview.leadCounts)
        .filter(([_, v]) => v > 0)
        .map(([status, count]) => ({ status, count, color: VERIFY_COLORS[status] ?? '#94a3b8' }))
    : [];

  const totalLeads = verificationData.reduce((acc, d) => acc + d.count, 0);
  const validPct = totalLeads > 0
    ? Math.round(((overview?.leadCounts.VALID ?? 0) / totalLeads) * 100)
    : 0;

  const KPIS = [
    {
      label: 'Total leads', value: totalLeads.toLocaleString(),
      delta: `+${overview?.leadsAcquired30d ?? 0} this month`, positive: true,
      icon: Users, tint: 'from-blue-500/20 to-blue-500/0', color: 'text-blue-500',
    },
    {
      label: 'Verified emails', value: (overview?.leadCounts.VALID ?? 0).toLocaleString(),
      delta: `${validPct}% of total`, positive: validPct >= 70,
      icon: BadgeCheck, tint: 'from-emerald-500/20 to-emerald-500/0', color: 'text-emerald-500',
    },
    {
      label: 'Jobs completed (30d)', value: (overview?.jobsCompleted30d ?? 0).toString(),
      delta: `${overview?.jobsRunning ?? 0} running now`, positive: true,
      icon: Activity, tint: 'from-violet-500/20 to-violet-500/0', color: 'text-violet-500',
    },
    {
      // Lead extraction has no quota — explicit "Unlimited" reads better than
      // the old subtraction which would have shown a giant 999,999,999 number.
      label: 'Extraction quota',
      value: 'Unlimited',
      delta: overview?.team?.planTier ?? 'FREE',
      positive: true,
      icon: TrendingUp, tint: 'from-amber-500/20 to-amber-500/0', color: 'text-amber-500',
    },
  ];

  if (loading) {
    return <div className="grid place-items-center py-24"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 sm:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Analytics</h1>
        <p className="mt-1 text-xs sm:text-sm text-muted-foreground">Pipeline performance across the last 30 days.</p>
      </div>

      {/* KPI grid */}
      <div className="grid gap-3 grid-cols-2 sm:gap-4 lg:grid-cols-4">
        {KPIS.map((s) => (
          <div key={s.label} className="card-elevated relative overflow-hidden p-3 sm:p-5">
            <div className={`pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-gradient-to-br ${s.tint} blur-2xl`} />
            <div className="relative">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[10px] sm:text-xs font-medium text-muted-foreground">{s.label}</span>
                <div className={`grid h-7 w-7 sm:h-8 sm:w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br ${s.tint}`}>
                  <s.icon className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${s.color}`} />
                </div>
              </div>
              <div className="mt-2 sm:mt-3 truncate text-xl sm:text-3xl font-bold tabular-nums tracking-tight">{s.value}</div>
              <div className={`mt-0.5 truncate text-[10px] sm:text-xs font-semibold ${s.positive ? 'text-emerald-600' : 'text-rose-600'}`}>
                {s.positive && <ArrowUpRight className="mr-0.5 inline h-3 w-3" />}
                {s.delta}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 2-col charts */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        {/* Timeseries area chart — spans 2 cols */}
        <div className="card-elevated p-4 sm:p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold flex items-center gap-2">
                <BarIcon className="h-4 w-4 text-primary" />
                Leads acquired — 30 days
              </h3>
              <p className="text-xs text-muted-foreground">Daily extraction volume</p>
            </div>
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
              +{series.reduce((a, b) => a + b.count, 0).toLocaleString()} total
            </span>
          </div>
          <div className="mt-4 h-[280px] w-full">
            {series.length === 0 ? (
              <EmptyChart label="Run an extraction to populate this chart" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="leadGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.5} vertical={false} />
                  <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                    cursor={{ stroke: 'hsl(var(--primary))', strokeOpacity: 0.3 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fill="url(#leadGrad)"
                    dot={false}
                    activeDot={{ r: 4, fill: 'hsl(var(--primary))', stroke: 'hsl(var(--background))', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Verification donut */}
        <div className="card-elevated p-4 sm:p-6">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <PieIcon className="h-4 w-4 text-primary" />
              Verification mix
            </h3>
            <p className="text-xs text-muted-foreground">Deliverability breakdown</p>
          </div>
          <div className="mt-4 h-[280px] w-full">
            {verificationData.length === 0 ? (
              <EmptyChart label="No verified leads yet" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={verificationData}
                    dataKey="count"
                    nameKey="status"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {verificationData.map((d) => (
                      <Cell key={d.status} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Legend
                    iconType="circle"
                    wrapperStyle={{ fontSize: '11px' }}
                    formatter={(v) => <span className="text-foreground">{v}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Bottom row: niches + quality distribution */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        {/* Top niches */}
        <div className="card-elevated p-4 sm:p-6">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              Top niches
            </h3>
            <p className="text-xs text-muted-foreground">Most-extracted industries</p>
          </div>
          <div className="mt-4 h-[280px] w-full">
            {niches.length === 0 ? (
              <EmptyChart label="No niche data yet — runs need AI classification" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={niches.slice(0, 10).map((n) => ({ ...n, niche: n.niche ?? 'Other' }))}
                  layout="vertical"
                  margin={{ top: 4, right: 32, left: 4, bottom: 0 }}
                >
                  <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.4} horizontal={false} />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="niche" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} width={120} />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                    cursor={{ fill: 'hsl(var(--accent))' }}
                  />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]} fill="url(#nicheGrad)" />
                  <defs>
                    <linearGradient id="nicheGrad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%"   stopColor="hsl(var(--grad-from))" />
                      <stop offset="100%" stopColor="hsl(var(--grad-to))" />
                    </linearGradient>
                  </defs>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Quality score distribution */}
        <div className="card-elevated p-4 sm:p-6">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Quality score distribution
            </h3>
            <p className="text-xs text-muted-foreground">How your leads score on the 0-100 AI rating</p>
          </div>
          <div className="mt-4 h-[280px] w-full">
            {quality.length === 0 ? (
              <EmptyChart label="No scored leads yet" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={quality.map((q) => ({ ...QUALITY_BUCKET_LABELS[q.bucket]!, count: q.count }))}
                  margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                >
                  <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.4} vertical={false} />
                  <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                    cursor={{ fill: 'hsl(var(--accent))' }}
                  />
                  <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                    {quality.map((q) => (
                      <Cell key={q.bucket} fill={QUALITY_BUCKET_LABELS[q.bucket]?.color ?? '#94a3b8'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Source breakdown — full-width strip */}
      {sources.length > 0 && (
        <div className="card-elevated p-4 sm:p-6">
          <div>
            <h3 className="font-semibold">Source breakdown</h3>
            <p className="text-xs text-muted-foreground">Where your leads are coming from</p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {sources.slice(0, 8).map((s) => {
              const max = Math.max(...sources.map((x) => x.count));
              const pct = max > 0 ? (s.count / max) * 100 : 0;
              return (
                <div key={s.source} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{s.source.replace(/_/g, ' ').toLowerCase()}</span>
                    <span className="font-bold tabular-nums">{s.count}</span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-grad-brand" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="grid h-full place-items-center rounded-lg border border-dashed border-border/60 text-center">
      <div>
        <BarIcon className="mx-auto h-10 w-10 text-muted-foreground/40" />
        <p className="mt-2 text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
