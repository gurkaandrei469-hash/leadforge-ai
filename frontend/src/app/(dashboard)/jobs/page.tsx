'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Loader2, Search, Pencil, Trash2, MoreHorizontal, Play, Pause, X as XIcon,
  CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useApi, ApiError } from '@/lib/client-api';
import { formatRelative } from '@/lib/utils';

interface Job {
  id: string;
  name: string;
  description: string | null;
  status: 'PENDING' | 'QUEUED' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress: number;
  leadsFound: number;
  targetLeads: number;
  pagesScraped: number;
  sources: string[];
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  schedule: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING:   'bg-slate-500/10 text-slate-600',
  QUEUED:    'bg-slate-500/10 text-slate-600',
  RUNNING:   'bg-blue-500/10 text-blue-600',
  PAUSED:    'bg-amber-500/10 text-amber-600',
  COMPLETED: 'bg-emerald-500/10 text-emerald-600',
  FAILED:    'bg-rose-500/10 text-rose-600',
  CANCELLED: 'bg-slate-500/10 text-slate-500',
};

export default function JobsPage() {
  const api = useApi();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Job | null>(null);
  const [deleting, setDeleting] = useState<Job | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const activeRef = useRef(true);

  async function load() {
    try {
      const res = await api.get<{ jobs: Job[] }>('/jobs?pageSize=50');
      if (activeRef.current) setJobs(res.jobs);
    } finally {
      if (activeRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    activeRef.current = true;
    load();
    const tick = setInterval(load, 4000);
    return () => { activeRef.current = false; clearInterval(tick); };
  }, []);

  function toggleRow(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    if (selected.size === jobs.length && jobs.length > 0) setSelected(new Set());
    else setSelected(new Set(jobs.map((j) => j.id)));
  }

  async function quickAction(j: Job, action: 'pause' | 'resume' | 'cancel') {
    try {
      await api.post(`/jobs/${j.id}/${action}`, {});
      toast.success(`Job ${action}d`);
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed');
    }
  }

  async function bulkDelete(deleteLeads: boolean) {
    if (selected.size === 0) return;
    try {
      const res = await api.post<{ deleted: number }>('/jobs/bulk-delete', {
        ids: Array.from(selected),
        deleteLeads,
      });
      toast.success(`Deleted ${res.deleted} job${res.deleted === 1 ? '' : 's'}`);
      setSelected(new Set());
      setBulkDeleting(false);
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Bulk delete failed');
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Jobs</h1>
          <p className="text-xs text-muted-foreground">{jobs.length} {jobs.length === 1 ? 'job' : 'jobs'} total</p>
        </div>
        <Link
          href="/extraction"
          className="rounded-md bg-grad-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
        >
          + New extraction
        </Link>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="sticky top-20 z-10 flex flex-wrap items-center gap-2 rounded-xl border-2 border-primary/30 bg-card/95 p-3 shadow-lg backdrop-blur-md">
          <span className="ml-1 text-sm font-semibold">
            {selected.size} selected
          </span>
          <button onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:underline">
            clear
          </button>
          <div className="ml-auto">
            <button
              onClick={() => setBulkDeleting(true)}
              className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3 w-3" /> Delete {selected.size}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <Search className="mx-auto h-10 w-10 text-muted-foreground" />
          <h3 className="mt-3 font-semibold">No jobs yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">Create your first extraction to start pulling leads.</p>
          <Link href="/extraction" className="mt-4 inline-block rounded-md bg-grad-brand px-4 py-2 text-sm font-semibold text-white">
            + New extraction
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card scroll-touch">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b bg-muted/40 text-left">
              <tr>
                <th className="w-10 p-3">
                  <input
                    type="checkbox"
                    checked={selected.size === jobs.length && jobs.length > 0}
                    onChange={toggleAll}
                    className="h-4 w-4 cursor-pointer rounded accent-primary"
                  />
                </th>
                <th className="p-3">Name</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Leads</th>
                <th>Pages</th>
                <th>Priority</th>
                <th>Created</th>
                <th className="text-right pr-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const isChecked = selected.has(j.id);
                const canPause = j.status === 'RUNNING' || j.status === 'QUEUED';
                const canResume = j.status === 'PAUSED';
                const canCancel = j.status !== 'COMPLETED' && j.status !== 'CANCELLED' && j.status !== 'FAILED';
                return (
                  <tr
                    key={j.id}
                    className={`border-b last:border-0 transition-colors ${isChecked ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                  >
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleRow(j.id)}
                        className="h-4 w-4 cursor-pointer rounded accent-primary"
                      />
                    </td>
                    <td className="p-3 max-w-[280px]">
                      <Link href={`/jobs/${j.id}`} className="block">
                        <div className="font-medium truncate hover:text-primary">{j.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{j.sources.join(' · ').toLowerCase()}</div>
                      </Link>
                    </td>
                    <td>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLORS[j.status] ?? ''}`}>
                        {j.status}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded bg-muted">
                          <div className="h-full bg-primary" style={{ width: `${Math.round(j.progress)}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{Math.round(j.progress)}%</span>
                      </div>
                    </td>
                    <td className="text-xs">{j.leadsFound} / {j.targetLeads}</td>
                    <td className="text-xs text-muted-foreground">{j.pagesScraped}</td>
                    <td className="text-xs">{j.priority}</td>
                    <td className="text-xs text-muted-foreground">{formatRelative(j.createdAt)}</td>
                    <td className="pr-3">
                      <div className="flex items-center justify-end gap-0.5">
                        {/* Inline lifecycle action — status-aware */}
                        {canPause && (
                          <IconBtn title="Pause" onClick={() => quickAction(j, 'pause')}>
                            <Pause className="h-3.5 w-3.5" />
                          </IconBtn>
                        )}
                        {canResume && (
                          <IconBtn title="Resume" onClick={() => quickAction(j, 'resume')}>
                            <Play className="h-3.5 w-3.5 text-emerald-600" />
                          </IconBtn>
                        )}
                        {canCancel && j.status !== 'PAUSED' && (
                          <IconBtn title="Cancel" onClick={() => quickAction(j, 'cancel')}>
                            <XIcon className="h-3.5 w-3.5 text-amber-600" />
                          </IconBtn>
                        )}
                        <IconBtn title="Edit" onClick={() => setEditing(j)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </IconBtn>
                        <IconBtn title="Delete" onClick={() => setDeleting(j)} danger>
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconBtn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <EditJobModal
          job={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {/* Single delete confirm */}
      {deleting && (
        <DeleteJobDialog
          job={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => { setDeleting(null); load(); }}
        />
      )}

      {/* Bulk delete confirm */}
      {bulkDeleting && (
        <ConfirmBulkDelete
          count={selected.size}
          onClose={() => setBulkDeleting(false)}
          onConfirm={bulkDelete}
        />
      )}
    </div>
  );
}

function IconBtn({
  onClick, title, children, danger,
}: { onClick: () => void; title: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded-md p-1.5 transition-colors ${
        danger ? 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function EditJobModal({
  job, onClose, onSaved,
}: { job: Job; onClose: () => void; onSaved: () => void }) {
  const api = useApi();
  const [name, setName] = useState(job.name);
  const [description, setDescription] = useState(job.description ?? '');
  const [priority, setPriority] = useState<Job['priority']>(job.priority);
  const [schedule, setSchedule] = useState(job.schedule ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return toast.error('Name is required');
    setSaving(true);
    try {
      await api.patch(`/jobs/${job.id}`, {
        name: name.trim(),
        description: description.trim() || null,
        priority,
        schedule: schedule.trim() || null,
      });
      toast.success('Job updated');
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Update failed');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="card-elevated w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h3 className="text-base font-semibold">Edit job</h3>
            <p className="text-xs text-muted-foreground">Sources, filters & target are immutable — create a new job to change those.</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Name <span className="text-rose-500">*</span></label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full resize-y rounded-md border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="Optional notes for your team"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Job['priority'])}
                className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm"
              >
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Cron schedule</label>
              <input
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                placeholder="0 9 * * *"
                className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm font-mono"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t bg-muted/20 px-5 py-3">
          <button onClick={onClose} disabled={saving} className="rounded-md border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !name.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-grad-brand px-4 py-1.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteJobDialog({
  job, onClose, onDeleted,
}: { job: Job; onClose: () => void; onDeleted: () => void }) {
  const api = useApi();
  const [deleteLeads, setDeleteLeads] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await api.del(`/jobs/${job.id}${deleteLeads ? '?deleteLeads=true' : ''}`);
      toast.success('Job deleted');
      onDeleted();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Delete failed');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="card-elevated w-full max-w-md overflow-hidden">
        <div className="border-b px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold">Delete job?</h3>
              <p className="text-xs text-muted-foreground">This cannot be undone.</p>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-5">
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-sm font-medium truncate">{job.name}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {job.leadsFound} leads extracted · {job.sources.join(' · ').toLowerCase()}
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-2 rounded-md border bg-card p-3 hover:bg-accent">
            <input
              type="checkbox"
              checked={deleteLeads}
              onChange={(e) => setDeleteLeads(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-destructive"
            />
            <div>
              <div className="text-sm font-medium">Also delete {job.leadsFound} extracted leads</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                By default leads are kept (they're owned by the team, not the job). Tick this to wipe them too.
              </p>
            </div>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t bg-muted/20 px-5 py-3">
          <button onClick={onClose} disabled={busy} className="rounded-md border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent">
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-4 py-1.5 text-sm font-semibold text-destructive-foreground shadow-sm disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete job
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmBulkDelete({
  count, onClose, onConfirm,
}: { count: number; onClose: () => void; onConfirm: (deleteLeads: boolean) => void }) {
  const [deleteLeads, setDeleteLeads] = useState(false);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="card-elevated w-full max-w-md overflow-hidden">
        <div className="border-b px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold">Delete {count} jobs?</h3>
              <p className="text-xs text-muted-foreground">This cannot be undone.</p>
            </div>
          </div>
        </div>
        <div className="p-5">
          <label className="flex cursor-pointer items-start gap-2 rounded-md border bg-card p-3 hover:bg-accent">
            <input type="checkbox" checked={deleteLeads} onChange={(e) => setDeleteLeads(e.target.checked)} className="mt-0.5 h-4 w-4 accent-destructive" />
            <div>
              <div className="text-sm font-medium">Also delete extracted leads from these jobs</div>
              <p className="mt-0.5 text-xs text-muted-foreground">Otherwise leads are kept and detached from the job.</p>
            </div>
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t bg-muted/20 px-5 py-3">
          <button onClick={onClose} className="rounded-md border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(deleteLeads)}
            className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-4 py-1.5 text-sm font-semibold text-destructive-foreground shadow-sm"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete {count}
          </button>
        </div>
      </div>
    </div>
  );
}
