'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Loader2, Mail, Eye, MousePointer, MessageSquare, AlertTriangle,
  Play, Pause, Plus, Trash2, ChevronRight, Send, AtSign, CheckCircle2, Edit3, ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { useApi, ApiError } from '@/lib/client-api';
import { Avatar } from '@/components/ui/avatar';
import { formatRelative } from '@/lib/utils';
import { CampaignLiveMonitor } from '@/components/campaigns/live-monitor';

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
  unsubCount: number;
  dailyLimit: number;
  steps: Array<{ id: string; order: number; subject: string; body: string; delayDays: number }>;
  sendingAccount: { id: string; name: string; fromEmail: string; provider: string; dailyLimit: number; sentToday: number } | null;
  createdAt: string;
  launchedAt: string | null;
  completedAt: string | null;
  _count: { recipients: number; sends: number };
}

interface Recipient {
  id: string;
  status: string;
  currentStep: number;
  lastSentAt: string | null;
  lead: { id: string; email: string | null; fullName: string | null; companyName: string | null; qualityScore: number | null };
  _count: { sends: number };
}

interface LeadList {
  id: string;
  name: string;
  leadCount: number;
}

interface SendingAccount {
  id: string;
  name: string;
  fromName: string;
  fromEmail: string;
  provider: 'SMTP' | 'GMAIL_OAUTH' | 'SENDGRID' | 'SES';
  dailyLimit: number;
  sentToday: number;
  isActive: boolean;
  imapEnabled?: boolean;
}

