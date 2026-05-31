'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Globe, BookOpen, Building2, FileText, MessageSquare, Linkedin,
  Twitter, Users, List, Link2, Loader2, Sparkles, ChevronDown,
  ChevronUp, Plus, X, Zap, Target, Clock, ArrowRight, Check,
  Filter, MapPin, Briefcase, Cpu, TrendingUp, AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useApi, ApiError } from '@/lib/client-api';

// ─── Source definitions ────────────────────────────────────────────────────

const SOURCES = [
  {
    id: 'WEB_SEARCH',
    label: 'Web Search',
    description: 'Google, Bing & DuckDuckGo',
    icon: Globe,
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    popular: true,
  },
  {
    id: 'SOCIAL_LINKEDIN',
    label: 'LinkedIn',
    description: 'Public profiles & company pages',
    icon: Linkedin,
    color: 'text-sky-500',
    bg: 'bg-sky-500/10',
    border: 'border-sky-500/30',
    popular: true,
  },
  {
    id: 'DIRECTORY',
    label: 'Directories',
    description: 'Clutch, G2, Crunchbase & more',
    icon: BookOpen,
    color: 'text-violet-500',
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/30',
    popular: true,
  },
  {
    id: 'COMPANY_PAGE',
    label: 'Company Pages',
    description: 'Team & About pages',
    icon: Building2,
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    popular: false,
  },
  {
    id: 'BLOG',
    label: 'Blogs & Articles',
    description: 'Author pages, bylines',
    icon: FileText,
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    popular: false,
  },
  {
    id: 'FORUM',
    label: 'Forums',
    description: 'Reddit, Hacker News, niche communities',
    icon: MessageSquare,
    color: 'text-pink-500',
    bg: 'bg-pink-500/10',
    border: 'border-pink-500/30',
    popular: false,
  },
  {
    id: 'CONTACT_PAGE',
    label: 'Contact Pages',
    description: 'Direct contact forms & email lists',
    icon: Users,
    color: 'text-teal-500',
    bg: 'bg-teal-500/10',
    border: 'border-teal-500/30',
    popular: false,
  },
  {
    id: 'LISTING',
    label: 'Listings',
    description: 'Product Hunt, AppSumo, directories',
    icon: List,
    color: 'text-orange-500',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/30',
    popular: false,
  },
  {
    id: 'SOCIAL_TWITTER',
    label: 'X / Twitter',
    description: 'Profiles, bios, threads',
    icon: Twitter,
    color: 'text-slate-500',
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/30',
    popular: false,
  },
  {
    id: 'CUSTOM_URL_LIST',
    label: 'Custom URLs',
    description: 'Paste your own URL list',
    icon: Link2,
    color: 'text-indigo-500',
    bg: 'bg-indigo-500/10',
    border: 'border-indigo-500/30',
    popular: false,
  },
] as const;

// ─── Quick audience presets ───────────────────────────────────────────────

const PRESETS = [
  {
    label: 'SaaS Founders',
    icon: '🚀',
    filters: [
      { field: 'jobSeniority', op: 'in', value: 'founder,c-level,ceo' },
      { field: 'industry', op: 'contains', value: 'software' },
    ],
    sources: ['WEB_SEARCH', 'SOCIAL_LINKEDIN', 'DIRECTORY'],
  },
  {
    label: 'Marketing Leaders',
    icon: '📣',
    filters: [
      { field: 'jobDepartment', op: 'eq', value: 'marketing' },
      { field: 'jobSeniority', op: 'in', value: 'vp,director,head' },
    ],
    sources: ['SOCIAL_LINKEDIN', 'COMPANY_PAGE', 'BLOG'],
  },
  {
    label: 'E-commerce Owners',
    icon: '🛒',
    filters: [
      { field: 'industry', op: 'contains', value: 'ecommerce' },
      { field: 'jobSeniority', op: 'in', value: 'founder,owner,ceo' },
    ],
    sources: ['WEB_SEARCH', 'DIRECTORY', 'LISTING'],
  },
  {
    label: 'Tech CTOs / VPs Eng',
    icon: '⚙️',
    filters: [
      { field: 'jobTitle', op: 'contains', value: 'CTO' },
      { field: 'industry', op: 'contains', value: 'technology' },
    ],
    sources: ['SOCIAL_LINKEDIN', 'BLOG', 'FORUM'],
  },
] as const;

// ─── Filter field groups ──────────────────────────────────────────────────

