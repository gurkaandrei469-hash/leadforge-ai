'use client';
import { useState } from 'react';
import { UserPlus, FileText, Loader2, X, CheckCircle2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useApi, ApiError } from '@/lib/client-api';

interface ManualLeadInput {
  email: string;
  fullName?: string;
  jobTitle?: string;
  companyName?: string;
  companyWebsite?: string;
  linkedinUrl?: string;
  country?: string;
  city?: string;
}

interface AddResult {
  summary: { added: number; updated: number; invalid: number; errors: number };
  addedIds: string[];
}

type Mode = 'single' | 'paste';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parses one line of pasted text into a partial lead.
 * Supports these flexible formats (in priority order):
 *   1. email,name,title,company           (comma-separated)
 *   2. email name company                  (whitespace-separated, 3 tokens)
 *   3. email                               (just an email)
 *   4. Name <email@x.com>                  (RFC 5322 style)
 */
function parseLeadLine(line: string): ManualLeadInput | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Format 4: "Name <email>"
  const rfc = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (rfc) {
    const email = rfc[2]!.trim();
    if (!EMAIL_RE.test(email)) return null;
    return { email, fullName: rfc[1]!.trim().replace(/^["']|["']$/g, '') };
  }

  // Format 1: comma-separated
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',').map((p) => p.trim());
    const email = parts[0];
    if (!email || !EMAIL_RE.test(email)) return null;
    return {
      email,
      fullName: parts[1] || undefined,
      jobTitle: parts[2] || undefined,
      companyName: parts[3] || undefined,
    };
  }

  // Format 3: just an email
  if (EMAIL_RE.test(trimmed)) return { email: trimmed };

  // Format 2: whitespace-separated, first token must be email
  const tokens = trimmed.split(/\s+/);
  if (tokens.length > 1 && EMAIL_RE.test(tokens[0]!)) {
    return {
      email: tokens[0]!,
      fullName: tokens.slice(1).join(' '),
    };
  }

  return null;
}

