'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2, Loader2, Mail, Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useApi, ApiError } from '@/lib/client-api';

interface SendingAccount {
  id: string;
  name: string;
  fromEmail: string;
  provider: string;
  isActive: boolean;
}

interface Step {
  subject: string;
  body: string;
  delayDays: number;
}

const DEFAULT_BODY = `Hi {{first_name}},

I noticed your work as {{job_title}} at {{company}} — looking impressive.

[your pitch here]

Worth a brief chat next week?

Best`;

export default function NewCampaignPage() {
  const api = useApi();
  const router = useRouter();
  const searchParams = useSearchParams();
  const listId = searchParams.get('listId');

  const [accounts, setAccounts] = useState<SendingAccount[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sendingAccountId, setSendingAccountId] = useState<string>('');
  const [dailyLimit, setDailyLimit] = useState(50);
  const [steps, setSteps] = useState<Step[]>([
    { subject: 'Quick question about {{company}}', body: DEFAULT_BODY, delayDays: 0 },
  ]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.get<{ accounts: SendingAccount[] }>('/sending-accounts').then((r) => {
      setAccounts(r.accounts.filter((a) => a.isActive));
      if (r.accounts[0]) setSendingAccountId(r.accounts[0].id);
    });
  }, []);

  function updateStep(idx: number, patch: Partial<Step>) {
    setSteps((s) => s.map((step, i) => (i === idx ? { ...step, ...patch } : step)));
  }
  function addStep() {
    setSteps((s) => [...s, { subject: `Follow-up #${s.length}`, body: 'Hi {{first_name}},\n\nFollowing up on my last note — any thoughts?\n\nBest', delayDays: 3 }]);
  }
  function removeStep(idx: number) {
    setSteps((s) => s.filter((_, i) => i !== idx));
  }

  async function create() {
    if (!name.trim()) return toast.error('Name is required');
    if (!sendingAccountId) return toast.error('Pick a sending account');
    if (steps.some((s) => !s.subject.trim() || !s.body.trim())) return toast.error('Each step needs subject + body');

    setCreating(true);
    try {
      const res = await api.post<{ campaign: { id: string } }>('/campaigns', {
        name: name.trim(),
        description: description.trim() || undefined,
        sendingAccountId,
        dailyLimit,
        steps: steps.map((s, i) => ({ order: i, delayDays: s.delayDays, subject: s.subject, body: s.body })),
      });
      toast.success('Campaign created');

      // If we came from a list, auto-add recipients
      if (listId) {
        try {
          await api.post(`/campaigns/${res.campaign.id}/recipients`, { listId });
          toast.success('Recipients added from list');
        } catch { /* ignore — user can add manually */ }
      }

      router.push(`/campaigns/${res.campaign.id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create');
    } finally { setCreating(false); }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/campaigns" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Campaigns
      </Link>

      <div>
        <h1 className="text-3xl font-bold tracking-tight">New campaign</h1>
        <p className="mt-1 text-sm text-muted-foreground">Compose a multi-step sequence with merge tags.</p>
      </div>

      {accounts.length === 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <strong className="text-amber-700 dark:text-amber-400">No active sending account.</strong>{' '}
          <Link href="/settings/sending-accounts" className="text-primary underline">Connect one</Link> before launching.
        </div>
      )}

      {/* Basics */}
      <section className="card-elevated p-6">
        <h3 className="text-sm font-semibold">Basics</h3>
        <div className="mt-4 space-y-3">
          <Field label="Campaign name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Q1 SaaS founders" className={inputCls} />
          </Field>
          <Field label="Description (optional)">
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Cold outreach to US SaaS founders" className={inputCls} />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Sending account">
              <select
                value={sendingAccountId}
                onChange={(e) => setSendingAccountId(e.target.value)}
                className={inputCls}
              >
                <option value="">— pick one —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} · {a.fromEmail}</option>
                ))}
              </select>
            </Field>
            <Field label="Daily send limit">
              <input
                type="number"
                min={1}
                max={2000}
                value={dailyLimit}
                onChange={(e) => setDailyLimit(parseInt(e.target.value || '50'))}
                className={inputCls + ' tabular-nums'}
              />
            </Field>
          </div>
        </div>
      </section>

      {/* Steps */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            Sequence steps{' '}
            <span className="text-muted-foreground">({steps.length})</span>
          </h3>
          <button
            onClick={addStep}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent"
          >
            <Plus className="h-3 w-3" /> Add step
          </button>
        </div>

        {steps.map((step, i) => (
          <div key={i} className="card-elevated p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 text-sm font-bold text-primary">
                  {i + 1}
                </div>
                <h4 className="text-sm font-semibold">
                  {i === 0 ? 'First touch' : `Follow-up #${i}`}
                </h4>
              </div>
              {steps.length > 1 && (
                <button
                  onClick={() => removeStep(i)}
                  className="rounded-md border border-destructive/40 p-1.5 text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="mt-4 space-y-3">
              {i > 0 && (
                <Field label="Days after previous step">
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={step.delayDays}
                    onChange={(e) => updateStep(i, { delayDays: parseInt(e.target.value || '0') })}
                    className={inputCls + ' tabular-nums w-24'}
                  />
                </Field>
              )}
              <Field label="Subject">
                <input
                  value={step.subject}
                  onChange={(e) => updateStep(i, { subject: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Body — use {{first_name}}, {{company}}, {{job_title}}, {{full_name}}, {{email}}">
                <textarea
                  value={step.body}
                  onChange={(e) => updateStep(i, { body: e.target.value })}
                  rows={8}
                  className={inputCls + ' font-mono leading-relaxed'}
                />
              </Field>
              <div className="text-[10px] text-muted-foreground">
                Footer with unsubscribe link is added automatically. URLs become click-tracked. A tracking pixel is appended.
              </div>
            </div>
          </div>
        ))}
      </section>

      <div className="flex justify-end gap-2">
        <Link href="/campaigns" className="rounded-md border px-4 py-2 text-sm hover:bg-accent">
          Cancel
        </Link>
        <button
          onClick={create}
          disabled={creating || accounts.length === 0}
          className="inline-flex items-center gap-2 rounded-md bg-grad-brand px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
        >
          {creating && <Loader2 className="h-4 w-4 animate-spin" />}
          <Sparkles className="h-4 w-4" /> Save as draft
        </button>
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}