const PROVIDER_META: Record<SendingAccount['provider'], { label: string; color: string }> = {
  GMAIL_OAUTH: { label: 'Gmail',   color: 'bg-red-500/10 text-red-600 ring-red-500/30' },
  SMTP:        { label: 'SMTP',    color: 'bg-slate-500/10 text-slate-600 ring-slate-500/30' },
  SENDGRID:    { label: 'SendGrid',color: 'bg-blue-500/10 text-blue-600 ring-blue-500/30' },
  SES:         { label: 'SES',     color: 'bg-amber-500/10 text-amber-600 ring-amber-500/30' },
};

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const api = useApi();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [lists, setLists] = useState<LeadList[]>([]);
  const [sendingAccounts, setSendingAccounts] = useState<SendingAccount[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [pickedListId, setPickedListId] = useState('');
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  async function load() {
    const [c, r, l, a] = await Promise.all([
      api.get<{ campaign: Campaign }>(`/campaigns/${id}`),
      api.get<{ recipients: Recipient[] }>(`/campaigns/${id}/recipients`),
      api.get<{ lists: LeadList[] }>('/lead-lists'),
      api.get<{ accounts: SendingAccount[] }>('/sending-accounts'),
    ]);
    setCampaign(c.campaign);
    setRecipients(r.recipients);
    setLists(l.lists);
    setSendingAccounts(a.accounts);
    setLoading(false);
  }

  async function setSendingAccount(accountId: string | null) {
    try {
      await api.patch(`/campaigns/${id}`, { sendingAccountId: accountId });
      toast.success(accountId ? 'Sending account updated' : 'Sending account cleared');
      setShowAccountPicker(false);
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to update');
    }
  }
  useEffect(() => {
    load();
    const tick = setInterval(load, 8000);
    return () => clearInterval(tick);
  }, [id]);

  async function launch() {
    setActing(true);
    try {
      await api.post(`/campaigns/${id}/launch`, {});
      toast.success('Campaign launched');
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to launch');
    } finally { setActing(false); }
  }

  async function pause() {
    setActing(true);
    try {
      await api.post(`/campaigns/${id}/pause`, {});
      toast.success('Campaign paused');
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setActing(false); }
  }

  async function addFromList() {
    if (!pickedListId) return;
    try {
      const res = await api.post<{ added: number }>(`/campaigns/${id}/recipients`, { listId: pickedListId });
      toast.success(`Added ${res.added} recipients`);
      setShowAdd(false);
      setPickedListId('');
      load();
    } catch (e: any) { toast.error(e.message); }
  }

  async function remove() {
    if (!confirm('Delete this campaign? All sends are kept for compliance.')) return;
    try {
      await api.del(`/campaigns/${id}`);
      toast.success('Deleted');
      window.location.href = '/campaigns';
    } catch (e: any) { toast.error(e.message); }
  }

  if (loading) return <div className="grid place-items-center py-24"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!campaign) return <div>Not found</div>;

  const openRate = campaign.sentCount > 0 ? Math.round((campaign.openedCount / campaign.sentCount) * 100) : 0;
  const clickRate = campaign.sentCount > 0 ? Math.round((campaign.clickedCount / campaign.sentCount) * 100) : 0;
  const replyRate = campaign.sentCount > 0 ? Math.round((campaign.repliedCount / campaign.sentCount) * 100) : 0;
  const bounceRate = campaign.sentCount > 0 ? Math.round((campaign.bouncedCount / campaign.sentCount) * 100) : 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <Link href="/campaigns" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Campaigns
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">{campaign.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
              campaign.status === 'RUNNING' ? 'bg-blue-500/15 text-blue-600 ring-blue-500/30'
              : campaign.status === 'COMPLETED' ? 'bg-emerald-500/15 text-emerald-600 ring-emerald-500/30'
              : campaign.status === 'PAUSED' ? 'bg-amber-500/15 text-amber-600 ring-amber-500/30'
              : 'bg-slate-500/15 text-slate-600 ring-slate-500/30'
            }`}>
              {campaign.status}
            </span>
            <span>{campaign.steps.length} steps</span>
            <span>·</span>
            <span>{campaign._count.recipients} recipients</span>
            <span>·</span>
            <span>{formatRelative(campaign.createdAt)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {campaign.status === 'DRAFT' && (
            <button
              onClick={launch}
              disabled={acting || campaign._count.recipients === 0 || !campaign.sendingAccount}
              title={
                !campaign.sendingAccount ? 'Pick a sending account first' :
                campaign._count.recipients === 0 ? 'Add at least one recipient' : ''
              }
              className="inline-flex items-center gap-1 rounded-lg bg-grad-brand px-3 py-1.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" /> Launch
            </button>
          )}
          {campaign.status === 'RUNNING' && (
            <button
              onClick={pause}
              disabled={acting}
              className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-accent"
            >
              <Pause className="h-3.5 w-3.5" /> Pause
            </button>
          )}
          {campaign.status === 'PAUSED' && (
            <button
              onClick={launch}
              disabled={acting}
              className="inline-flex items-center gap-1 rounded-lg bg-grad-brand px-3 py-1.5 text-sm font-semibold text-white shadow-sm"
            >
              <Play className="h-3.5 w-3.5" /> Resume
            </button>
          )}
          <button onClick={remove} className="rounded-lg border border-destructive/40 p-1.5 text-destructive hover:bg-destructive/10">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Sending account card — only editable in DRAFT */}
      <SendingAccountCard
        account={campaign.sendingAccount}
        canEdit={campaign.status === 'DRAFT' || campaign.status === 'PAUSED'}
        onPickClick={() => setShowAccountPicker(true)}
      />

      {/* KPI row */}
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Recipients" value={campaign._count.recipients} icon={Send} color="text-blue-500" tint="from-blue-500/20 to-blue-500/0" />
        <Kpi label="Sent"       value={campaign.sentCount} icon={Mail} color="text-violet-500" tint="from-violet-500/20 to-violet-500/0" />
        <Kpi label="Opens"      value={`${openRate}%`} icon={Eye} color="text-emerald-500" tint="from-emerald-500/20 to-emerald-500/0" sub={`${campaign.openedCount} total`} />
        <Kpi label="Clicks"     value={`${clickRate}%`} icon={MousePointer} color="text-cyan-500" tint="from-cyan-500/20 to-cyan-500/0" sub={`${campaign.clickedCount} total`} />
        <Kpi label="Replies"    value={`${replyRate}%`} icon={MessageSquare} color="text-amber-500" tint="from-amber-500/20 to-amber-500/0" sub={`${campaign.repliedCount} total`} />
        <Kpi label="Bounces"    value={`${bounceRate}%`} icon={AlertTriangle} color="text-rose-500" tint="from-rose-500/20 to-rose-500/0" sub={`${campaign.bouncedCount} total`} />
      </div>

      {/* Live sending monitor */}
      <CampaignLiveMonitor
        campaignId={campaign.id}
        campaignStatus={campaign.status}
        totalRecipients={campaign._count.recipients}
      />

      {/* Steps + Recipients */}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="card-elevated overflow-hidden lg:col-span-3">
          <div className="border-b border-border/60 px-5 py-4">
            <h2 className="font-semibold">Sequence</h2>
            <p className="text-xs text-muted-foreground">Steps run in order, with the configured delay between each.</p>
          </div>
          <div className="divide-y divide-border/40">
            {campaign.steps.map((step, i) => (
              <div key={step.id} className="p-5">
                <div className="flex items-center gap-3">
                  <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 text-sm font-bold text-primary">
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">
                      {i === 0 ? 'First touch' : `Follow-up #${i}`}
                      {step.delayDays > 0 && (
                        <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          +{step.delayDays}d
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground font-mono">{step.subject}</div>
                  </div>
                </div>
                <pre className="mt-3 max-h-40 overflow-auto rounded-md border bg-muted/30 p-3 text-[11px] leading-relaxed whitespace-pre-wrap">
                  {step.body}
                </pre>
              </div>
            ))}
          </div>
        </div>

        <div className="card-elevated overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <div>
              <h2 className="font-semibold">Recipients</h2>
              <p className="text-xs text-muted-foreground">{recipients.length} of {campaign._count.recipients}</p>
            </div>
            {campaign.status === 'DRAFT' && (
              <button
                onClick={() => setShowAdd(!showAdd)}
                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent"
              >
                <Plus className="h-3 w-3" /> Add
              </button>
            )}
          </div>

          {showAdd && (
            <div className="border-b border-border/60 bg-muted/20 p-4">
              <label className="block text-xs font-medium text-muted-foreground">Add from list</label>
              <div className="mt-1 flex gap-2">
                <select value={pickedListId} onChange={(e) => setPickedListId(e.target.value)} className="flex-1 rounded-md border bg-background px-2 py-1 text-xs">
                  <option value="">— pick a list —</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>{l.name} ({l.leadCount})</option>
                  ))}
                </select>
                <button onClick={addFromList} disabled={!pickedListId} className="rounded-md bg-grad-brand px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
                  Add
                </button>
              </div>
            </div>
          )}

          {recipients.length === 0 ? (
            <div className="grid place-items-center py-12 text-center">
              <Send className="h-8 w-8 text-muted-foreground/40" />
              <p className="mt-2 text-xs text-muted-foreground">No recipients yet.</p>
              {campaign.status === 'DRAFT' && (
                <p className="mt-1 text-xs text-muted-foreground">Add some from a saved list.</p>
              )}
            </div>
          ) : (
            <ul className="max-h-[520px] divide-y divide-border/40 overflow-y-auto">
              {recipients.map((r) => (
                <li key={r.id} className="flex items-center gap-2.5 p-3 hover:bg-muted/30">
                  <Avatar name={r.lead.fullName} email={r.lead.email} size="xs" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{r.lead.fullName ?? r.lead.email}</div>
                    <div className="truncate text-[10px] text-muted-foreground font-mono">{r.lead.email}</div>
                  </div>
                  <div className="flex flex-col items-end text-[10px]">
                    <span className={
                      r.status === 'SENT'   ? 'rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600' :
                      r.status === 'FAILED' ? 'rounded-full bg-rose-500/10 px-1.5 py-0.5 text-rose-600' :
                      r.status === 'QUEUED' ? 'rounded-full bg-slate-500/10 px-1.5 py-0.5 text-slate-600' :
                      r.status === 'IN_PROGRESS' ? 'rounded-full bg-blue-500/10 px-1.5 py-0.5 text-blue-600' :
                      'rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground'
                    }>
                      {r.status}
                    </span>
                    <span className="mt-0.5 text-muted-foreground">step {r.currentStep + 1}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Sending account picker modal */}
      {showAccountPicker && (
        <SendingAccountPicker
          accounts={sendingAccounts}
          selectedId={campaign.sendingAccount?.id ?? null}
          onSelect={setSendingAccount}
          onClose={() => setShowAccountPicker(false)}
        />
      )}
    </div>
  );
}

function SendingAccountCard({
  account, canEdit, onPickClick,
}: {
  account: Campaign['sendingAccount']; canEdit: boolean; onPickClick: () => void;
}) {
  if (!account) {
    return (
      <div className="card-elevated flex flex-wrap items-center justify-between gap-3 border-2 border-dashed border-amber-500/30 bg-amber-500/5 p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-amber-500/15 text-amber-600">
            <AtSign className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">No sending account picked</div>
            <p className="text-xs text-muted-foreground">Pick which inbox this campaign sends from before launching.</p>
          </div>
        </div>
        <button
          onClick={onPickClick}
          className="inline-flex items-center gap-1.5 rounded-lg bg-grad-brand px-3 py-1.5 text-sm font-semibold text-white shadow-sm"
        >
          <AtSign className="h-3.5 w-3.5" /> Pick sending account
        </button>
      </div>
    );
  }

  const provider = PROVIDER_META[account.provider as keyof typeof PROVIDER_META] ?? PROVIDER_META.SMTP;
  const usagePct = account.dailyLimit > 0 ? Math.min(100, Math.round((account.sentToday / account.dailyLimit) * 100)) : 0;

  return (
    <div className="card-elevated flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 text-primary">
          <AtSign className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{account.name}</span>
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${provider.color}`}>
              {provider.label}
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs font-mono text-muted-foreground">{account.fromEmail}</div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Today's sends</div>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full transition-all ${usagePct >= 90 ? 'bg-rose-500' : usagePct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${usagePct}%` }} />
            </div>
            <span className="text-xs font-semibold tabular-nums">{account.sentToday}/{account.dailyLimit}</span>
          </div>
        </div>
        {canEdit && (
          <button
            onClick={onPickClick}
            className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <Edit3 className="h-3 w-3" /> Change
          </button>
        )}
      </div>
    </div>
  );
}