export function ManualAddLeadModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const api = useApi();
  const [mode, setMode] = useState<Mode>('single');
  const [busy, setBusy] = useState(false);
  const [verify, setVerify] = useState(false);

  // Single-lead form state
  const [form, setForm] = useState<ManualLeadInput>({ email: '' });

  // Bulk paste state
  const [pasteText, setPasteText] = useState('');

  if (!open) return null;

  const parsedFromPaste = pasteText
    .split('\n')
    .map(parseLeadLine)
    .filter((x): x is ManualLeadInput => x !== null);

  const pasteTotalLines = pasteText.split('\n').filter((l) => l.trim()).length;
  const pasteInvalid = pasteTotalLines - parsedFromPaste.length;

  async function submit() {
    let leads: ManualLeadInput[] = [];

    if (mode === 'single') {
      if (!form.email.trim()) return toast.error('Email is required');
      if (!EMAIL_RE.test(form.email.trim())) return toast.error('That email doesn\'t look right');
      leads = [{ ...form, email: form.email.trim() }];
    } else {
      if (parsedFromPaste.length === 0) return toast.error('Paste at least one lead');
      leads = parsedFromPaste;
    }

    setBusy(true);
    try {
      const res = await api.post<AddResult>('/leads/manual', { leads, verify });
      const { added, updated, invalid } = res.summary;

      const bits: string[] = [];
      if (added) bits.push(`${added} added`);
      if (updated) bits.push(`${updated} updated`);
      if (invalid) bits.push(`${invalid} skipped`);

      toast.success(bits.join(' · ') || 'Done');
      onAdded();
      reset();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to add leads');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setForm({ email: '' });
    setPasteText('');
    setVerify(false);
    setMode('single');
  }

  const canSubmit = mode === 'single' ? !!form.email.trim() : parsedFromPaste.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
    >
      <div onClick={(e) => e.stopPropagation()} className="card-elevated w-full max-w-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h3 className="text-base font-semibold">Add leads manually</h3>
            <p className="text-xs text-muted-foreground">
              {mode === 'single'
                ? 'Type one lead at a time, or switch to bulk paste for multiple.'
                : 'Paste a list — one lead per line. We\'ll figure out the format.'}
            </p>
          </div>
          <button onClick={onClose} disabled={busy} className="rounded p-1 text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 border-b bg-muted/20 px-5 py-2">
          <TabBtn active={mode === 'single'} onClick={() => setMode('single')} icon={UserPlus} label="Single lead" />
          <TabBtn active={mode === 'paste'} onClick={() => setMode('paste')} icon={FileText} label="Bulk paste" />
        </div>

        <div className="space-y-4 p-5">
          {mode === 'single' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Email"
                required
                value={form.email}
                onChange={(v) => setForm({ ...form, email: v })}
                placeholder="jane@acme.com"
                full
              />
              <Field
                label="Full name"
                value={form.fullName ?? ''}
                onChange={(v) => setForm({ ...form, fullName: v })}
                placeholder="Jane Doe"
              />
              <Field
                label="Job title"
                value={form.jobTitle ?? ''}
                onChange={(v) => setForm({ ...form, jobTitle: v })}
                placeholder="Head of Marketing"
              />
              <Field
                label="Company"
                value={form.companyName ?? ''}
                onChange={(v) => setForm({ ...form, companyName: v })}
                placeholder="Acme Inc."
              />
              <Field
                label="Website"
                value={form.companyWebsite ?? ''}
                onChange={(v) => setForm({ ...form, companyWebsite: v })}
                placeholder="acme.com"
              />
              <Field
                label="LinkedIn URL"
                value={form.linkedinUrl ?? ''}
                onChange={(v) => setForm({ ...form, linkedinUrl: v })}
                placeholder="linkedin.com/in/janedoe"
                full
              />
              <Field
                label="City"
                value={form.city ?? ''}
                onChange={(v) => setForm({ ...form, city: v })}
                placeholder="San Francisco"
              />
              <Field
                label="Country"
                value={form.country ?? ''}
                onChange={(v) => setForm({ ...form, country: v })}
                placeholder="United States"
              />
            </div>
          ) : (
            <>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={`jane@acme.com, Jane Doe, Head of Marketing, Acme Inc.\njohn@example.com, John Smith\nemail-only@example.com\nSamantha Lee <sam@startup.io>`}
                rows={9}
                className="w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <div className="flex items-center justify-between text-xs">
                <div className="text-muted-foreground">
                  Supports: <span className="font-mono">email</span>,{' '}
                  <span className="font-mono">email, name, title, company</span>, or{' '}
                  <span className="font-mono">Name &lt;email&gt;</span>
                </div>
                {pasteTotalLines > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-600">
                      {parsedFromPaste.length} valid
                    </span>
                    {pasteInvalid > 0 && (
                      <span className="rounded-md bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-600">
                        {pasteInvalid} unparsable
                      </span>
                    )}
                  </div>
                )}
              </div>

              {parsedFromPaste.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Preview ({Math.min(5, parsedFromPaste.length)} of {parsedFromPaste.length})</div>
                  <ul className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto rounded-md border bg-muted/20 p-2 text-[11px]">
                    {parsedFromPaste.slice(0, 5).map((l, i) => (
                      <li key={i} className="font-mono">
                        {l.email}
                        {l.fullName ? ` · ${l.fullName}` : ''}
                        {l.jobTitle ? ` · ${l.jobTitle}` : ''}
                        {l.companyName ? ` · ${l.companyName}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={verify}
              onChange={(e) => setVerify(e.target.checked)}
              className="accent-primary"
            />
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Run email verification on new leads
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t bg-muted/20 px-5 py-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !canSubmit}
            className="inline-flex items-center gap-1.5 rounded-md bg-grad-brand px-4 py-1.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {mode === 'single'
              ? 'Add lead'
              : `Add ${parsedFromPaste.length} lead${parsedFromPaste.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: any;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
        active ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  full,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  full?: boolean;
}) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    </div>
  );
}
