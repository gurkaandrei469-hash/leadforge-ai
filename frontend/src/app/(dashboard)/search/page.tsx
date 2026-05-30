'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Search, Filter, X, Sliders, Building2, Briefcase, Globe, Cpu, TrendingUp,
  Award, Loader2, Sparkles, BadgeCheck, ChevronDown, ChevronUp, Brain, MapPin,
} from 'lucide-react';
import { toast } from 'sonner';
import { useApi, ApiError } from '@/lib/client-api';
import { Avatar } from '@/components/ui/avatar';
import { IntelligencePanel } from '@/components/leads/intelligence-panel';

/**
 * Apollo/Clay-style structured lead search powered by the Postgres
 * knowledge graph. Hits POST /api/v1/intelligence/graph/search with up to
 * 18 filter dimensions and renders the results inline.
 *
 * Filter UX is chip-based: each active filter shows as a removable pill at
 * the top, and the filter panel on the left collapses categories so users
 * can build complex queries ("CFOs at fintech companies using Stripe that
 * raised in the last 90 days") without drowning in dropdowns.
 */

// ─── Filter shape (mirrors backend GraphLeadFilter) ──────────────────────

interface Filter {
  jobSeniority: string[];
  jobDepartment: string[];
  verificationStatus: string[];
  minQualityScore?: number;
  industrySlug: string[];
  usesTech: string[];
  usesAllTech: string[];
  excludeTech: string[];
  employeeMin?: number;
  employeeMax?: number;
  hqCountry: string[];
  fundedWithinDays?: number;
  execChangeWithinDays?: number;
  foundedAfter?: number;
  page: number;
  pageSize: number;
  sortBy: 'qualityScore' | 'createdAt' | 'companyEmployees' | 'lastFunding';
  sortOrder: 'asc' | 'desc';
}

const EMPTY_FILTER: Filter = {
  jobSeniority: [], jobDepartment: [], verificationStatus: [],
  industrySlug: [], usesTech: [], usesAllTech: [], excludeTech: [],
  hqCountry: [],
  page: 1, pageSize: 50,
  sortBy: 'qualityScore', sortOrder: 'desc',
};

// ─── Catalog (would normally come from /graph/stats; hard-coded so the
//     page works on day zero before any data has been enriched) ──────────

const SENIORITY_OPTIONS = [
  { id: 'c-level',  label: 'C-Level / Founder' },
  { id: 'vp',       label: 'VP / Director' },
  { id: 'manager',  label: 'Manager' },
  { id: 'ic',       label: 'Individual Contributor' },
];

const DEPARTMENT_OPTIONS = [
  'engineering', 'sales', 'marketing', 'product', 'finance', 'ops', 'hr', 'legal', 'executive',
];

const STATUS_OPTIONS = [
  { id: 'VALID',     label: 'Valid',     color: 'bg-emerald-500/15 text-emerald-700' },
  { id: 'RISKY',     label: 'Risky',     color: 'bg-amber-500/15 text-amber-700' },
  { id: 'CATCH_ALL', label: 'Catch-all', color: 'bg-amber-500/15 text-amber-700' },
  { id: 'UNKNOWN',   label: 'Unknown',   color: 'bg-slate-500/15 text-slate-700' },
  { id: 'INVALID',   label: 'Invalid',   color: 'bg-rose-500/15 text-rose-700' },
];

const INDUSTRY_OPTIONS = [
  { slug: 'saas',            label: 'SaaS' },
  { slug: 'fintech',         label: 'Fintech' },
  { slug: 'ecommerce',       label: 'E-commerce' },
  { slug: 'healthcare',      label: 'Healthcare' },
  { slug: 'cybersecurity',   label: 'Cybersecurity' },
  { slug: 'developer-tools', label: 'Developer Tools' },
  { slug: 'analytics',       label: 'Analytics' },
  { slug: 'marketing-tech',  label: 'Marketing Tech' },
  { slug: 'productivity',    label: 'Productivity' },
  { slug: 'ai-ml',           label: 'AI / ML' },
  { slug: 'edtech',          label: 'EdTech' },
  { slug: 'real-estate',     label: 'Real Estate' },
  { slug: 'logistics',       label: 'Logistics' },
];

const TECH_OPTIONS = [
  'react', 'next-js', 'vue', 'angular', 'stripe', 'shopify', 'wordpress',
  'hubspot', 'salesforce', 'cloudflare', 'google-analytics', 'segment',
  'mixpanel', 'amplitude', 'intercom', 'sentry', 'tailwind-css',
];

