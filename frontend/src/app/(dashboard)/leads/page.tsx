'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Download, Filter, Search, Loader2, Mail, Linkedin, MapPin, Building2,
  CheckCircle2, AlertTriangle, XCircle, HelpCircle, Sparkles, Star, Archive, Trash2, Plug, X, FolderHeart, Upload, UserPlus, Brain,
} from 'lucide-react';
import { ImportLeadsModal } from '@/components/leads/import-modal';
import { ManualAddLeadModal } from '@/components/leads/manual-add-modal';
import { IntelligencePanel } from '@/components/leads/intelligence-panel';
import { toast } from 'sonner';
import { useAuth } from '@clerk/nextjs';
import { useApi, ApiError } from '@/lib/client-api';
import { Avatar } from '@/components/ui/avatar';

interface Lead {
  id: string;
  email: string | null;
  fullName: string | null;
  jobTitle: string | null;
  companyName: string | null;
  companyDomain: string | null;
  country: string | null;
  city: string | null;
  linkedinUrl: string | null;
  twitterUrl: string | null;
  qualityScore: number | null;
  verificationStatus: string;
  technologies: string[];
  sourceUrl: string;
  isFavorite?: boolean;
}

const VERIFY_META: Record<string, { color: string; icon: any; label: string }> = {
  VALID:     { color: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30', icon: CheckCircle2,   label: 'Valid'     },
  INVALID:   { color: 'bg-rose-500/10 text-rose-600 ring-rose-500/30',          icon: XCircle,         label: 'Invalid'   },
  RISKY:     { color: 'bg-amber-500/10 text-amber-600 ring-amber-500/30',       icon: AlertTriangle,   label: 'Risky'     },
  CATCH_ALL: { color: 'bg-amber-500/10 text-amber-600 ring-amber-500/30',       icon: AlertTriangle,   label: 'Catch-all' },
  UNKNOWN:   { color: 'bg-slate-500/10 text-slate-600 ring-slate-500/30',       icon: HelpCircle,      label: 'Unknown'   },
  PENDING:   { color: 'bg-slate-500/10 text-slate-500 ring-slate-500/30',       icon: HelpCircle,      label: 'Pending'   },
};

const FILTER_CHIPS = [
  { key: 'all',      label: 'All',         filter: {} },
  { key: 'valid',    label: 'Verified',    filter: { verificationStatus: 'VALID' } },
  { key: 'risky',    label: 'Risky',       filter: { verificationStatus: 'RISKY' } },
  { key: 'top',      label: 'Top quality', filter: { sortBy: 'qualityScore', sortOrder: 'desc' as const } },
  { key: 'fav',      label: 'Favorites',   filter: { isFavorite: true } },
] as const;

export default function LeadsPage() {
  const api = useApi();
  const { getToken } = useAuth();
  const searchParams = useSearchParams();
  const jobId = searchParams.get('jobId');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTER_CHIPS)[number]['key']>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showListPicker, setShowListPicker] = useState(false);
  const [availableLists, setAvailableLists] = useState<Array<{ id: string; name: string; leadCount: number }>>([]);
  const [newListName, setNewListName] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showManualAdd, setShowManualAdd] = useState(false);
  // Intelligence panel — opens to the right when a row's Brain icon is clicked
  const [intelligenceLeadId, setIntelligenceLeadId] = useState<string | null>(null);
  const [runningBulkIntel, setRunningBulkIntel] = useState(false);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const PAGE_SIZE = 100;

  async function load(reset = true) {
    if (reset) { setLoading(true); setPage(1); }
    const currentPage = reset ? 1 : page;
    const qs = new URLSearchParams({ pageSize: String(PAGE_SIZE), page: String(currentPage) });
    if (jobId) qs.set('jobId', jobId);
    if (search) qs.set('search', search);
    const chip = FILTER_CHIPS.find((c) => c.key === filter);
    if (chip) {
      for (const [k, v] of Object.entries(chip.filter)) qs.set(k, String(v));
    }
    try {
      const res = await api.get<{ leads: Lead[]; total: number }>(`/leads?${qs}`);
      if (reset) setLeads(res.leads);
      else setLeads(prev => [...prev, ...res.leads]);
      setTotal(res.total);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  async function loadMore() {
    setLoadingMore(true);
    const nextPage = page + 1;
    setPage(nextPage);
    const qs = new URLSearchParams({ pageSize: String(PAGE_SIZE), page: String(nextPage) });
    if (jobId) qs.set('jobId', jobId);
    if (search) qs.set('search', search);
    const chip = FILTER_CHIPS.find((c) => c.key === filter);
    if (chip) {
      for (const [k, v] of Object.entries(chip.filter)) qs.set(k, String(v));
    }
    try {
      const res = await api.get<{ leads: Lead[]; total: number }>(`/leads?${qs}`);
      setLeads(prev => [...prev, ...res.leads]);
      setTotal(res.total);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => { load(true); }, [jobId, search, filter]);

  async function exportFormat(format: 'CSV' | 'XLSX' | 'JSON') {
    setExporting(true);
    try {
      if (format === 'CSV') {
        // Synchronous streaming CSV — triggers a normal browser download.
        // Carries the same filters the table is showing so the file matches
        // what the user is looking at. If the user has rows selected, only
        // those rows are exported.
        const params = new URLSearchParams();
        if (selected.size > 0) params.set('leadIds', Array.from(selected).join(','));
        else {
          if (jobId) params.set('jobId', jobId);
          if (search) params.set('search', search);
          if (filter !== 'all') params.set('verificationStatus', filter.toUpperCase());
        }
        // Use a same-origin download — the Next rewrite proxies it to Railway,
        // and we still get the authenticated session because Clerk is on the
        // same host. For browsers that need an Authorization header on the
        // request, we fetch as blob + trigger a download programmatically.
        const token = await getToken();
        const res = await fetch(`/api/backend/leads/export.csv?${params.toString()}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`Export failed (${res.status})`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `leadforge-export-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast.success(`Exported ${selected.size > 0 ? `${selected.size} selected` : 'all'} leads`);
      } else {
        // XLSX / JSON still go through the async queue.
        await api.post('/exports', { format, ...(jobId && { jobId }) });
        toast.success(`${format} export queued — find it in Settings → Billing → Exports`);
      }
    } catch (e: any) { toast.error(e.message); }
    finally { setExporting(false); }
  }

  async function openListPicker() {
    try {
      const res = await api.get<{ lists: Array<{ id: string; name: string; leadCount: number }> }>('/lead-lists');
      setAvailableLists(res.lists);
      setShowListPicker(true);
    } catch (e: any) { toast.error(e.message); }
  }

  async function addSelectedToList(listId: string) {
    if (selected.size === 0) return;
    try {
      const res = await api.post<{ added: number }>(`/lead-lists/${listId}/add`, { leadIds: Array.from(selected) });
      toast.success(`Added ${res.added} to list`);
      setSelected(new Set());
      setShowListPicker(false);
    } catch (e: any) { toast.error(e.message); }
  }

  async function createListAndAdd() {
    if (!newListName.trim() || selected.size === 0) return;
    try {
      const list = await api.post<{ list: { id: string } }>('/lead-lists', { name: newListName.trim() });
      await api.post(`/lead-lists/${list.list.id}/add`, { leadIds: Array.from(selected) });
      toast.success(`Created "${newListName}" with ${selected.size} leads`);
      setNewListName('');
      setSelected(new Set());
      setShowListPicker(false);
    } catch (e: any) { toast.error(e.message); }
  }

  async function pushSelectedToHubspot() {
    if (selected.size === 0) return;
    try {
      const res = await api.post<{ pushed: number; failed: number; skipped: number }>('/integrations/hubspot/push', {
        lead_ids: Array.from(selected),
      });
      toast.success(`HubSpot: ${res.pushed} pushed, ${res.skipped} skipped, ${res.failed} failed`);
      setSelected(new Set());
    } catch (e: any) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to push');
    }
  }

  async function bulkAction(action: 'archive' | 'favorite' | 'unfavorite' | 'delete' | 'verify') {
    if (selected.size === 0) return;
    if (action === 'delete' && !confirm(`Permanently delete ${selected.size} leads?`)) return;
    try {
      await api.post('/leads/bulk', { ids: Array.from(selected), action });
      toast.success(`${action} applied to ${selected.size} leads`);
      setSelected(new Set());
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  function toggleRow(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleAll() {
    if (selected.size === leads.length && leads.length > 0) setSelected(new Set());
    else setSelected(new Set(leads.map((l) => l.id)));
  }

  const allSelected = leads.length > 0 && selected.size === leads.length;

  return (
    <div className="space-y-3 overflow-x-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {jobId ? (
              <>Filtered by job <span className="font-mono text-xs text-foreground">{jobId.slice(-12)}</span></>
            ) : (
              <>Browse and act on every contact your pipeline has extracted.</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowManualAdd(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-grad-brand px-3 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
          >
            <UserPlus className="h-3.5 w-3.5" /> Add lead
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            <Upload className="h-3.5 w-3.5" /> Import CSV
          </button>
          <div className="flex divide-x divide-border overflow-hidden rounded-lg border bg-card text-xs font-medium">
            {(['CSV', 'XLSX', 'JSON'] as const).map((f) => (
              <button
                key={f}
                disabled={exporting}
                onClick={() => exportFormat(f)}
                className="px-3 py-2 transition-colors hover:bg-accent disabled:opacity-50"
              >
                {f}
              </button>
            ))}
          </div>
          {exporting && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {/* Filter chip bar + search */}
      <div className="card-elevated p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1.5">
            {FILTER_CHIPS.map((c) => (
              <button
                key={c.key}
                onClick={() => setFilter(c.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                  filter === c.key
                    ? 'bg-grad-brand text-white shadow-sm'
                    : 'border bg-background text-muted-foreground hover:text-foreground'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-full max-w-sm md:w-auto">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search emails, names, domains…"
              className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bulk action bar — slides in when rows selected */}
      {selected.size > 0 && (
        <div className="sticky top-20 z-10 flex flex-wrap items-center gap-2 rounded-xl border-2 border-primary/30 bg-card/95 p-3 shadow-lg backdrop-blur-md">
          <span className="ml-1 text-sm font-semibold">
            {selected.size} selected
          </span>
          <span className="text-xs text-muted-foreground">
            <button onClick={() => setSelected(new Set())} className="ml-2 hover:underline">clear</button>
          </span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <BulkBtn
              onClick={async () => {
                if (runningBulkIntel) return;
                setRunningBulkIntel(true);
                const ids = Array.from(selected);
                let done = 0;
                const icp = typeof window !== 'undefined'
                  ? (localStorage.getItem('leadforge:icp_description') ?? '')
                  : '';
                // 3 in flight at a time — the LLM scorer is the bottleneck and
                // it tolerates 5-10 req/s on Groq. 3 keeps things polite.
                const queue = [...ids];
                const work = async () => {
                  while (queue.length) {
                    const id = queue.shift()!;
                    try {
                      await api.post('/intelligence/score', {
                        leadId: id,
                        ...(icp.trim() ? { icpDescription: icp.trim() } : {}),
                      });
                    } catch (e: any) {
                      // Don't fail the batch — surface a single toast at the end
                    }
                    done++;
                  }
                };
                toast.info(`Running intelligence on ${ids.length} leads…`);
                await Promise.all([work(), work(), work()]);
                toast.success(`Scored ${done} / ${ids.length} leads`);
                setRunningBulkIntel(false);
                load(); // refresh table to show new scores
              }}
              icon={runningBulkIntel ? Loader2 : Brain}
              label={runningBulkIntel ? 'Scoring…' : 'Run intelligence'}
              variant="primary"
            />
            <BulkBtn onClick={() => bulkAction('verify')}     icon={Mail}        label="Verify"    />
            <BulkBtn onClick={openListPicker}                 icon={FolderHeart} label="Add to list" />
            <BulkBtn onClick={() => bulkAction('favorite')}   icon={Star}        label="Favorite"  />
            <BulkBtn onClick={pushSelectedToHubspot}          icon={Plug}        label="HubSpot"   variant="orange" />
            <BulkBtn onClick={() => bulkAction('archive')}    icon={Archive}  label="Archive"   />
            <BulkBtn onClick={() => bulkAction('delete')}     icon={Trash2}   label="Delete"    variant="danger"  />
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="card-elevated grid place-items-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : leads.length === 0 ? (
        <EmptyState search={search} filter={filter} onAddManual={() => setShowManualAdd(true)} onImport={() => setShowImport(true)} />
      ) : (
        <>
          <p className="px-1 text-xs text-muted-foreground">
            <span className="tabular-nums">{total.toLocaleString()}</span> total · showing {leads.length}
          </p>
          {/* No forced min-width — instead progressively reveal columns as the
              viewport grows. Lead identity + score + status are always visible;
              everything else is opt-in at md/lg/xl. */}
          <div className="card-elevated overflow-x-hidden">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-10" />           {/* checkbox */}
                <col className="w-[38%]" />         {/* Lead */}
                <col className="hidden w-[22%] md:table-column" /> {/* Company */}
                <col className="hidden w-[18%] xl:table-column" /> {/* Title */}
                <col className="w-20" />            {/* Score */}
                <col className="w-24" />            {/* Status */}
                <col className="w-16" />            {/* Actions */}
              </colgroup>
              <thead className="border-b bg-muted/30 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
                    />
                  </th>
                  <th className="px-2 py-2.5 font-semibold">Lead</th>
                  <th className="hidden px-2 py-2.5 font-semibold md:table-cell">Company</th>
                  <th className="hidden px-2 py-2.5 font-semibold xl:table-cell">Title</th>
                  <th className="px-2 py-2.5 font-semibold">Score</th>
                  <th className="px-2 py-2.5 font-semibold">Status</th>
                  <th className="px-2 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => {
                  const isChecked = selected.has(l.id);
                  const verify = VERIFY_META[l.verificationStatus] ?? VERIFY_META.UNKNOWN!;
                  return (
                    <tr
                      key={l.id}
                      className={`group border-t border-border/40 transition-colors ${
                        isChecked ? 'bg-primary/5' : 'hover:bg-muted/40'
                      }`}
                    >
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleRow(l.id)}
                          className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
                        />
                      </td>
                      {/* Lead — always visible */}
                      <td className="min-w-0 px-2 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={l.fullName} email={l.email} size="sm" />
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <div className="truncate text-sm font-medium leading-tight">
                              {l.fullName ?? l.email?.split('@')[0] ?? '—'}
                            </div>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Mail className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate font-mono text-[11px]">{l.email ?? '—'}</span>
                            </div>
                            {l.companyName && (
                              <div className="flex items-center gap-1 text-[11px] text-muted-foreground md:hidden">
                                <Building2 className="h-2.5 w-2.5 shrink-0" />
                                <span className="truncate">{l.companyName}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      {/* Company — md+ */}
                      <td className="hidden min-w-0 overflow-hidden px-2 py-2.5 md:table-cell">
                        {l.companyName ? (
                          <div className="flex items-center gap-1.5 text-xs">
                            <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                            <span className="truncate font-medium">{l.companyName}</span>
                          </div>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                        {l.country && (
                          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                            <MapPin className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate">{[l.city, l.country].filter(Boolean).join(', ')}</span>
                          </div>
                        )}
                      </td>
                      {/* Title — xl+ */}
                      <td className="hidden overflow-hidden px-2 py-2.5 xl:table-cell">
                        <div className="truncate text-xs text-muted-foreground">{l.jobTitle ?? '—'}</div>
                        {l.technologies.length > 0 && (
                          <div className="mt-0.5 flex gap-0.5">
                            {l.technologies.slice(0, 2).map((t) => (
                              <span key={t} className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium">{t}</span>
                            ))}
                            {l.technologies.length > 2 && (
                              <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">+{l.technologies.length - 2}</span>
                            )}
                          </div>
                        )}
                      </td>
                      {/* Score */}
                      <td className="px-2 py-2.5">
                        {l.qualityScore != null ? (
                          <div className="flex flex-col gap-1">
                            <span className="text-xs font-bold tabular-nums">{l.qualityScore}</span>
                            <div className="relative h-1 w-12 overflow-hidden rounded-full bg-muted">
                              <div className="absolute inset-y-0 left-0 rounded-full bg-grad-brand"
                                   style={{ width: `${l.qualityScore}%` }} />
                            </div>
                          </div>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                      {/* Status */}
                      <td className="px-2 py-2.5">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${verify.color}`}>
                          <verify.icon className="h-2.5 w-2.5" />
                          {verify.label}
                        </span>
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                          {/* Intelligence — always visible, primary action */}
                          <button
                            onClick={() => setIntelligenceLeadId(l.id)}
                            className="rounded p-1 text-primary hover:bg-primary/10"
                            title="Run intelligence (enrichment + intent + AI scoring)"
                            aria-label="Run intelligence"
                          >
                            <Brain className="h-3.5 w-3.5" />
                          </button>
                          {l.linkedinUrl && (
                            <a
                              href={l.linkedinUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                              title="LinkedIn"
                            >
                              <Linkedin className="h-3.5 w-3.5" />
                            </a>
                          )}
                          {l.sourceUrl && (
                            <a
                              href={l.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                              title="Source"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Load more */}
          {leads.length < total && (
            <div className="flex flex-col items-center gap-2 py-6">
              <p className="text-xs text-muted-foreground">
                Showing <span className="font-semibold tabular-nums">{leads.length.toLocaleString()}</span> of <span className="font-semibold tabular-nums">{total.toLocaleString()}</span> leads
              </p>
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 rounded-lg border bg-card px-5 py-2 text-sm font-semibold shadow-sm hover:bg-accent disabled:opacity-50 transition-colors"
              >
                {loadingMore
                  ? <><svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Loading…</>
                  : <>Load {Math.min(100, total - leads.length).toLocaleString()} more &darr;</>
                }
              </button>
            </div>
          )}
          {leads.length >= total && total > 0 && (
            <p className="py-3 text-center text-xs text-muted-foreground">All {total.toLocaleString()} leads loaded ✓</p>
          )}
        </>
      )}

      <IntelligencePanel
        leadId={intelligenceLeadId}
        onClose={() => { setIntelligenceLeadId(null); load(); }}
      />
      <ImportLeadsModal open={showImport} onClose={() => setShowImport(false)} onImported={load} />
      <ManualAddLeadModal open={showManualAdd} onClose={() => setShowManualAdd(false)} onAdded={load} />

      {/* List picker modal */}
      {showListPicker && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4 backdrop-blur-sm" onClick={() => setShowListPicker(false)}>
          <div onClick={(e) => e.stopPropagation()} className="card-elevated max-h-[80vh] w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h3 className="text-sm font-semibold">Add {selected.size} leads to list</h3>
              <button onClick={() => setShowListPicker(false)} className="rounded p-1 text-muted-foreground hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Create a new list</label>
                <div className="flex gap-2">
                  <input
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    placeholder="e.g. Q1 SaaS Targets"
                    className="flex-1 rounded-md border bg-background px-2.5 py-1.5 text-sm"
                    onKeyDown={(e) => { if (e.key === 'Enter') createListAndAdd(); }}
                  />
                  <button
                    onClick={createListAndAdd}
                    disabled={!newListName.trim()}
                    className="rounded-md bg-grad-brand px-2.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Create
                  </button>
                </div>
              </div>
              {availableLists.length > 0 && (
                <>
                  <div className="my-4 text-center text-[10px] uppercase tracking-wider text-muted-foreground">or pick an existing list</div>
                  <ul className="max-h-64 space-y-1 overflow-y-auto">
                    {availableLists.map((l) => (
                      <li key={l.id}>
                        <button
                          onClick={() => addSelectedToList(l.id)}
                          className="flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent"
                        >
                          <span className="flex items-center gap-2 truncate">
                            <FolderHeart className="h-3.5 w-3.5 text-primary" />
                            <span className="truncate">{l.name}</span>
                          </span>
                          <span className="text-xs text-muted-foreground">{l.leadCount}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BulkBtn({
  onClick, icon: Icon, label, variant = 'default',
}: {
  onClick: () => void; icon: any; label: string; variant?: 'default' | 'danger' | 'orange' | 'primary';
}) {
  const styles =
    variant === 'danger'
      ? 'border-destructive/40 text-destructive hover:bg-destructive/10'
      : variant === 'orange'
        ? 'border-orange-500/40 text-orange-600 hover:bg-orange-500/10'
        : variant === 'primary'
          ? 'border-primary/40 text-primary hover:bg-primary/10'
          : 'border hover:bg-accent';
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${styles}`}
    >
      <Icon className="h-3 w-3" /> {label}
    </button>
  );
}

function EmptyState({
  search, filter, onAddManual, onImport,
}: {
  search: string; filter: string; onAddManual: () => void; onImport: () => void;
}) {
  const reason = search ? `matching "${search}"` : filter !== 'all' ? `in "${filter}"` : '';
  const hasFilter = !!search || filter !== 'all';
  return (
    <div className="card-elevated grid place-items-center py-16 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5">
        <Mail className="h-7 w-7 text-primary" />
      </div>
      <h3 className="mt-4 font-semibold">No leads {reason}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {hasFilter ? 'Try a different filter or search term.' : 'Add one manually, paste a list, or run an extraction.'}
      </p>
      {!hasFilter && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={onAddManual}
            className="inline-flex items-center gap-1.5 rounded-lg bg-grad-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
          >
            <UserPlus className="h-3.5 w-3.5" /> Add lead manually
          </button>
          <button
            onClick={onImport}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            <Upload className="h-3.5 w-3.5" /> Import CSV
          </button>
          <Link
            href="/extraction"
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            <Sparkles className="h-3.5 w-3.5" /> New extraction
          </Link>
        </div>
      )}
    </div>
  );
}
