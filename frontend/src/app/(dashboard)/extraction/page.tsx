'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useApi, ApiError } from '@/lib/client-api';

const SOURCES = [
  'WEB_SEARCH', 'DIRECTORY', 'COMPANY_PAGE', 'BLOG', 'FORUM',
  'SOCIAL_LINKEDIN', 'SOCIAL_TWITTER', 'CONTACT_PAGE', 'LISTING', 'CUSTOM_URL_LIST',
] as const;

const FILTER_FIELDS = [
  'niche', 'industry', 'country', 'city', 'language', 'keyword',
  'companySize', 'companyRevenue', 'companyAuthority',
  'jobTitle', 'jobSeniority', 'jobDepartment',
  'technology', 'social_presence', 'has_email', 'has_phone',
  'qualityScore', 'intentScore',
] as const;

const OPERATORS = [
  'eq', 'neq', 'contains', 'starts_with', 'in', 'has_any',
  'gt', 'gte', 'lt', 'lte', 'exists', 'not_exists',
] as const;

interface FilterRow {
  field: string;
  op: string;
  value: string;
}

interface CreatedJob {
  job: { id: string; name: string; status: string };
}

export default function NewExtractionPage() {
  const api = useApi();
  const router = useRouter();
  const [name, setName] = useState('');
  // Default to broad-yield search sources — most users open this page knowing
  // a niche/keyword, not a URL list. CUSTOM_URL_LIST stays toggleable for power users.
  const [selectedSources, setSources] = useState<string[]>(['WEB_SEARCH', 'DIRECTORY', 'BLOG']);
  const [urls, setUrls] = useState('');
  const [filters, setFilters] = useState<FilterRow[]>([]);
  const [target, setTarget] = useState(100);
  const [priority, setPriority] = useState<'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'>('NORMAL');
  const [schedule, setSchedule] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const hasCustomUrls = selectedSources.includes('CUSTOM_URL_LIST');

  const toggleSource = (s: string) => {
    setSources((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  function buildFilter() {
    // Convert filter rows into a Filter tree, encode URLs at top level
    const conds = filters
      .filter((f) => f.value.trim() !== '' || f.op === 'exists' || f.op === 'not_exists')
      .map((f) => {
        let value: any = f.value;
        if (['in', 'has_any', 'has_all'].includes(f.op)) {
          value = f.value.split(',').map((s) => s.trim()).filter(Boolean);
        } else if (['gt', 'gte', 'lt', 'lte', 'qualityScore', 'intentScore'].includes(f.op) || /Score$/.test(f.field)) {
          const n = Number(f.value);
          if (!isNaN(n)) value = n;
        } else if (['has_email', 'has_phone', 'has_contact_page'].includes(f.field)) {
          value = f.value === 'true';
        }
        return { field: f.field, operator: f.op, value };
      });

    const urlList = hasCustomUrls
      ? urls.split('\n').map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u))
      : [];

    return {
      ...(urlList.length ? { __urls__: urlList } : {}),
      AND: conds,
    };
  }

  async function handleSubmit() {
    if (!name.trim()) return toast.error('Name is required');
    if (selectedSources.length === 0) return toast.error('Pick at least one source');
    if (hasCustomUrls && !urls.trim()) return toast.error('Add at least one URL');

    const filter = buildFilter();

    setSubmitting(true);
    try {
      const res = await api.post<CreatedJob>('/jobs', {
        name: name.trim(),
        sources: selectedSources,
        filters: filter,
        targetLeads: target,
        priority,
        ...(schedule.trim() && { schedule: schedule.trim() }),
      });
      toast.success(`Job created (${res.job.id.slice(-6)})`);
      router.push(`/jobs/${res.job.id}`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to create job';
      toast.error(msg);
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-2xl font-bold">New extraction</h1>

      <section className="rounded-lg border bg-card p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="SaaS founders — US, Q2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Sources</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {SOURCES.map((s) => {
              const on = selectedSources.includes(s);
              return (
                <button
                  type="button"
                  key={s}
                  onClick={() => toggleSource(s)}
                  // py-2 (~40px tall with text-sm) clears iOS HIG 44pt minimum touch target.
                  className={`min-h-touch rounded-full border px-3 py-2 text-xs transition-colors active:scale-95 sm:py-1 ${
                    on ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent'
                  }`}
                >
                  {s.replace(/_/g, ' ').toLowerCase()}
                </button>
              );
            })}
          </div>
        </div>

        {hasCustomUrls && (
          <div>
            <label className="block text-sm font-medium">URLs <span className="text-muted-foreground font-normal">— one per line</span></label>
            <textarea
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              rows={6}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
              placeholder={'https://example.com/team\nhttps://example.com/about'}
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium">Schedule <span className="text-muted-foreground font-normal">— optional cron expression for recurring runs</span></label>
          <input
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="0 9 * * 1   (every Monday 9am)"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
          />
          <p className="mt-1 text-xs text-muted-foreground">Leave blank for one-off. Format: minute hour day month weekday.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium">Target leads</label>
            <input
              type="number"
              min={1}
              max={50000}
              value={target}
              onChange={(e) => {
                // Clamp to [1, 50000]; treat blank / NaN as the safe default (100) instead of 0
                // — backend Zod rejects 0 and mobile users often clear and re-type.
                const n = parseInt(e.target.value, 10);
                if (isNaN(n)) setTarget(100);
                else setTarget(Math.max(1, Math.min(50000, n)));
              }}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as any)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option>LOW</option>
              <option>NORMAL</option>
              <option>HIGH</option>
              <option>URGENT</option>
            </select>
          </div>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Filters (AND)</h2>
          <button
            type="button"
            onClick={() => setFilters([...filters, { field: 'keyword', op: 'contains', value: '' }])}
            className="inline-flex items-center gap-1 rounded-md border px-3 py-1 text-sm hover:bg-accent"
          >
            <Plus className="h-4 w-4" /> Add filter
          </button>
        </div>
        {filters.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No filters — every email found will be saved. Add some to narrow results.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {filters.map((f, i) => (
              // Mobile: stack the row into a 2-col grid (field + op) with input + delete below.
              // Desktop (sm+): single horizontal row as before.
              <div
                key={i}
                className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-2 sm:flex sm:items-center sm:bg-transparent sm:p-0"
              >
                <select
                  value={f.field}
                  onChange={(e) => {
                    const n = [...filters];
                    n[i] = { ...n[i]!, field: e.target.value };
                    setFilters(n);
                  }}
                  className="rounded-md border bg-background px-2 py-2 text-sm sm:flex-none sm:py-1"
                >
                  {FILTER_FIELDS.map((x) => <option key={x}>{x}</option>)}
                </select>
                <select
                  value={f.op}
                  onChange={(e) => {
                    const n = [...filters];
                    n[i] = { ...n[i]!, op: e.target.value };
                    setFilters(n);
                  }}
                  className="rounded-md border bg-background px-2 py-2 text-sm sm:flex-none sm:py-1"
                >
                  {OPERATORS.map((x) => <option key={x}>{x}</option>)}
                </select>
                <input
                  value={f.value}
                  onChange={(e) => {
                    const n = [...filters];
                    n[i] = { ...n[i]!, value: e.target.value };
                    setFilters(n);
                  }}
                  className="col-span-2 rounded-md border bg-background px-3 py-2 text-sm sm:col-span-1 sm:flex-1 sm:py-1"
                  placeholder={['in', 'has_any', 'has_all'].includes(f.op) ? 'comma, separated, values' : 'value'}
                />
                <button
                  type="button"
                  onClick={() => setFilters(filters.filter((_, j) => j !== i))}
                  className="col-span-2 inline-flex h-10 items-center justify-center gap-1 rounded-md border text-xs text-muted-foreground hover:bg-accent sm:col-span-1 sm:h-auto sm:w-auto sm:p-1.5"
                  aria-label="Remove filter"
                >
                  <X className="h-4 w-4" />
                  <span className="sm:hidden">Remove filter</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Submit row — mobile gets a sticky full-width bar so the button is always thumb-reachable. */}
      <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur safe-bottom sm:static sm:mx-0 sm:flex sm:justify-end sm:border-t-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
        <button
          type="button"
          disabled={submitting}
          onClick={handleSubmit}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-base font-semibold text-primary-foreground shadow-sm transition-opacity active:scale-[0.98] hover:opacity-90 disabled:opacity-50 sm:w-auto sm:py-2 sm:text-sm"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting ? 'Starting…' : 'Start extraction →'}
        </button>
      </div>
    </div>
  );
}
