'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FolderHeart, Plus, Users, Calendar, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useApi, ApiError } from '@/lib/client-api';
import { formatRelative } from '@/lib/utils';

interface LeadList {
  id: string;
  name: string;
  description: string | null;
  color: string;
  leadCount: number;
  createdAt: string;
  updatedAt: string;
}

const COLOR_TINTS: Record<string, string> = {
  violet: 'from-violet-500/20 to-violet-500/0 text-violet-500',
  blue:   'from-blue-500/20 to-blue-500/0 text-blue-500',
  emerald:'from-emerald-500/20 to-emerald-500/0 text-emerald-500',
  amber:  'from-amber-500/20 to-amber-500/0 text-amber-500',
  rose:   'from-rose-500/20 to-rose-500/0 text-rose-500',
  cyan:   'from-cyan-500/20 to-cyan-500/0 text-cyan-500',
};

export default function ListsPage() {
  const api = useApi();
  const [lists, setLists] = useState<LeadList[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<keyof typeof COLOR_TINTS>('violet');
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const res = await api.get<{ lists: LeadList[] }>('/lead-lists');
      setLists(res.lists);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.post('/lead-lists', { name: newName.trim(), color: newColor });
      toast.success(`Created "${newName}"`);
      setNewName('');
      setShowCreate(false);
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create');
    } finally { setCreating(false); }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Lead Lists</h1>
          <p className="mt-1 text-sm text-muted-foreground">Curated prospect lists you can drop into campaigns or export.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-grad-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform hover:scale-[1.02]"
        >
          <Plus className="h-4 w-4" /> New list
        </button>
      </div>

      {showCreate && (
        <div className="card-elevated p-6">
          <h3 className="text-sm font-semibold">Create list</h3>
          <div className="mt-3 space-y-3">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. SaaS CEOs · US"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Color</span>
              {(Object.keys(COLOR_TINTS) as Array<keyof typeof COLOR_TINTS>).map((c) => (
                <button
                  key={c}
                  onClick={() => setNewColor(c)}
                  className={`h-6 w-6 rounded-full bg-gradient-to-br ${COLOR_TINTS[c]} ${newColor === c ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background' : ''}`}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={create}
                disabled={creating || !newName.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-grad-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Create
              </button>
              <button
                onClick={() => { setShowCreate(false); setNewName(''); }}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card-elevated grid place-items-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : lists.length === 0 ? (
        <div className="card-elevated grid place-items-center py-16 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-violet-500/15 to-violet-500/5">
            <FolderHeart className="h-7 w-7 text-violet-500" />
          </div>
          <h3 className="mt-4 font-semibold">No lists yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">Group leads into reusable lists for outreach.</p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-grad-brand px-4 py-2 text-sm font-semibold text-white shadow-sm"
          >
            <Plus className="h-4 w-4" /> Create your first list
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {lists.map((l) => {
            const tint = COLOR_TINTS[l.color] ?? COLOR_TINTS.violet;
            return (
              <Link
                key={l.id}
                href={`/lists/${l.id}`}
                className="group card-elevated relative overflow-hidden p-5 transition-transform hover:scale-[1.01]"
              >
                <div className={`pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-gradient-to-br ${tint} opacity-60 blur-2xl transition-opacity group-hover:opacity-100`} />
                <div className="relative">
                  <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${tint}`}>
                    <FolderHeart className="h-5 w-5" />
                  </div>
                  <h3 className="mt-3 font-semibold truncate">{l.name}</h3>
                  {l.description && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{l.description}</p>}
                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {l.leadCount.toLocaleString()} leads</span>
                    <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" /> {formatRelative(l.createdAt)}</span>
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