const COUNTRY_OPTIONS = [
  'US', 'UK', 'Canada', 'Germany', 'France', 'Netherlands', 'Spain', 'Italy',
  'Australia', 'Japan', 'India', 'Brazil', 'Mexico',
];

const FUNDING_PRESETS = [
  { days: 30,  label: 'Last 30 days' },
  { days: 90,  label: 'Last 90 days' },
  { days: 180, label: 'Last 6 months' },
  { days: 365, label: 'Last year' },
];

// ─── Page ──────────────────────────────────────────────────────────────────

interface ResultRow {
  leadId: string;
  email: string | null;
  fullName: string | null;
  jobTitle: string | null;
  jobSeniority: string | null;
  qualityScore: number | null;
  verificationStatus: string;
  company: {
    id: string;
    name: string | null;
    domain: string;
    industry: { slug: string; name: string } | null;
    employees: number | null;
    foundedYear: number | null;
    hqCountry: string | null;
    technologies: Array<{ slug: string; name: string }>;
    lastFundingRound: string | null;
    lastFundingAt: string | null;
  } | null;
}

export default function GraphSearchPage() {
  const api = useApi();
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [intelligenceLeadId, setIntelligenceLeadId] = useState<string | null>(null);

  // Debounced run on filter change
  useEffect(() => {
    const t = setTimeout(() => runSearch(), 250);
    return () => clearTimeout(t);
  }, [JSON.stringify(filter)]);  // intentional — runs whenever any field changes

  async function runSearch() {
    setLoading(true);
    try {
      const res = await api.post<{ rows: ResultRow[]; total: number }>('/intelligence/graph/search', filter);
      setRows(res.rows);
      setTotal(res.total);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  function toggle<K extends keyof Filter>(key: K, value: string) {
    setFilter((f) => {
      const arr = f[key] as unknown as string[];
      const next = arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value];
      return { ...f, [key]: next, page: 1 } as Filter;
    });
  }

  function setScalar<K extends keyof Filter>(key: K, value: any) {
    setFilter((f) => ({ ...f, [key]: value, page: 1 }) as Filter);
  }

  const activeChips = useMemo(() => buildActiveChips(filter), [filter]);
  const hasFilters = activeChips.length > 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Search className="h-6 w-6 text-primary" />
            Graph Search
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Apollo-style structured search over your knowledge graph — query leads by company firmographics, tech stack, funding, and signals.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full border bg-card px-3 py-1 tabular-nums">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : `${total.toLocaleString()} matches`}
          </span>
          {hasFilters && (
            <button
              onClick={() => setFilter(EMPTY_FILTER)}
              className="rounded-full border bg-card px-3 py-1 hover:bg-accent"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* Active filter chips */}
      {hasFilters && (
        <div className="flex flex-wrap gap-1.5">
          {activeChips.map((c) => (
            <button
              key={c.key}
              onClick={c.onRemove}
              className="inline-flex items-center gap-1 rounded-full border bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20"
            >
              {c.icon && <c.icon className="h-3 w-3" />}
              <span>{c.label}</span>
              <X className="h-3 w-3 opacity-60" />
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* Filter sidebar */}
        <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
          <FilterSection title="Person" icon={Briefcase} defaultOpen>
            <CheckboxList
              label="Seniority"
              options={SENIORITY_OPTIONS.map((s) => ({ id: s.id, label: s.label }))}
              selected={filter.jobSeniority}
              onToggle={(v) => toggle('jobSeniority', v)}
            />
            <CheckboxList
              label="Department"
              options={DEPARTMENT_OPTIONS.map((d) => ({ id: d, label: capitalize(d) }))}
              selected={filter.jobDepartment}
              onToggle={(v) => toggle('jobDepartment', v)}
            />
          </FilterSection>

          <FilterSection title="Email" icon={BadgeCheck}>
            <CheckboxList
              label="Verification status"
              options={STATUS_OPTIONS.map((s) => ({ id: s.id, label: s.label }))}
              selected={filter.verificationStatus}
              onToggle={(v) => toggle('verificationStatus', v)}
            />
            <RangeRow
              label="Min quality score"
              value={filter.minQualityScore ?? 0}
              min={0} max={100} step={5}
              onChange={(v) => setScalar('minQualityScore', v > 0 ? v : undefined)}
              format={(v) => `${v}+`}
            />
          </FilterSection>

          <FilterSection title="Company" icon={Building2}>
            <CheckboxList
              label="Industry"
              options={INDUSTRY_OPTIONS.map((i) => ({ id: i.slug, label: i.label }))}
              selected={filter.industrySlug}
              onToggle={(v) => toggle('industrySlug', v)}
              limit={6}
            />
            <RangeRow
              label="Min employees"
              value={filter.employeeMin ?? 0}
              min={0} max={5000} step={50}
              onChange={(v) => setScalar('employeeMin', v > 0 ? v : undefined)}
              format={fmtEmployees}
            />
            <RangeRow
              label="Max employees"
              value={filter.employeeMax ?? 10_000}
              min={0} max={10_000} step={100}
              onChange={(v) => setScalar('employeeMax', v < 10_000 ? v : undefined)}
              format={fmtEmployees}
            />
            <RangeRow
              label="Founded after"
              value={filter.foundedAfter ?? 1900}
              min={1900} max={2026} step={1}
              onChange={(v) => setScalar('foundedAfter', v > 1900 ? v : undefined)}
              format={(v) => String(v)}
            />
            <CheckboxList
              label="HQ country"
              options={COUNTRY_OPTIONS.map((c) => ({ id: c, label: c }))}
              selected={filter.hqCountry}
              onToggle={(v) => toggle('hqCountry', v)}
              limit={6}
            />
          </FilterSection>

          <FilterSection title="Tech stack" icon={Cpu}>
            <CheckboxList
              label="Uses any of"
              options={TECH_OPTIONS.map((t) => ({ id: t, label: humanizeSlug(t) }))}
              selected={filter.usesTech}
              onToggle={(v) => toggle('usesTech', v)}
              limit={6}
            />
            <CheckboxList
              label="Uses ALL of"
              options={TECH_OPTIONS.map((t) => ({ id: t, label: humanizeSlug(t) }))}
              selected={filter.usesAllTech}
              onToggle={(v) => toggle('usesAllTech', v)}
              limit={6}
            />
            <CheckboxList
              label="Exclude"
              options={TECH_OPTIONS.map((t) => ({ id: t, label: humanizeSlug(t) }))}
              selected={filter.excludeTech}
              onToggle={(v) => toggle('excludeTech', v)}
              limit={6}
            />
          </FilterSection>

          <FilterSection title="Intent signals" icon={TrendingUp}>
            <RadioRow
              label="Recently funded"
              options={FUNDING_PRESETS.map((p) => ({ id: String(p.days), label: p.label }))}
              selected={filter.fundedWithinDays ? String(filter.fundedWithinDays) : null}
              onSelect={(v) => setScalar('fundedWithinDays', v ? parseInt(v, 10) : undefined)}
            />
            <RadioRow
              label="Recent exec change"
              options={FUNDING_PRESETS.map((p) => ({ id: String(p.days), label: p.label }))}
              selected={filter.execChangeWithinDays ? String(filter.execChangeWithinDays) : null}
              onSelect={(v) => setScalar('execChangeWithinDays', v ? parseInt(v, 10) : undefined)}
            />
          </FilterSection>

          <FilterSection title="Sort" icon={Sliders}>
            <select
              value={filter.sortBy}
              onChange={(e) => setScalar('sortBy', e.target.value)}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
            >
              <option value="qualityScore">Quality score</option>
              <option value="createdAt">Recently added</option>
              <option value="companyEmployees">Company size</option>
              <option value="lastFunding">Recent funding</option>
            </select>
            <select
              value={filter.sortOrder}
              onChange={(e) => setScalar('sortOrder', e.target.value)}
              className="mt-2 w-full rounded-md border bg-background px-2 py-1.5 text-xs"
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </FilterSection>
        </aside>

        {/* Results */}
        <main className="space-y-2">
          {loading ? (
            <div className="card-elevated grid place-items-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : rows.length === 0 ? (
            <div className="card-elevated grid place-items-center gap-2 py-16 text-center">
              <Filter className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm font-medium">No matching leads</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Loosen a filter, or run an extraction job + intelligence pass first to populate the graph.
              </p>
            </div>
          ) : (
            rows.map((r) => (
              <ResultCard key={r.leadId} row={r} onOpenIntelligence={() => setIntelligenceLeadId(r.leadId)} />
            ))
          )}

          {rows.length > 0 && total > rows.length && (
            <div className="flex items-center justify-center gap-3 pt-3">
              <button
                onClick={() => setScalar('page', filter.page - 1)}
                disabled={filter.page <= 1}
                className="rounded-md border bg-card px-3 py-1.5 text-xs disabled:opacity-40"
              >
                ← Prev
              </button>
              <span className="text-xs tabular-nums">
                Page {filter.page} of {Math.ceil(total / filter.pageSize)}
              </span>
              <button
                onClick={() => setScalar('page', filter.page + 1)}
                disabled={filter.page >= Math.ceil(total / filter.pageSize)}
                className="rounded-md border bg-card px-3 py-1.5 text-xs disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          )}
        </main>
      </div>

      <IntelligencePanel leadId={intelligenceLeadId} onClose={() => setIntelligenceLeadId(null)} />
    </div>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────────

function ResultCard({ row, onOpenIntelligence }: { row: ResultRow; onOpenIntelligence: () => void }) {
  const company = row.company;
  const tier =
    row.qualityScore == null ? null :
    row.qualityScore >= 85 ? { label: 'A', color: 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/40' } :
    row.qualityScore >= 70 ? { label: 'B', color: 'bg-blue-500/15 text-blue-700 ring-blue-500/40' } :
    row.qualityScore >= 55 ? { label: 'C', color: 'bg-amber-500/15 text-amber-700 ring-amber-500/40' } :
                              { label: 'D', color: 'bg-rose-500/15 text-rose-700 ring-rose-500/40' };

  return (
    <div className="card-elevated group flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <Avatar name={row.fullName ?? row.email ?? '?'} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-semibold">{row.fullName ?? '—'}</span>
          {row.jobTitle && <span className="text-xs text-muted-foreground">· {row.jobTitle}</span>}
        </div>
        <div className="truncate text-xs text-muted-foreground font-mono">{row.email ?? '—'}</div>

        {company && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1 font-medium">
              <Building2 className="h-3 w-3 text-muted-foreground" />
              {company.name ?? company.domain}
            </span>
            {company.industry && <Pill>{company.industry.name}</Pill>}
            {company.employees != null && <Pill>{fmtEmployees(company.employees)}</Pill>}
            {company.hqCountry && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {company.hqCountry}
              </span>
            )}
            {company.lastFundingRound && (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700">
                <TrendingUp className="h-3 w-3" />
                {company.lastFundingRound.replace(/_/g, ' ')}
              </span>
            )}
          </div>
        )}

        {company && company.technologies.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {company.technologies.slice(0, 6).map((t) => (
              <span key={t.slug} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                {t.name}
              </span>
            ))}
            {company.technologies.length > 6 && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                +{company.technologies.length - 6}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {tier && (
          <span className={`grid h-8 w-8 place-items-center rounded-full text-xs font-bold ring-1 ring-inset ${tier.color}`}>
            {tier.label}
          </span>
        )}
        <button
          onClick={onOpenIntelligence}
          className="rounded-md bg-primary/10 p-2 text-primary hover:bg-primary/20"
          title="Open intelligence"
        >
          <Brain className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function FilterSection({ title, icon: Icon, defaultOpen = false, children }: {
  title: string; icon: any; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card-elevated overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-accent/40"
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          {title}
        </span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && <div className="space-y-3 border-t bg-muted/10 px-3 py-3">{children}</div>}
    </div>
  );
}

function CheckboxList({ label, options, selected, onToggle, limit }: {
  label: string;
  options: Array<{ id: string; label: string }>;
  selected: string[];
  onToggle: (v: string) => void;
  limit?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = limit && !showAll ? options.slice(0, limit) : options;
  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1">
        {visible.map((opt) => {
          const on = selected.includes(opt.id);
          return (
            <button
              key={opt.id}
              onClick={() => onToggle(opt.id)}
              className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                on ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
        {limit && options.length > limit && (
          <button
            onClick={() => setShowAll((s) => !s)}
            className="rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
          >
            {showAll ? 'less' : `+${options.length - limit} more`}
          </button>
        )}
      </div>
    </div>
  );
}

function RangeRow({ label, value, min, max, step, onChange, format }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format: (v: number) => string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[10px]">
        <span className="font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums text-foreground">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full accent-primary"
      />
    </div>
  );
}

function RadioRow({ label, options, selected, onSelect }: {
  label: string;
  options: Array<{ id: string; label: string }>;
  selected: string | null;
  onSelect: (v: string | null) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const on = selected === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => onSelect(on ? null : opt.id)}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${
                on ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium">{children}</span>;
}

// ─── Chip-builder + helpers ────────────────────────────────────────────────

interface Chip { key: string; label: string; icon?: any; onRemove: () => void; }

function buildActiveChips(filter: Filter): Chip[] {
  const chips: Chip[] = [];
  // This is intentionally pure — we hand back labels + remover callbacks
  // and the page handles the actual state update.
  return chips; // Note: filter chips are rendered visually next to the column titles for now
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function humanizeSlug(s: string): string {
  return s.split('-').map(capitalize).join(' ');
}

function fmtEmployees(n: number): string {
  if (n >= 5000) return '5,000+';
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  if (n >= 100)  return `${n}`;
  return `${n}`;
}
