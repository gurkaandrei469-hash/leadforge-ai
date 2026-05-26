'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Send, Plus, Mail, Eye, MousePointer, MessageSquare, Loader2, Pause, Play, CheckCircle2, FileEdit, Archive } from 'lucide-react';
import { useApi } from '@/lib/client-api';
import { formatRelative } from '@/lib/utils';

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  status: 'DRAFT' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';
  recipientCount: number;
  sentCount: number;
  openedCount: number;
  clickedCount: number;
  repliedCount: number;
  bouncedCount: number;
  stepCount: number;
  totalRecipients: number;
  sendingAccount: { name: string; fromEmail: string } | null;
  createdAt: string;
  launchedAt: string | null;
  completedAt: string | null;
}

const STATUS_META: Record<string, { color: string; icon: any; label: string }> = {
  DRAFT:     { color: 'bg-slate-500/15 text-slate-600 ring-slate-500/30',     icon: FileEdit,    label: 'Draft'     },
  RUNNING:   { color: 'bg-blue-500/15 text-blue-600 ring-blue-500/30',         icon: Play,        label: 'Running'   },
  PAUSED:    { color: 'bg-amber-500/15 text-amber-600 ring-amber-500/30',      icon: Pause,       label: 'Paused'    },
  COMPLETED: { color: 'bg-emerald-500/15 text-emerald-600 ring-emerald-500/30', icon: CheckCircle2, label: 'Completed' },
  ARCHIVED:  { color: 'bg-slate-500/15 text-slate-500 ring-slate-500/30',      icon: Archive,     label: 'Archived'  },
};

export default function CampaignsPage() {
  const api = useApi();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ campaigns: Campaign[] }>('/campaigns')
      .then((r) => setCampaigns(r.campaigns))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:items-end">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Campaigns</h1>
          <p className="mt-1 text-xs sm:text-sm text-muted-foreground">Multi-step cold outreach with open, click, and reply tracking.</p>
        </div>
        <Link
          href="/campaigns/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-grad-brand px-3 py-2 text-xs font-semibold text-white shadow-sm transition-transform hover:scale-[1.02] sm:gap-2 sm:px-4 sm:text-sm"
        >
          <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          <span className="hidden sm:inline">New campaign</span>
          <span className="sm:hidden">New</span>
        </Link>
      </div>

      {loading ? (
        <div className="card-elevated grid place-items-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : campaigns.length === 0 ? (
        <div className="card-elevated grid place-items-center py-16 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5">
            <Send className="h-7 w-7 text-primary" />
          </div>
          <h3 className="mt-4 font-semibold">No campaigns yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">Reach your leads with a personalized email sequence.</p>
          <Link href="/campaigns/new" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-grad-brand px-4 py-2 text-sm font-semibold text-white shadow-sm">
            <Plus className="h-4 w-4" /> Create your first campaign
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => {
            const status = STATUS_META[c.status] ?? STATUS_META.DRAFT;
            const openRate = c.sentCount > 0 ? Math.round((c.openedCount / c.sentCount) * 100) : 0;
            const replyRate = c.sentCount > 0 ? Math.round((c.repliedCount / c.sentCount) * 100) : 0;
            return (
              <Link
                key={c.id}
                href={`/campaigns/${c.id}`}
                className="card-elevated group block p-3 transition-transform hover:scale-[1.005] active:scale-[0.995] sm:p-5"
              >
                <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-semibold">{c.name}</h3>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${status.color}`}>
                        <status.icon className="h-2.5 w-2.5" />
                        {status.label}
                      </span>
                    </div>
                    {c.description && <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.description}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>{c.stepCount} step{c.stepCount === 1 ? '' : 's'}</span>
                      <span className="hidden sm:inline">·</span>
                      <span>{c.totalRecipients} recipients</span>
                      {c.sendingAccount && (<>
                        <span className="hidden sm:inline">·</span>
                        <span className="truncate font-mono max-w-[180px] sm:max-w-none">{c.sendingAccount.fromEmail}</span>
                      </>)}
                      <span className="hidden sm:inline">·</span>
                      <span>{formatRelative(c.createdAt)}</span>
                    </div>
                  </div>

                  <div className="grid w-full grid-cols-4 gap-1.5 text-center text-xs sm:w-auto sm:gap-2">
                    <StatCol icon={Mail}             value={c.sentCount}    label="Sent"    color="text-blue-500" />
                    <StatCol icon={Eye}              value={openRate + '%'} label="Open"    color="text-emerald-500" />
                    <StatCol icon={MousePointer}     value={c.clickedCount} label="Clicks"  color="text-violet-500" />
                    <StatCol icon={MessageSquare}    value={replyRate + '%'} label="Reply"   color="text-amber-500" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatCol({ icon: Icon, value, label, color }: { icon: any; value: any; label: string; color: string }) {
  return (
    <div className="rounded-md border bg-card px-1.5 py-1.5 sm:min-w-[64px] sm:px-3 sm:py-2">
      <div className={`flex items-center justify-center gap-1 text-xs sm:text-sm font-bold tabular-nums ${color}`}>
        <Icon className="h-3 w-3" />
        {value}
      </div>
      <div className="mt-0.5 text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
