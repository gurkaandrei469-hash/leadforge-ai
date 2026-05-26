'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Activity, Mail, CheckCircle2, XCircle, Clock, Eye, MousePointer,
  MessageSquare, AlertTriangle, Loader2, Pause, Sparkles,
} from 'lucide-react';
import { useApi } from '@/lib/client-api';
import { formatRelative } from '@/lib/utils';

type SendStatus = 'PENDING' | 'SENT' | 'FAILED' | 'BOUNCED' | 'REPLIED';

interface Activity {
  id: string;
  status: SendStatus;
  toEmail: string;
  leadName: string | null;
  subject: string;
  errorMessage: string | null;
  createdAt: string;
  sentAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  repliedAt: string | null;
  events: Array<{ id: string; type: string; createdAt: string }>;
}

interface ActivityResponse {
  activity: Activity[];
  stats: { queued: number; inProgress: number; sent: number; failed: number };
  lastTickAt: string;
}

const STATUS_META: Record<SendStatus, { color: string; ring: string; icon: any; label: string; dot: string }> = {
  PENDING:  { color: 'text-blue-600',     ring: 'ring-blue-500/30',     icon: Loader2,      label: 'Sending',  dot: 'bg-blue-500' },
  SENT:     { color: 'text-emerald-600',  ring: 'ring-emerald-500/30',  icon: CheckCircle2, label: 'Sent',     dot: 'bg-emerald-500' },
  FAILED:   { color: 'text-rose-600',     ring: 'ring-rose-500/30',     icon: XCircle,      label: 'Failed',   dot: 'bg-rose-500' },
  BOUNCED:  { color: 'text-amber-600',    ring: 'ring-amber-500/30',    icon: AlertTriangle,label: 'Bounced',  dot: 'bg-amber-500' },
  REPLIED:  { color: 'text-violet-600',   ring: 'ring-violet-500/30',   icon: MessageSquare,label: 'Replied',  dot: 'bg-violet-500' },
};

