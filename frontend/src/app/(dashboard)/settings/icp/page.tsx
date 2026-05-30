'use client';
import { useEffect, useState } from 'react';
import { Brain, Save, Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Ideal Customer Profile settings.
 *
 * The ICP description is the strongest single input to the AI lead scorer —
 * it's how we convert "the LLM thinks this lead looks plausible" into "the LLM
 * thinks this lead looks plausible *for YOUR business*". Stored in localStorage
 * for now; we read it on every /intelligence/score request from the leads page.
 *
 * Future: persist on the Team model so it follows the user across devices and
 * applies on backend auto-scoring (when leads are first extracted, not just
 * when the user manually clicks "Run intelligence").
 */
const STORAGE_KEY = 'leadforge:icp_description';
const EXAMPLES = [
  'VPs of Marketing at B2B SaaS companies with 50-500 employees in North America, focused on growth/demand-gen',
  'CTOs and engineering directors at Series-B/C startups using AWS or GCP, primarily in fintech or healthtech',
  'Founders of e-commerce brands doing $1M-$10M ARR on Shopify, in apparel/beauty/home goods',
  'Heads of Sales Operations at enterprise (500+ employees) software companies using Salesforce',
];

export default function IcpSettingsPage() {
  const [icp, setIcp] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem(STORAGE_KEY) ?? '';
    setIcp(stored);
    setSaved(stored);
  }, []);

  function save() {
    setSaving(true);
    try {
      localStorage.setItem(STORAGE_KEY, icp.trim());
      setSaved(icp.trim());
      toast.success('ICP saved — applied to future intelligence runs');
    } finally {
      setTimeout(() => setSaving(false), 250);
    }
  }

  const dirty = icp.trim() !== (saved ?? '').trim();
  const charCount = icp.length;
  const maxChars = 2000;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-gradient-to-br from-violet-500 via-primary to-fuchsia-500 text-white shadow">
          <Brain className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ideal Customer Profile</h1>
          <p className="text-sm text-muted-foreground">
            Describe who you sell to. The AI scorer uses this to tier every lead A/B/C/D against your fit criteria.
          </p>
        </div>
      </div>

      <section className="card-elevated p-5">
        <label htmlFor="icp" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Your ICP
        </label>
        <textarea
          id="icp"
          value={icp}
          onChange={(e) => setIcp(e.target.value.slice(0, maxChars))}
          rows={6}
          placeholder="Describe the role, company size, industry, geography, technology stack, and any other criteria that define a great-fit lead for you…"
          className="mt-2 w-full rounded-md border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {charCount.toLocaleString()} / {maxChars.toLocaleString()} characters
          </span>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-grad-brand px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saved ? 'Save changes' : 'Save ICP'}
          </button>
        </div>
      </section>

      {/* Inspiration */}
      <section>
        <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Example ICPs (tap to use)
        </div>
        <div className="grid gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setIcp(ex)}
              className="rounded-lg border bg-card p-3 text-left text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent/40"
            >
              {ex}
            </button>
          ))}
        </div>
      </section>

      {/* How it's used */}
      <section className="rounded-lg border bg-muted/30 p-4 text-xs text-muted-foreground">
        <h3 className="text-sm font-semibold text-foreground">How the AI scorer uses this</h3>
        <p className="mt-1">
          When you click <b>Run Intelligence</b> on a lead — or use the bulk action on selected leads —
          the platform runs company enrichment, intent-signal detection, and an LLM scoring pass.
          Your ICP is fed into the scorer's prompt so it grades leads against <em>your</em> definition
          of a good fit, not a generic one.
        </p>
        <p className="mt-2">
          The output is a 0-100 score, an A/B/C/D tier, 2-4 specific reasons, and up to 3 red flags.
        </p>
        <p className="mt-2 text-[11px]">
          Stored in your browser only. A workspace-level ICP that follows you across devices is on the roadmap.
        </p>
      </section>
    </div>
  );
}