function SendingAccountPicker({
  accounts, selectedId, onSelect, onClose,
}: {
  accounts: SendingAccount[]; selectedId: string | null;
  onSelect: (id: string | null) => void; onClose: () => void;
}) {
  const active = accounts.filter((a) => a.isActive);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="card-elevated max-h-[85vh] w-full max-w-xl overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h3 className="text-base font-semibold">Pick a sending account</h3>
            <p className="text-xs text-muted-foreground">Choose which connected inbox this campaign sends from.</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent">
            <Trash2 className="h-4 w-4 rotate-45 opacity-0" />
            <span className="text-lg leading-none">×</span>
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-3">
          {active.length === 0 ? (
            <div className="grid place-items-center py-12 text-center">
              <AtSign className="h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-semibold">No sending accounts connected yet</p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Connect your Gmail in one click, or add an SMTP / SendGrid / SES account.
              </p>
              <Link
                href="/settings/sending-accounts"
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-grad-brand px-3 py-1.5 text-sm font-semibold text-white shadow-sm"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Go to Sending Accounts
              </Link>
            </div>
          ) : (
            <ul className="space-y-2">
              {active.map((a) => {
                const provider = PROVIDER_META[a.provider] ?? PROVIDER_META.SMTP;
                const usagePct = a.dailyLimit > 0 ? Math.min(100, Math.round((a.sentToday / a.dailyLimit) * 100)) : 0;
                const isSelected = a.id === selectedId;
                const remaining = a.dailyLimit - a.sentToday;
                return (
                  <li key={a.id}>
                    <button
                      onClick={() => onSelect(a.id)}
                      className={`group flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all hover:bg-accent ${
                        isSelected ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/30' : 'border-border bg-card'
                      }`}
                    >
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary/15 to-primary/5">
                        <AtSign className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-semibold">{a.name}</span>
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${provider.color}`}>
                            {provider.label}
                          </span>
                          {a.imapEnabled && (
                            <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 ring-1 ring-inset ring-emerald-500/30">
                              Replies on
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-xs font-mono text-muted-foreground">{a.fromEmail}</div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="h-1 w-24 overflow-hidden rounded-full bg-muted">
                            <div className={`h-full rounded-full ${usagePct >= 90 ? 'bg-rose-500' : usagePct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${usagePct}%` }} />
                          </div>
                          <span className="text-[10px] tabular-nums text-muted-foreground">
                            {remaining} of {a.dailyLimit} left today
                          </span>
                        </div>
                      </div>
                      {isSelected && <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selectedId && active.length > 0 && (
          <div className="flex items-center justify-between border-t bg-muted/20 px-5 py-3">
            <button
              onClick={() => onSelect(null)}
              className="text-xs font-medium text-muted-foreground hover:text-rose-600"
            >
              Clear selection
            </button>
            <Link
              href="/settings/sending-accounts"
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3" /> Manage accounts
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, icon: Icon, color, tint, sub }: {
  label: string; value: any; icon: any; color: string; tint: string; sub?: string;
}) {
  return (
    <div className="card-elevated relative overflow-hidden p-4">
      <div className={`pointer-events-none absolute -right-8 -top-8 h-20 w-20 rounded-full bg-gradient-to-br ${tint} blur-2xl`} />
      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
          <Icon className={`h-3.5 w-3.5 ${color}`} />
        </div>
        <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}
