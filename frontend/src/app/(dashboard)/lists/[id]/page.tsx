'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, Users, Trash2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useApi } from '@/lib/client-api';
import { Avatar } from '@/components/ui/avatar';

interface ListDetail {
  id: string;
  name: string;
  description: string | null;
  color: string;
  leadCount: number;
  leads: Array<{
    id: string;
    email: string | null;
    fullName: string | null;
    jobTitle: string | null;
    companyName: string | null;
    country: string | null;
    qualityScore: number | null;
    verificationStatus: string;
    linkedinUrl: string | null;
    technologies: string[];
    addedAt: string;
  }>;
}

export default function ListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const api = useApi();
  const [list, setList] = useState<ListDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ list: ListDetail }>(`/lead-lists/${id}`);
      setList(res.list);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [id]);

  async function removeSelected() {
    if (selected.size === 0) return;
    try {
      await api.post(`/lead-lists/${id}/remove`, { leadIds: Array.from(selected) });
      toast.success(`Removed ${selected.size} from list`);
      setSelected(new Set());
      load();
    } catch (e: any) { toast.error(e.message); }
  }

  if (loading) return <div className="grid place-items-center py-24"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!list) return <div>List not found</div>;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <Link href="/lists" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Lists
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{list.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" /> {list.leadCount} leads
          </p>
        </div>
        <Link
          href={`/campaigns/new?listId=${list.id}`}
          className="inline-flex items-center gap-2 rounded-lg bg-grad-brand px-4 py-2 text-sm font-semibold text-white shadow-sm"
        >
          <Send className="h-4 w-4" /> Launch campaign
        </Link>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-20 z-10 flex items-center justify-between rounded-xl border-2 border-primary/30 bg-card/95 p-3 shadow-lg backdrop-blur-md">
          <span className="text-sm font-semibold">{selected.size} selected</span>
          <button
            onClick={removeSelected}
            className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3 w-3" /> Remove from list
          </button>
        </div>
      )}

      {list.leads.length === 0 ? (
        <div className="card-elevated grid place-items-center py-16 text-center">
          <h3 className="font-semibold">List is empty</h3>
          <p className="mt-1 text-sm text-muted-foreground">Go to <Link href="/leads" className="text-primary hover:underline">Leads</Link>, select rows, then "Add to list".</p>
        </div>
      ) : (
        <div className="card-elevated overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-3 sm:w-12 sm:px-4"></th>
                <th className="px-2 py-3 font-semibold">Lead</th>
                <th className="hidden px-2 py-3 font-semibold lg:table-cell">Title</th>
                <th className="hidden px-2 py-3 font-semibold md:table-cell">Company</th>
                <th className="px-2 py-3 font-semibold">Score</th>
                <th className="px-2 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.leads.map((l) => (
                <tr key={l.id} className={`group border-t border-border/40 transition-colors ${selected.has(l.id) ? 'bg-primary/5' : 'hover:bg-muted/40'}`}>
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(l.id)}
                      onChange={() => {
                        setSelected((s) => {
                          const n = new Set(s);
                          n.has(l.id) ? n.delete(l.id) : n.add(l.id);
                          return n;
                        });
                      }}
                      className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
                    />
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={l.fullName} email={l.email} size="sm" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{l.fullName ?? l.email?.split('@')[0]}</div>
                        <div className="truncate text-xs text-muted-foreground font-mono">{l.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden max-w-[180px] truncate px-2 py-2.5 text-xs text-muted-foreground lg:table-cell">{l.jobTitle ?? '—'}</td>
                  <td className="hidden px-2 py-2.5 text-sm md:table-cell">{l.companyName ?? '—'}</td>
                  <td className="px-2 py-2.5">
                    {l.qualityScore != null ? (
                      <div className="inline-flex items-center gap-2 text-xs font-semibold tabular-nums">
                        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                          <div className="h-full bg-grad-brand" style={{ width: `${l.qualityScore}%` }} />
                        </div>
                        {l.qualityScore}
                      </div>
                    ) : '—'}
                  </td>
                  <td className="px-2 py-2.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ring-border">
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
  );
}
