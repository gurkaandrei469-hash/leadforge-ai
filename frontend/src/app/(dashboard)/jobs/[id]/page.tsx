'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import {
  Loader2, Pause, Play, X, Download, ArrowLeft, Plug, Sparkles,
  Activity, Mail, Globe, Target, CheckCircle2, XCircle, Clock, Zap, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useApi, subscribeJobProgress } from '@/lib/client-api';
import { formatRelative } from '@/lib/utils';
import { ProgressRing } from '@/components/ui/progress-ring';
import { Avatar } from '@/components/ui/avatar';

interface Job {
  id: string;
  name: string;
  description: string | null;
  status: 'PENDING' | 'QUEUED' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress: number;
  leadsFound: number;
  leadsVerified: number;
  targetLeads: number;
  pagesScraped: number;
  sources: string[];
  filters: any;
  priority: string;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  estimatedFinishAt: string | null;
  events: { id: string; type: string; message: string; createdAt: string }[];
}

interface Lead {
  id: string;
  email: string | null;
  fullName: string | null;
  jobTitle: string | null;
  companyName: string | null;
  linkedinUrl: string | null;
  qualityScore: number | null;
  verificationStatus: string;
  technologies: string[];
}

const STATUS_PILL: Record<string, { color: string; icon: any; label: string }> = {
  PENDING:   { color: 'bg-slate-500/15 text-slate-600 ring-slate-500/30',   icon: Clock,         label: 'Pending'   },
  QUEUED:    { color: 'bg-slate-500/15 text-slate-600 ring-slate-500/30',   icon: Clock,         label: 'Queued'    },
  RUNNING:   { color: 'bg-blue-500/15 text-blue-600 ring-blue-500/30',      icon: Activity,      label: 'Running'   },
  PAUSED:    { color: 'bg-amber-500/15 text-amber-600 ring-amber-500/30',   icon: Pause,         label: 'Paused'    },
  COMPLETED: { color: 'bg-emerald-500/15 text-emerald-600 ring-emerald-500/30', icon: CheckCircle2, label: 'Completed' },
  FAILED:    { color: 'bg-rose-500/15 text-rose-600 ring-rose-500/30',      icon: XCircle,       label: 'Failed'    },
  CANCELLED: { color: 'bg-slate-500/15 text-slate-500 ring-slate-500/30',   icon: X,             label: 'Cancelled' },
};

const VERIFY_COLORS: Record<string, string> = {
  VALID:     'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  INVALID:   'bg-rose-500/10 text-rose-600 ring-rose-500/30',
  RISKY:     'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  CATCH_ALL: 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  UNKNOWN:   'bg-slate-500/10 text-slate-600 ring-slate-500/30',
  PENDING:   'bg-slate-500/10 text-slate-500 ring-slate-500/30',
};

