'use client';
import { useState, useRef } from 'react';
import { Upload, FileText, Loader2, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useApi, ApiError } from '@/lib/client-api';

interface ImportResult {
  summary: {
    parsed: number;
    imported: number;
    skipped_no_email: number;
    skipped_duplicate: number;
    errors: number;
    preview: Array<{ email: string; fullName?: string | null; companyName?: string | null }>;
  };
  columnMap: Record<string, string>;
}

export function ImportLeadsModal({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const api = useApi();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [verify, setVerify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  async function handleFile(file: File) {
    if (file.size > 20 * 1024 * 1024) return toast.error('File too large (max 20 MB)');
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    setPreview(null);
  }

  async function runDryRun() {
    if (!csv) return;
    setBusy(true);
    try {
      const res = await api.post<ImportResult>('/leads/import', { csv, dryRun: true });
      setPreview(res);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Preview failed');
    } finally { setBusy(false); }
  }

  async function runImport() {
    if (!csv) return;
    setBusy(true);
    try {
      const res = await api.post<ImportResult>('/leads/import', { csv, verify });
      toast.success(`Imported ${res.summary.imported} leads`);
      onImported();
      reset();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Import failed');
    } finally { setBusy(false); }
  }

  function reset() {
    setCsv(''); setFileName(''); setPreview(null); setVerify(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <div onClick={(e) => e.stopPropagation()} className="card-elevated w-full max-w-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h3 className="text-base font-semibold">Import leads from CSV</h3>
            <p className="text-xs text-muted-foreground">Upload a CSV with at least an email column. Duplicates are skipped automatically.</p>
          </div>
          <button onClick={onClose} disabled={busy} className="rounded p-1 text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {!csv ? (
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/30 py-10 transition-colors hover:bg-muted/50">
              <Upload className="h-7 w-7 text-muted-foreground" />
              <div className="text-sm font-medium">Drop a CSV here or click to browse</div>
              <div className="text-xs text-muted-foreground">Max 20 MB · We auto-detect column names</div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </label>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="h-5 w-5 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{fileName}</div>
                    <div className="text-xs text-muted-foreground">{Math.round(csv.length / 1024).toLocaleString()} KB</div>
                  </div>
                </div>
                <button onClick={reset} className="rounded p-1 text-muted-foreground hover:bg-accent">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {preview && (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat label="Total rows" value={preview.summary.parsed} />
                    <Stat label="Would import" value={preview.summary.imported} color="text-emerald-600" />
                    <Stat label="Duplicates" value={preview.summary.skipped_duplicate} color="text-amber-600" />
                    <Stat label="Missing email" value={preview.summary.skipped_no_email} color="text-rose-600" />
                  </div>

                  <div>
                    <div className="text-xs font-medium text-muted-foreground">Detected columns</div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {Object.entries(preview.columnMap).map(([csvCol, field]) => (
                        <span key={csvCol} className="rounded-md border bg-background px-2 py-0.5 text-[11px]">
                          <span className="font-mono">{csvCol}</span>
                          <span className="mx-1 text-muted-foreground">→</span>
                          <span className="font-semibold">{field}</span>
                        </span>
                      ))}
                    </div>
                  </div>

                  {preview.summary.preview.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">First 10 rows</div>
                      <ul className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto rounded-md border bg-muted/20 p-2 text-[11px]">
                        {preview.summary.preview.map((l, i) => (
                          <li key={i} className="font-mono">
                            {l.email}{l.fullName ? ` · ${l.fullName}` : ''}{l.companyName ? ` · ${l.companyName}` : ''}
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
                Run email verification on imported leads (queues 6-layer check per email)
              </label>
            </>
          )}
        </div>

        {csv && (
          <div className="flex items-center justify-end gap-2 border-t bg-muted/20 px-5 py-3">
            {!preview && (
              <button
                onClick={runDryRun}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Preview
              </button>
            )}
            <button
              onClick={runImport}
              disabled={busy || !csv}
              className="inline-flex items-center gap-1.5 rounded-md bg-grad-brand px-4 py-1.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <CheckCircle2 className="h-3.5 w-3.5" />
              Import {preview ? `${preview.summary.imported} leads` : 'now'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color = 'text-foreground' }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${color}`}>{value.toLocaleString()}</div>
    </div>
  );
}
