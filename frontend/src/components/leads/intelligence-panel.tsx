'use client';
import { useEffect, useState } from 'react';
import {
  X, Brain, Building2, TrendingUp, Mail, Globe, Github, Twitter, Linkedin,
  Sparkles, AlertTriangle, Loader2, ExternalLink, Activity, Award, Target, Flag,
  ThumbsUp, ThumbsDown, Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { useApi, ApiError } from '@/lib/client-api';

/**
 * Side-sheet that shows the full intelligence read-out for a single lead:
 *   • LLM-scored tier (A/B/C/D) + score + reasoning bullets
 *   • Firmographics (industry, employees, founded, funding, tech stack, social)
 *   • Recent intent signals (funding rounds, hiring, exec moves, etc.)
 *
 * Opens on demand from the Leads table row "Intelligence" button. The first
 * time it opens for a given lead we fire the full pipeline (~5-10s). After
 * that, the result is cached in component state until the user closes it.
 */
export interface IntelligencePanelProps {
  leadId: string | null;
  onClose: () => void;
}

interface Firmographics {
  domain: string;
  name?: string;
  description?: string;
  industry?: string;
  employeeRange?: string;
  foundedYear?: number;
  headquartersCity?: string;
  headquartersCountry?: string;
  linkedinUrl?: string;
  twitterUrl?: string;
  githubUrl?: string;
  crunchbaseUrl?: string;
  technologies: string[];
  totalFundingUSD?: number;
  hasSpf: boolean;
  hasDmarc: boolean;
  sources: string[];
}

interface IntentSignal {
  kind: 'FUNDING' | 'HIRING' | 'EXEC_CHANGE' | 'PRODUCT_LAUNCH' | 'TECH_ADOPTION' | 'EXPANSION';
  headline: string;
  url: string;
  detectedAt: string;
  confidence: number;
}

interface IntelligenceResult {
  leadId: string;
  firmographics?: Firmographics;
  intentSignals: IntentSignal[];
  intentScore: number;
  leadScore: number;
  leadTier: 'A' | 'B' | 'C' | 'D';
  reasons: string[];
  redFlags: string[];
  duplicateOfLeadId?: string;
}

const TIER_COLORS: Record<string, string> = {
  A: 'bg-emerald-500/15 text-emerald-600 ring-emerald-500/40',
  B: 'bg-blue-500/15 text-blue-600 ring-blue-500/40',
  C: 'bg-amber-500/15 text-amber-600 ring-amber-500/40',
  D: 'bg-rose-500/15 text-rose-600 ring-rose-500/40',
};

const KIND_META: Record<IntentSignal['kind'], { label: string; color: string; icon: any }> = {
  FUNDING:        { label: 'Funding',         color: 'bg-emerald-500/10 text-emerald-600',   icon: TrendingUp },
  EXEC_CHANGE:    { label: 'Exec change',     color: 'bg-violet-500/10 text-violet-600',     icon: Award },
  HIRING:         { label: 'Hiring',          color: 'bg-blue-500/10 text-blue-600',         icon: Activity },
  PRODUCT_LAUNCH: { label: 'Product launch',  color: 'bg-amber-500/10 text-amber-600',       icon: Sparkles },
  TECH_ADOPTION:  { label: 'Tech adoption',   color: 'bg-cyan-500/10 text-cyan-600',         icon: Brain },
  EXPANSION:      { label: 'Expansion',       color: 'bg-pink-500/10 text-pink-600',         icon: Target },
};

export function IntelligencePanel({ leadId, onClose }: IntelligencePanelProps) {
  const api = useApi();
  const [result, setResult] = useState<IntelligenceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [icpDescription, setIcpDescription] = useState<string>('');

  // Load saved ICP from localStorage so the user doesn't re-type it every time
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIcpDescription(localStorage.getItem('leadforge:icp_description') ?? '');
  }, []);

  // Run the full pipeline when the panel opens for a new lead
  useEffect(() => {
    if (!leadId) { setResult(null); setError(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.post<IntelligenceResult>('/intelligence/score', {
          leadId,
          ...(icpDescription.trim() ? { icpDescription: icpDescription.trim() } : {}),
        });
        if (!cancelled) setResult(res);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Intelligence pipeline failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [leadId, icpDescription]);

  if (!leadId) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden />
      {/* Sheet */}
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col overflow-hidden border-l bg-background shadow-2xl animate-in slide-in-from-right duration-200"
        role="dialog"
        aria-modal="true"
        aria-label="Lead intelligence"
      >
        <header className="flex shrink-0 items-center justify-between border-b bg-gradient-to-r from-primary/10 via-violet-500/5 to-transparent px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-violet-500 via-primary to-fuchsia-500 text-white shadow-md">
              <Brain className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Lead Intelligence</h2>
              <p className="text-xs text-muted-foreground">Firmographics · intent · AI scoring</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {loading && (
            <div className="grid place-items-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">Running enrichment + intent + scoring…</p>
              <p className="text-[11px]">This can take 8-15 seconds the first time.</p>
            </div>
          )}

          {error && !loading && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-700">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" /> Pipeline error
              </div>
              <p className="mt-1 text-xs">{error}</p>
            </div>
          )}

          {result && !loading && (
            <div className="space-y-6">
              {/* AI score + tier */}
              <section className="rounded-xl border bg-gradient-to-br from-primary/5 via-card to-card p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">AI Score</div>
                    <div className="mt-1 flex items-baseline gap-3">
                      <span className="text-4xl font-bold tabular-nums">{result.leadScore}</span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${TIER_COLORS[result.leadTier]}`}>
                        Tier {result.leadTier}
                      </span>
                    </div>
                  </div>
                  {result.intentScore > 0 && (
                    <div className="text-right">
                      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Intent</div>
                      <div className="mt-1 text-3xl font-bold tabular-nums text-amber-600">{result.intentScore}</div>
                    </div>
                  )}
                </div>

                {result.reasons.length > 0 && (
                  <ul className="mt-4 space-y-1.5">
                    {result.reasons.map((r, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {result.redFlags.length > 0 && (
                  <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/5 p-2.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-rose-600">
                      <Flag className="h-3 w-3" /> Red flags
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {result.redFlags.map((f, i) => (
                        <li key={i} className="text-xs text-rose-700">• {f}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.duplicateOfLeadId && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>This may be a duplicate of an existing lead in your workspace.</span>
                  </div>
                )}

                {/* Feedback bar — teaches the future ML model. Captures the
                    user's reaction to this score paired with the feature
                    vector the scorer saw. */}
                <FeedbackBar leadId={leadId!} />
              </section>

              {/* Firmographics */}
              {result.firmographics && (
                <section>
                  <SectionHeader icon={Building2} title="Company" subtitle={result.firmographics.domain} />
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Industry" value={result.firmographics.industry} />
                    <Field label="Employees" value={result.firmographics.employeeRange} />
                    <Field label="Founded" value={result.firmographics.foundedYear?.toString()} />
                    <Field label="HQ" value={[result.firmographics.headquartersCity, result.firmographics.headquartersCountry].filter(Boolean).join(', ')} />
                    {result.firmographics.totalFundingUSD && (
                      <Field label="Total funding" value={`$${result.firmographics.totalFundingUSD.toLocaleString()}`} />
                    )}
                    <Field
                      label="Email auth"
                      value={
                        (result.firmographics.hasSpf || result.firmographics.hasDmarc)
                          ? [
                              result.firmographics.hasSpf ? 'SPF' : null,
                              result.firmographics.hasDmarc ? 'DMARC' : null,
                            ].filter(Boolean).join(' + ')
                          : 'none'
                      }
                    />
                  </div>

                  {result.firmographics.description && (
                    <p className="mt-3 text-xs text-muted-foreground italic">"{result.firmographics.description}"</p>
                  )}

                  {result.firmographics.technologies.length > 0 && (
                    <div className="mt-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tech stack</div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {result.firmographics.technologies.map((t) => (
                          <span key={t} className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium">{t}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {result.firmographics.linkedinUrl && (
                      <SocialLink href={result.firmographics.linkedinUrl} icon={Linkedin} label="LinkedIn" />
                    )}
                    {result.firmographics.twitterUrl && (
                      <SocialLink href={result.firmographics.twitterUrl} icon={Twitter} label="Twitter" />
                    )}
                    {result.firmographics.githubUrl && (
                      <SocialLink href={result.firmographics.githubUrl} icon={Github} label="GitHub" />
                    )}
                    {result.firmographics.crunchbaseUrl && (
                      <SocialLink href={result.firmographics.crunchbaseUrl} icon={Globe} label="Crunchbase" />
                    )}
                  </div>

                  {result.firmographics.sources.length > 0 && (
                    <p className="mt-3 text-[10px] text-muted-foreground">
                      sources: {result.firmographics.sources.join(', ')}
                    </p>
                  )}
                </section>
              )}

              {/* Intent signals */}
              {result.intentSignals.length > 0 && (
                <section>
                  <SectionHeader icon={Activity} title="Recent intent signals" subtitle={`${result.intentSignals.length} found`} />
                  <ul className="mt-3 space-y-2">
                    {result.intentSignals.slice(0, 10).map((s, i) => {
                      const meta = KIND_META[s.kind];
                      const Icon = meta.icon;
                      return (
                        <li key={i} className="rounded-lg border bg-card p-3">
                          <div className="flex items-start gap-2">
                            <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${meta.color}`}>
                              <Icon className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${meta.color}`}>
                                  {meta.label}
                                </span>
                                <span className="text-[10px] text-muted-foreground tabular-nums">
                                  confidence {Math.round(s.confidence * 100)}%
                                </span>
                              </div>
                              <a
                                href={s.url}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 line-clamp-2 block text-xs hover:text-primary hover:underline"
                              >
                                {s.headline}
                                <ExternalLink className="ml-1 inline h-2.5 w-2.5 opacity-60" />
                              </a>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {/* ICP description input — saved to localStorage, applied on next score */}
              <section className="rounded-lg border border-dashed bg-muted/30 p-4">
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Your ICP (improves scoring accuracy)
                </label>
                <textarea
                  value={icpDescription}
                  onChange={(e) => setIcpDescription(e.target.value)}
                  onBlur={() => localStorage.setItem('leadforge:icp_description', icpDescription)}
                  rows={2}
                  placeholder="e.g. VPs of Marketing at B2B SaaS companies with 50-500 employees"
                  className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-xs"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Saved locally. Re-scoring will use this on the next run.
                </p>
              </section>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-border/40 pb-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="text-sm font-semibold">{title}</span>
      {subtitle && <span className="text-[10px] text-muted-foreground">{subtitle}</span>}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | undefined | null }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm">{value || <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}

function SocialLink({ href, icon: Icon, label }: { href: string; icon: any; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-xs hover:bg-accent"
    >
      <Icon className="h-3 w-3" />
      <span>{label}</span>
      <ExternalLink className="h-2.5 w-2.5 opacity-60" />
    </a>
  );
}

// ─── Score-feedback bar ────────────────────────────────────────────────────
//
// Captures user labels paired with the feature vector the scorer saw, so the
// future XGBoost retraining has clean ground-truth data. Quick paths (thumbs)
// land immediately; the "Wrong because…" path opens a quick category picker
// so users can give richer feedback in one tap.

type FeedbackKind =
  | 'HELPFUL' | 'NOT_HELPFUL'
  | 'WRONG_INDUSTRY' | 'WRONG_ROLE'
  | 'TOO_SMALL' | 'TOO_BIG'
  | 'ALREADY_CUSTOMER' | 'BAD_FIT'
  | 'REPLIED_POSITIVELY' | 'REPLIED_NEGATIVELY' | 'IGNORED';

const DETAILED_REASONS: Array<{ kind: FeedbackKind; label: string }> = [
  { kind: 'WRONG_INDUSTRY',  label: 'Wrong industry' },
  { kind: 'WRONG_ROLE',      label: 'Wrong role' },
  { kind: 'TOO_SMALL',       label: 'Company too small' },
  { kind: 'TOO_BIG',         label: 'Company too big' },
  { kind: 'ALREADY_CUSTOMER',label: 'Already a customer' },
  { kind: 'BAD_FIT',         label: 'Bad fit overall' },
];

function FeedbackBar({ leadId }: { leadId: string }) {
  // Local-only "I voted" memory — no extra round-trip just to show the check.
  // The backend stores the full history; this is just optimistic UI.
  const [sent, setSent] = useState<FeedbackKind | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const api = useApi();

  async function submit(kind: FeedbackKind) {
    try {
      await api.post('/intelligence/feedback', { leadId, kind });
      setSent(kind);
      setShowWhy(false);
    } catch {
      // The shared API client already toasts on 429; for everything else we
      // stay quiet — failed feedback isn't worth interrupting the user.
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-dashed bg-muted/30 p-3">
      {sent ? (
        <div className="flex items-center justify-center gap-2 text-xs font-medium text-emerald-700">
          <Check className="h-4 w-4" />
          Thanks — your label is in the training set
        </div>
      ) : showWhy ? (
        <div>
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            What's off about this lead?
          </div>
          <div className="flex flex-wrap gap-1">
            {DETAILED_REASONS.map((r) => (
              <button
                key={r.kind}
                onClick={() => submit(r.kind)}
                className="rounded-full border bg-card px-2 py-0.5 text-[11px] hover:border-primary/40 hover:bg-accent"
              >
                {r.label}
              </button>
            ))}
            <button
              onClick={() => setShowWhy(false)}
              className="rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">
            How accurate is this score?
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => submit('HELPFUL')}
              className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs hover:border-emerald-500/40 hover:bg-emerald-500/5 hover:text-emerald-700"
              title="Spot on"
            >
              <ThumbsUp className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Spot on</span>
            </button>
            <button
              onClick={() => setShowWhy(true)}
              className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs hover:border-rose-500/40 hover:bg-rose-500/5 hover:text-rose-700"
              title="Wrong, here's why…"
            >
              <ThumbsDown className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Off</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