const EVENT_ICONS: Record<string, { icon: any; color: string }> = {
  started:   { icon: Play,        color: 'text-blue-500'    },
  completed: { icon: CheckCircle2, color: 'text-emerald-500' },
  failed:    { icon: AlertTriangle, color: 'text-rose-500'    },
  paused:    { icon: Pause,       color: 'text-amber-500'   },
};

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const api = useApi();
  const router = useRouter();
  const { getToken } = useAuth();
  const [job, setJob] = useState<Job | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      const [jobRes, leadsRes] = await Promise.all([
        api.get<{ job: Job }>(`/jobs/${id}`),
        api.get<{ leads: Lead[] }>(`/leads?jobId=${id}&pageSize=100`),
      ]);
      if (!active) return;
      setJob(jobRes.job);
      setLeads(leadsRes.leads);
      setLoading(false);
    }
    load();
    const tick = setInterval(load, 3000);
    return () => { active = false; clearInterval(tick); };
  }, [id]);

  useEffect(() => {
    let cleanup: (() => void) | null = null;
    (async () => {
      const token = await getToken();
      if (!token) return;
      cleanup = await subscribeJobProgress(id, token, (p) => {
        setJob((j) => (j ? { ...j, progress: p.progress, leadsFound: p.leadsFound, pagesScraped: p.pagesScraped } : j));
      });
    })();
    return () => { if (cleanup) cleanup(); };
  }, [id, getToken]);

  async function action(verb: 'pause' | 'resume' | 'cancel') {
    try {
      const res = await api.post<{ job: Job }>(`/jobs/${id}/${verb}`, {});
      setJob(res.job);
      toast.success(`Job ${verb}d`);
    } catch (e: any) { toast.error(e.message); }
  }

  async function exportCsv() {
    try {
      await api.post('/exports', { format: 'CSV', jobId: id });
      toast.success('Export queued');
      router.push(`/leads?jobId=${id}`);
    } catch (e: any) { toast.error(e.message); }
  }

  async function pushToHubspot() {
    try {
      const res = await api.post<{ pushed: number; failed: number; skipped: number }>('/integrations/hubspot/push', { job_id: id });
      toast.success(`HubSpot: ${res.pushed} pushed, ${res.skipped} skipped, ${res.failed} failed`);
    } catch (e: any) { toast.error(e.message); }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!job) return <div>Job not found</div>;

  const finished = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status);
  const isRunning = job.status === 'RUNNING';
  const pill = STATUS_PILL[job.status] ?? STATUS_PILL.PENDING!;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Breadcrumb + actions */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/jobs" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Jobs
          </Link>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{job.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ring-1 ring-inset ${pill.color}`}>
              <pill.icon className={`h-3 w-3 ${isRunning ? 'animate-pulse' : ''}`} />
              {pill.label}
            </span>
            <span>·</span>
            <span>{job.sources.join(' · ').toLowerCase()}</span>
            <span>·</span>
            <span>{job.priority.toLowerCase()} priority</span>
            <span>·</span>
            <span>{formatRelative(job.createdAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {isRunning && (
            <button onClick={() => action('pause')} className="inline-flex items-center gap-1 rounded-lg border bg-card px-3 py-1.5 text-sm hover:bg-accent">
              <Pause className="h-3.5 w-3.5" /> Pause
            </button>
          )}
          {job.status === 'PAUSED' && (
            <button onClick={() => action('resume')} className="inline-flex items-center gap-1 rounded-lg border bg-card px-3 py-1.5 text-sm hover:bg-accent">
              <Play className="h-3.5 w-3.5" /> Resume
            </button>
          )}
          {!finished && (
            <button onClick={() => action('cancel')} className="inline-flex items-center gap-1 rounded-lg border border-destructive/50 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10">
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          )}
          {finished && leads.length > 0 && (
            <>
              <button onClick={pushToHubspot} className="inline-flex items-center gap-1 rounded-lg border border-orange-500/40 bg-orange-500/5 px-3 py-1.5 text-sm font-medium text-orange-600 hover:bg-orange-500/10">
                <Plug className="h-3.5 w-3.5" /> HubSpot
              </button>
              <button onClick={exportCsv} className="inline-flex items-center gap-1 rounded-lg bg-grad-brand px-3 py-1.5 text-sm font-semibold text-white shadow-sm">
                <Download className="h-3.5 w-3.5" /> Export CSV
              </button>
            </>
          )}
        </div>
      </div>

      {/* Hero: progress ring + KPI tiles */}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="card-elevated relative overflow-hidden p-6 lg:col-span-2">
          <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-grad-brand opacity-10 blur-3xl" />
          <div className="relative flex flex-col items-center justify-center text-center md:flex-row md:items-center md:gap-6 md:text-left">
            <ProgressRing
              value={job.progress}
              size={132}
              stroke={10}
              className={job.status === 'FAILED' ? 'text-destructive' : 'text-primary'}
              trackClassName="text-muted"
              label={
                <div>
                  <div className="text-3xl font-bold tabular-nums">{Math.round(job.progress)}%</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">progress</div>
                </div>
              }
            />
            <div className="mt-4 md:mt-0">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Leads found</div>
              <div className="text-4xl font-bold tabular-nums tracking-tight">{job.leadsFound}</div>
              <div className="mt-0.5 text-sm text-muted-foreground tabular-nums">of {job.targetLeads.toLocaleString()} target</div>
              {job.estimatedFinishAt && isRunning && (
                <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" /> ETA {new Date(job.estimatedFinishAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
            </div>
          </div>
          {job.errorMessage && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>{job.errorMessage}</div>
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-3 lg:col-span-3">
          <KpiTile icon={Globe}      label="Pages scraped"      value={job.pagesScraped}        tint="from-blue-500/20 to-blue-500/0" iconColor="text-blue-500" />
          <KpiTile icon={Mail}       label="Emails verified"    value={job.leadsVerified}       tint="from-emerald-500/20 to-emerald-500/0" iconColor="text-emerald-500" />
          <KpiTile icon={Target}     label="Target completion"  value={`${Math.round((job.leadsFound / Math.max(job.targetLeads, 1)) * 100)}%`} tint="from-violet-500/20 to-violet-500/0" iconColor="text-violet-500" />
          <div className="card-elevated relative overflow-hidden p-5 sm:col-span-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Zap className="h-3.5 w-3.5" /> Sources
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {job.sources.map((s) => (
                <span key={s} className="rounded-full border bg-muted/50 px-3 py-1 text-xs font-medium">
                  {s.replace(/_/g, ' ').toLowerCase()}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Leads + activity */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card-elevated overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <div>
              <h2 className="font-semibold">Leads found</h2>
              <p className="text-xs text-muted-foreground">{leads.length} extracted so far</p>
            </div>
            <Link href={`/leads?jobId=${id}`} className="text-xs font-medium text-primary hover:underline">
              View all →
            </Link>
          </div>
          {leads.length === 0 ? (
            <div className="grid place-items-center py-16 text-sm text-muted-foreground">
              {isRunning ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" /> Scraping in progress…
                </div>
              ) : (
                <div>No leads found</div>
              )}
            </div>
          ) : (
            <div className="max-h-[480px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground backdrop-blur-sm">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Lead</th>
                    <th className="hidden font-semibold md:table-cell">Title</th>
                    <th className="font-semibold">Score</th>
                    <th className="px-4 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.slice(0, 50).map((l) => (
                    <tr key={l.id} className="border-t border-border/40 transition-colors hover:bg-muted/40">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={l.fullName} email={l.email} size="xs" />
                          <div className="min-w-0">
                            <div className="truncate text-xs font-mono">{l.email ?? '—'}</div>
                            {l.fullName && <div className="truncate text-[10px] text-muted-foreground">{l.fullName}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="hidden max-w-[180px] truncate text-xs text-muted-foreground md:table-cell">{l.jobTitle ?? '—'}</td>
                      <td>
                        {l.qualityScore != null ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums">
                            <div className="h-1.5 w-10 overflow-hidden rounded-full bg-muted">
                              <div className="h-full bg-grad-brand" style={{ width: `${l.qualityScore}%` }} />
                            </div>
                            {l.qualityScore}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${VERIFY_COLORS[l.verificationStatus] ?? ''}`}>
                          <span className="h-1 w-1 rounded-full bg-current" />
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

        <div className="card-elevated">
          <div className="border-b border-border/60 px-5 py-4">
            <h2 className="font-semibold">Activity</h2>
            <p className="text-xs text-muted-foreground">Timeline of events</p>
          </div>
          {job.events.length === 0 ? (
            <div className="grid place-items-center py-12 text-xs text-muted-foreground">No events yet</div>
          ) : (
            <ol className="relative max-h-[480px] overflow-y-auto p-5">
              <div className="absolute bottom-4 left-7 top-5 w-px bg-border" />
              {[...job.events].reverse().map((e, i) => {
                const meta = EVENT_ICONS[e.type] ?? { icon: Activity, color: 'text-muted-foreground' };
                return (
                  <li key={e.id} className="relative mb-5 flex gap-3 last:mb-0">
                    <div className={`relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-background bg-card shadow-sm`}>
                      <meta.icon className={`h-3 w-3 ${meta.color}`} />
                    </div>
                    <div className="flex-1 pt-0.5">
                      <div className="flex justify-between gap-2">
                        <span className="text-sm font-medium capitalize">{e.type}</span>
                        <span className="whitespace-nowrap text-[10px] text-muted-foreground">{formatRelative(e.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{e.message}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiTile({ icon: Icon, label, value, tint, iconColor }: {
  icon: any; label: string; value: string | number; tint: string; iconColor: string;
}) {
  return (
    <div className="card-elevated relative overflow-hidden p-5">
      <div className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br ${tint} blur-2xl`} />
      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <div className={`grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br ${tint}`}>
            <Icon className={`h-4 w-4 ${iconColor}`} />
          </div>
        </div>
        <div className="mt-3 text-2xl font-bold tabular-nums tracking-tight">{value}</div>
      </div>
    </div>
  );
}