const FILTER_GROUPS = [
  {
    id: 'company',
    label: 'Company',
    icon: Building2,
    color: 'text-violet-500',
    fields: [
      { id: 'industry', label: 'Industry', type: 'text', placeholder: 'e.g. SaaS, fintech' },
      { id: 'companySize', label: 'Company Size', type: 'select', options: ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'] },
      { id: 'technology', label: 'Uses Technology', type: 'text', placeholder: 'e.g. Stripe, Salesforce' },
      { id: 'companyRevenue', label: 'Revenue Range', type: 'text', placeholder: 'e.g. $1M-$10M' },
    ],
  },
  {
    id: 'person',
    label: 'Person',
    icon: Briefcase,
    color: 'text-blue-500',
    fields: [
      { id: 'jobTitle', label: 'Job Title', type: 'text', placeholder: 'e.g. Head of Sales' },
      { id: 'jobSeniority', label: 'Seniority', type: 'select', options: ['c-level', 'vp', 'director', 'manager', 'individual contributor'] },
      { id: 'jobDepartment', label: 'Department', type: 'select', options: ['sales', 'marketing', 'engineering', 'product', 'operations', 'finance', 'hr', 'design'] },
    ],
  },
  {
    id: 'location',
    label: 'Location',
    icon: MapPin,
    color: 'text-emerald-500',
    fields: [
      { id: 'country', label: 'Country', type: 'text', placeholder: 'e.g. United States, Germany' },
      { id: 'city', label: 'City', type: 'text', placeholder: 'e.g. New York, London' },
      { id: 'language', label: 'Language', type: 'text', placeholder: 'e.g. English, Spanish' },
    ],
  },
  {
    id: 'signals',
    label: 'Intent Signals',
    icon: TrendingUp,
    color: 'text-amber-500',
    fields: [
      { id: 'keyword', label: 'Keyword', type: 'text', placeholder: 'e.g. hiring, fundraising' },
      { id: 'niche', label: 'Niche', type: 'text', placeholder: 'e.g. B2B SaaS, AgTech' },
      { id: 'has_email', label: 'Has Email', type: 'boolean' },
      { id: 'social_presence', label: 'Has LinkedIn', type: 'boolean' },
    ],
  },
] as const;

const OPERATORS: Record<string, { label: string; op: string }[]> = {
  text:    [{ label: 'contains', op: 'contains' }, { label: 'is exactly', op: 'eq' }, { label: 'starts with', op: 'starts_with' }, { label: 'is not', op: 'neq' }],
  select:  [{ label: 'is', op: 'eq' }, { label: 'is one of', op: 'in' }, { label: 'is not', op: 'neq' }],
  boolean: [{ label: 'is true', op: 'eq' }, { label: 'is false', op: 'neq' }],
  number:  [{ label: '≥', op: 'gte' }, { label: '≤', op: 'lte' }, { label: '=', op: 'eq' }],
};

interface FilterRow { field: string; op: string; value: string; }
interface CreatedJob { job: { id: string; name: string; status: string }; }

// ─── Main page ─────────────────────────────────────────────────────────────

export default function ExtractionPage() {
  const api = useApi();
  const router = useRouter();

  const [name, setName] = useState('');
  const [selectedSources, setSources] = useState<string[]>(['WEB_SEARCH', 'SOCIAL_LINKEDIN', 'DIRECTORY']);
  const [filters, setFilters] = useState<FilterRow[]>([]);
  const [urls, setUrls] = useState('');
  const [target, setTarget] = useState(100);
  const [priority, setPriority] = useState<'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'>('NORMAL');
  const [schedule, setSchedule] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showAllSources, setShowAllSources] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['company', 'person']));
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const hasCustomUrls = selectedSources.includes('CUSTOM_URL_LIST');
  const popularSources = SOURCES.filter((s) => s.popular);
  const extraSources = SOURCES.filter((s) => !s.popular);
  const visibleSources = showAllSources ? SOURCES : [...popularSources, ...extraSources.filter(s => selectedSources.includes(s.id))];

  function toggleSource(id: string) {
    setSources((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  function applyPreset(preset: typeof PRESETS[number]) {
    setActivePreset(preset.label);
    setFilters(preset.filters.map(f => ({ ...f })));
    setSources([...preset.sources]);
    if (!name) setName(preset.label + ' — ' + new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));
  }

  function toggleGroup(id: string) {
    setOpenGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function addFilter(field: string, type: string) {
    const defaultOp = type === 'boolean' ? 'eq' : 'contains';
    const defaultVal = type === 'boolean' ? 'true' : '';
    setFilters(prev => [...prev, { field, op: defaultOp, value: defaultVal }]);
    const group = FILTER_GROUPS.find(g => g.fields.some(f => f.id === field));
    if (group) setOpenGroups(prev => new Set([...prev, group.id]));
  }

  function removeFilter(i: number) {
    setFilters(prev => prev.filter((_, j) => j !== i));
  }

  function updateFilter(i: number, patch: Partial<FilterRow>) {
    setFilters(prev => prev.map((f, j) => j === i ? { ...f, ...patch } : f));
  }

  function buildFilter() {
    const conds = filters
      .filter(f => f.value.trim() !== '' || f.op === 'exists' || f.op === 'not_exists')
      .map(f => {
        let value: any = f.value;
        if (['in', 'has_any'].includes(f.op)) value = f.value.split(',').map(s => s.trim()).filter(Boolean);
        else if (['has_email', 'has_phone', 'social_presence'].includes(f.field)) value = f.value === 'true';
        else if (['qualityScore', 'intentScore'].includes(f.field)) { const n = Number(f.value); if (!isNaN(n)) value = n; }
        return { field: f.field, operator: f.op, value };
      });
    const urlList = hasCustomUrls ? urls.split('\n').map(u => u.trim()).filter(u => /^https?:\/\//.test(u)) : [];
    return { ...(urlList.length ? { __urls__: urlList } : {}), AND: conds };
  }

  async function handleSubmit() {
    if (!name.trim()) { toast.error('Give your extraction a name'); return; }
    if (selectedSources.length === 0) { toast.error('Select at least one source'); return; }
    if (hasCustomUrls && !urls.trim()) { toast.error('Add at least one URL'); return; }
    setSubmitting(true);
    try {
      const res = await api.post<CreatedJob>('/jobs', {
        name: name.trim(),
        sources: selectedSources,
        filters: buildFilter(),
        targetLeads: target,
        priority,
        ...(schedule.trim() && { schedule: schedule.trim() }),
      });
      toast.success('Extraction started');
      router.push(`/jobs/${res.job.id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to start extraction');
      setSubmitting(false);
    }
  }

  const activeFilterCount = filters.length;
  const estimatedReach = Math.min(target, Math.round(target * (1 + selectedSources.length * 0.3) * (1 - activeFilterCount * 0.08)));

  return (
    <div className="min-h-screen pb-32 lg:pb-0">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span>New extraction</span>
        </div>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Name this extraction…"
          className="w-full bg-transparent text-3xl font-bold tracking-tight placeholder:text-muted-foreground/30 focus:outline-none border-none resize-none"
          maxLength={80}
        />
        <div className="mt-2 h-0.5 w-16 bg-grad-brand rounded-full" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px] lg:items-start">

        {/* ── Left column ───────────────────────────────────────────────── */}
        <div className="space-y-6 min-w-0">

          {/* Step 1 — Audience presets */}
          <section>
            <SectionHeader step={1} title="Who are you targeting?" subtitle="Pick a preset to prefill common filters, or build manually below." />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p)}
                  className={`group relative flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all hover:shadow-md active:scale-[0.98] ${
                    activePreset === p.label
                      ? 'border-primary bg-primary/5 shadow-sm shadow-primary/20'
                      : 'border-border bg-card hover:border-primary/40'
                  }`}
                >
                  {activePreset === p.label && (
                    <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                      <Check className="h-3 w-3 text-white" />
                    </div>
                  )}
                  <span className="text-2xl leading-none">{p.icon}</span>
                  <span className="text-sm font-semibold leading-tight">{p.label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Step 2 — Sources */}
          <section>
            <SectionHeader step={2} title="Where should we look?" subtitle="Select all sources you want crawled. More sources = broader reach." />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {visibleSources.map(s => {
                const Icon = s.icon;
                const on = selectedSources.includes(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleSource(s.id)}
                    className={`group relative flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all hover:shadow-sm active:scale-[0.98] ${
                      on
                        ? `${s.border} ${s.bg} shadow-sm`
                        : 'border-border bg-card hover:border-border/80'
                    }`}
                  >
                    <div className={`mt-0.5 shrink-0 rounded-lg p-2 ${on ? s.bg : 'bg-muted'}`}>
                      <Icon className={`h-4 w-4 ${on ? s.color : 'text-muted-foreground'}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-semibold ${on ? '' : 'text-muted-foreground'}`}>{s.label}</div>
                      <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{s.description}</div>
                    </div>
                    {on && (
                      <div className={`absolute top-2 right-2 h-2 w-2 rounded-full ${s.color.replace('text-', 'bg-')}`} />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Show more toggle */}
            <button
              onClick={() => setShowAllSources(!showAllSources)}
              className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showAllSources ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {showAllSources ? 'Show fewer sources' : `Show ${extraSources.filter(s => !selectedSources.includes(s.id)).length} more sources`}
            </button>

            {hasCustomUrls && (
              <div className="mt-4 rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4">
                <label className="block text-sm font-medium mb-2 text-indigo-600 dark:text-indigo-400">Custom URLs — one per line</label>
                <textarea
                  value={urls}
                  onChange={e => setUrls(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder={'https://example.com/team\nhttps://example.com/about'}
                />
              </div>
            )}
          </section>

          {/* Step 3 — Filters */}
          <section>
            <div className="flex items-center justify-between">
              <SectionHeader
                step={3}
                title="Refine your audience"
                subtitle="Add filters to narrow down the results."
              />
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  {activeFilterCount} active
                </span>
              )}
            </div>

            <div className="mt-4 space-y-2">
              {FILTER_GROUPS.map(group => {
                const Icon = group.icon;
                const isOpen = openGroups.has(group.id);
                const groupFilters = filters.filter(f => group.fields.some(gf => gf.id === f.field));

                return (
                  <div key={group.id} className="rounded-xl border bg-card overflow-hidden">
                    <button
                      onClick={() => toggleGroup(group.id)}
                      className="flex w-full items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon className={`h-4 w-4 ${group.color}`} />
                        <span className="text-sm font-semibold">{group.label}</span>
                        {groupFilters.length > 0 && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                            {groupFilters.length}
                          </span>
                        )}
                      </div>
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isOpen && (
                      <div className="border-t px-4 pb-4 pt-3">
                        {/* Existing filter rows for this group */}
                        {groupFilters.map((f) => {
                          const idx = filters.indexOf(f);
                          const fieldDef = group.fields.find(gf => gf.id === f.field);
                          const ops = OPERATORS[fieldDef?.type ?? 'text'] ?? OPERATORS.text;
                          return (
                            <div key={idx} className="flex items-center gap-2 mb-2">
                              <div className="flex-1 flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                                <span className="text-xs font-medium text-muted-foreground min-w-[90px]">{fieldDef?.label ?? f.field}</span>
                                <select
                                  value={f.op}
                                  onChange={e => updateFilter(idx, { op: e.target.value })}
                                  className="bg-transparent text-xs text-muted-foreground focus:outline-none border-none"
                                >
                                  {ops.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
                                </select>
                                {fieldDef?.type === 'boolean' ? (
                                  <select
                                    value={f.value}
                                    onChange={e => updateFilter(idx, { value: e.target.value })}
                                    className="ml-auto bg-transparent text-xs focus:outline-none"
                                  >
                                    <option value="true">Yes</option>
                                    <option value="false">No</option>
                                  </select>
                                ) : fieldDef?.type === 'select' ? (
                                  <select
                                    value={f.value}
                                    onChange={e => updateFilter(idx, { value: e.target.value })}
                                    className="ml-auto bg-transparent text-xs focus:outline-none flex-1"
                                  >
                                    <option value="">Any</option>
                                    {(fieldDef as any).options?.map((o: string) => <option key={o} value={o}>{o}</option>)}
                                  </select>
                                ) : (
                                  <input
                                    value={f.value}
                                    onChange={e => updateFilter(idx, { value: e.target.value })}
                                    placeholder={fieldDef?.placeholder ?? 'value'}
                                    className="ml-auto bg-transparent text-xs focus:outline-none flex-1 min-w-0"
                                  />
                                )}
                              </div>
                              <button
                                onClick={() => removeFilter(idx)}
                                className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          );
                        })}

                        {/* Quick-add buttons */}
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {group.fields
                            .filter(gf => !filters.some(f => f.field === gf.id))
                            .map(gf => (
                              <button
                                key={gf.id}
                                onClick={() => addFilter(gf.id, gf.type)}
                                className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-[11px] text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                              >
                                <Plus className="h-3 w-3" />
                                {gf.label}
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* ── Right panel — run config ───────────────────────────────────── */}
        <div className="lg:sticky lg:top-6 space-y-4">

          {/* Reach estimate */}
          <div className="rounded-xl border bg-card p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Estimated Reach</div>
            <div className="flex items-end gap-2 mb-1">
              <span className="text-4xl font-bold tabular-nums text-grad-brand bg-clip-text">
                {estimatedReach.toLocaleString()}
              </span>
              <span className="text-sm text-muted-foreground mb-1">leads</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {selectedSources.length} source{selectedSources.length !== 1 ? 's' : ''} · {activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''}
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-grad-brand transition-all duration-500"
                style={{ width: `${Math.min(100, (estimatedReach / Math.max(target, 1)) * 100)}%` }}
              />
            </div>
          </div>

          {/* Target leads */}
          <div className="rounded-xl border bg-card p-4 space-y-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Run Settings</div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2">Target leads</label>
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  {[50, 100, 500, 1000].map(n => (
                    <button
                      key={n}
                      onClick={() => setTarget(n)}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                        target === n ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      {n >= 1000 ? `${n / 1000}k` : n}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min={1}
                  max={50000}
                  value={target}
                  onChange={e => { const n = parseInt(e.target.value, 10); if (!isNaN(n)) setTarget(Math.max(1, Math.min(50000, n))); }}
                  className="w-20 rounded-lg border bg-background px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2">Priority</label>
              <div className="grid grid-cols-2 gap-1.5">
                {(['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const).map(p => {
                  const colors: Record<string, string> = {
                    LOW: 'text-slate-500 border-slate-500/30 bg-slate-500/5',
                    NORMAL: 'text-blue-500 border-blue-500/30 bg-blue-500/5',
                    HIGH: 'text-amber-500 border-amber-500/30 bg-amber-500/5',
                    URGENT: 'text-red-500 border-red-500/30 bg-red-500/5',
                  };
                  return (
                    <button
                      key={p}
                      onClick={() => setPriority(p)}
                      className={`rounded-lg border px-2 py-1.5 text-xs font-semibold capitalize transition-all ${
                        priority === p ? colors[p] : 'border-border text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {p.toLowerCase()}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                <Clock className="h-3 w-3 inline mr-1" />
                Schedule <span className="font-normal opacity-60">(optional)</span>
              </label>
              <div className="flex gap-1.5 flex-wrap mb-2">
                {[
                  { label: 'Daily', cron: '0 9 * * *' },
                  { label: 'Weekly', cron: '0 9 * * 1' },
                  { label: 'Monthly', cron: '0 9 1 * *' },
                ].map(s => (
                  <button
                    key={s.label}
                    onClick={() => setSchedule(schedule === s.cron ? '' : s.cron)}
                    className={`rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
                      schedule === s.cron ? 'bg-primary/10 text-primary border border-primary/30' : 'bg-muted text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <input
                value={schedule}
                onChange={e => setSchedule(e.target.value)}
                placeholder="cron expression, e.g. 0 9 * * 1"
                className="w-full rounded-lg border bg-background px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          {/* Validation hints */}
          {(!name.trim() || selectedSources.length === 0) && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
              <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div className="space-y-0.5">
                  {!name.trim() && <div>Add a name for this extraction</div>}
                  {selectedSources.length === 0 && <div>Select at least one source</div>}
                </div>
              </div>
            </div>
          )}

          {/* Launch CTA */}
          <button
            disabled={submitting || !name.trim() || selectedSources.length === 0}
            onClick={handleSubmit}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-grad-brand px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-primary/25 transition-all hover:opacity-90 hover:shadow-primary/40 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {submitting
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Starting extraction…</>
              : <><Zap className="h-4 w-4" /> Launch Extraction <ArrowRight className="h-4 w-4" /></>
            }
          </button>
        </div>
      </div>

      {/* Mobile sticky launch bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur px-4 py-3 safe-bottom lg:hidden z-10">
        <div className="flex items-center gap-3 max-w-xl mx-auto">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground">
              {estimatedReach.toLocaleString()} est. leads · {selectedSources.length} sources
            </div>
          </div>
          <button
            disabled={submitting || !name.trim() || selectedSources.length === 0}
            onClick={handleSubmit}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-grad-brand px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            Launch
          </button>
        </div>
      </div>

    </div>
  );
}

// ─── Helper components ─────────────────────────────────────────────────────

function SectionHeader({ step, title, subtitle }: { step: number; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
        {step}
      </div>
      <div>
        <h2 className="text-base font-bold">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}