export function CampaignLiveMonitor({
  campaignId,
  campaignStatus,
  totalRecipients,
}: {
  campaignId: string;
  campaignStatus: 'DRAFT' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';
  totalRecipients: number;
}) {
  const api = useApi();
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [pulse, setPulse] = useState(false);
  const seenIds = useRef<Set<string>>(new Set());
  const audioCtx = useRef<AudioContext | null>(null);

  // Poll fast when RUNNING, slow when paused/completed
  const pollInterval = campaignStatus === 'RUNNING' ? 2500 : campaignStatus === 'PAUSED' ? 10000 : 15000;

  async function load() {
    try {
      const res = await api.get<ActivityResponse>(`/campaigns/${campaignId}/activity`);
      // Detect new events for the pulse animation + audio chirp
      const newOnes = res.activity.filter((a) => !seenIds.current.has(a.id));
      if (newOnes.length > 0 && data) {
        // Only pulse on subsequent loads, not initial mount
        setPulse(true);
        setTimeout(() => setPulse(false), 600);
        playSoftChirp();
      }
      res.activity.forEach((a) => seenIds.current.add(a.id));
      setData(res);
    } catch { /* silently ignore — keep last good state */ }
  }

  useEffect(() => {
    load();
    const tick = setInterval(load, pollInterval);
    return () => clearInterval(tick);
  }, [campaignId, pollInterval]);

  // Lazy-init audio context for the soft "ping" on new sends
  function playSoftChirp() {
    try {
      if (!audioCtx.current) audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = audioCtx.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.04, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
      osc.start();
      osc.stop(ctx.currentTime + 0.16);
    } catch { /* audio disabled — harmless */ }
  }

  if (!data) {
    return (
      <div className="card-elevated p-6">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading live monitor…</span>
        </div>
      </div>
    );
  }

  const { activity, stats } = data;
  const totalProcessed = stats.sent + stats.failed;
  const progressPct = totalRecipients > 0 ? Math.round((totalProcessed / totalRecipients) * 100) : 0;
  const isLive = campaignStatus === 'RUNNING';

  return (
    <div className="card-elevated overflow-hidden">
      {/* Header */}
      <div className={`flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5 ${pulse ? 'bg-primary/5' : ''} transition-colors`}>
        <div className="flex items-center gap-3">
          <div className="relative grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-primary/20 to-primary/5">
            <Activity className={`h-4 w-4 text-primary ${isLive ? 'animate-pulse' : ''}`} />
            {isLive && (
              <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Live sending monitor</h2>
              <StatusPill status={campaignStatus} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {isLive
                ? `Polling every ${pollInterval / 1000}s · last refresh ${formatRelative(data.lastTickAt)}`
                : campaignStatus === 'PAUSED' ? 'Paused — monitor still tracking'
                : campaignStatus === 'COMPLETED' ? 'Sequence complete'
                : 'Idle — launch the campaign to begin sending'}
            </p>
          </div>
        </div>

        {/* Quick stats */}
        <div className="flex items-center gap-2">
          <StatChip icon={Clock}        label="Queued"   value={stats.queued}     color="text-slate-600 bg-slate-500/10" />
          <StatChip icon={Loader2}      label="In flight" value={stats.inProgress} color="text-blue-600 bg-blue-500/10" pulse={stats.inProgress > 0 && isLive} />
          <StatChip icon={CheckCircle2} label="Sent"     value={stats.sent}       color="text-emerald-600 bg-emerald-500/10" />
          {stats.failed > 0 && (
            <StatChip icon={XCircle}    label="Failed"   value={stats.failed}     color="text-rose-600 bg-rose-500/10" />
          )}
        </div>
      </div>

      {/* Progress bar */}
      {totalRecipients > 0 && (
        <div className="border-b bg-muted/20 px-5 py-2.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Overall progress</span>
            <span className="font-semibold tabular-nums">
              {totalProcessed}/{totalRecipients} ({progressPct}%)
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 via-violet-500 to-emerald-500 transition-all duration-700 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Activity feed */}
      <div className="max-h-[400px] overflow-y-auto">
        {activity.length === 0 ? (
          <EmptyFeed status={campaignStatus} />
        ) : (
          <ul className="divide-y divide-border/40">
            {activity.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ActivityRow({ item }: { item: Activity }) {
  const meta = STATUS_META[item.status] ?? STATUS_META.PENDING;
  const Icon = meta.icon;
  const ts = item.sentAt ?? item.createdAt;

  // Build sub-events line (Opened, Clicked, Replied)
  const subEvents: Array<{ icon: any; label: string; color: string }> = [];
  if (item.repliedAt) subEvents.push({ icon: MessageSquare, label: 'Replied', color: 'text-violet-600' });
  if (item.clickedAt) subEvents.push({ icon: MousePointer, label: 'Clicked', color: 'text-cyan-600' });
  if (item.openedAt)  subEvents.push({ icon: Eye, label: 'Opened', color: 'text-amber-600' });

  return (
    <li className="group flex items-start gap-3 px-5 py-3 transition-colors hover:bg-muted/30">
      <div className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-card ring-1 ring-inset ${meta.ring}`}>
        <Icon className={`h-3.5 w-3.5 ${meta.color} ${item.status === 'PENDING' ? 'animate-spin' : ''}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${meta.color} bg-current/10`}>
            {meta.label.toUpperCase()}
          </span>
          <span className="truncate text-sm font-medium">
            {item.leadName ?? item.toEmail.split('@')[0]}
          </span>
          <span className="truncate text-xs font-mono text-muted-foreground">{item.toEmail}</span>
          <span className="ml-auto whitespace-nowrap text-[10px] text-muted-foreground">{formatRelative(ts)}</span>
        </div>

        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {item.subject}
        </div>

        {/* Tracking sub-events */}
        {subEvents.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {subEvents.map((e) => (
              <span key={e.label} className={`inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] ${e.color}`}>
                <e.icon className="h-2.5 w-2.5" />
                {e.label}
              </span>
            ))}
          </div>
        )}

        {/* Error inline */}
        {item.errorMessage && (
          <div className="mt-1.5 rounded-md border border-rose-500/20 bg-rose-500/5 p-2">
            <div className="flex items-start gap-1.5 text-[11px] text-rose-700 dark:text-rose-300">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{item.errorMessage}</span>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

function EmptyFeed({ status }: { status: string }) {
  return (
    <div className="grid place-items-center py-12 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-primary/10 to-primary/0">
        <Mail className="h-6 w-6 text-primary/60" />
      </div>
      <p className="mt-3 text-sm font-medium">
        {status === 'DRAFT' ? 'No sends yet' : status === 'RUNNING' ? 'Waiting for first send…' : 'No activity'}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {status === 'DRAFT'
          ? 'Activity will appear here the moment you launch.'
          : status === 'RUNNING'
            ? 'The worker ticks every 30 seconds. First send should land any moment.'
            : 'Activity will appear here when the campaign runs.'}
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === 'RUNNING'   ? 'bg-emerald-500/15 text-emerald-600 ring-emerald-500/30' :
    status === 'PAUSED'    ? 'bg-amber-500/15 text-amber-600 ring-amber-500/30' :
    status === 'COMPLETED' ? 'bg-blue-500/15 text-blue-600 ring-blue-500/30' :
                              'bg-slate-500/15 text-slate-600 ring-slate-500/30';
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold tracking-wider ring-1 ring-inset ${cls}`}>
      {status}
    </span>
  );
}

function StatChip({
  icon: Icon, label, value, color, pulse,
}: { icon: any; label: string; value: number; color: string; pulse?: boolean }) {
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${color}`}>
      <Icon className={`h-3 w-3 ${pulse ? 'animate-spin' : ''}`} />
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="text-[10px] uppercase tracking-wider opacity-80">{label}</span>
    </div>
  );
}
