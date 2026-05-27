'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { Send, Sparkles, Loader2, Wrench, CheckCircle2, XCircle, ExternalLink, Cpu, ChevronDown, AlertCircle, Zap, Trash2 } from 'lucide-react';
import { useApi } from '@/lib/client-api';

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'meta' | 'error';
  text?: string;
  id?: string;
  name?: string;
  input?: any;
  result?: any;
  ok?: boolean;
  error?: string;
  meta?: { routed_to?: string; reason?: string; fallback?: string; degraded?: boolean; hint?: string };
}

export interface Message {
  role: 'user' | 'assistant';
  blocks: ContentBlock[];
}

interface ModelOption {
  id: string;
  family: string;
  label: string;
  tag?: string;
}

interface AssistantChatProps {
  variant?: 'full' | 'compact';
  headerExtra?: React.ReactNode;
  persistKey?: string;
  /** When true, the chat's built-in header (brand + model picker) is suppressed.
   *  Used by the mobile widget which renders its own prominent header outside. */
  hideInternalHeader?: boolean;
}

const DEFAULT_SUGGESTIONS = [
  'How many credits do I have left?',
  'Show me my last 3 jobs',
  'Verify hello@stripe.com',
  'Guess the email for Patrick Collison at stripe.com',
];

const MODEL_STORAGE_KEY = 'leadforge_assistant_model';
const MODEL_PROVIDER_KEY = 'leadforge_assistant_model_provider';

// User-facing labels for tools. NEVER show the raw tool name to the user.
const TOOL_LABELS: Record<string, { running: string; done: string; failed: string }> = {
  create_extraction_job:    { running: 'Starting extraction…',         done: 'Extraction queued',           failed: "Couldn't start that extraction" },
  get_job_status:           { running: 'Checking job status…',         done: 'Got the latest job status',   failed: 'No job matched that name' },
  list_recent_jobs:         { running: 'Loading recent jobs…',         done: 'Here are your recent jobs',   failed: "Couldn't load jobs right now" },
  search_leads:             { running: 'Searching your leads…',        done: 'Search complete',             failed: 'Search failed' },
  verify_email:             { running: 'Verifying email…',             done: 'Verification complete',       failed: "Couldn't verify that email" },
  bulk_verify_unverified:   { running: 'Queuing verification…',        done: 'Verification queued',         failed: "Couldn't queue verification" },
  create_export:            { running: 'Preparing export…',            done: 'Export ready shortly',        failed: "Couldn't start the export" },
  get_team_usage:           { running: 'Checking your account…',       done: 'Account summary',             failed: "Couldn't load your account" },
  push_to_hubspot:          { running: 'Syncing to HubSpot…',          done: 'Synced to HubSpot',           failed: 'HubSpot sync failed' },
  web_search:               { running: 'Searching the web…',           done: 'Search results',              failed: 'Search unavailable right now' },
  guess_emails:             { running: 'Generating email patterns…',   done: 'Pattern guesses',             failed: "Couldn't guess that email" },
  write_cold_email:         { running: 'Drafting your email…',         done: 'Draft ready',                 failed: "Couldn't draft that email" },
  generate_icebreaker:      { running: 'Generating opener…',           done: 'Opener ready',                failed: "Couldn't generate opener" },
  add_leads_to_list:        { running: 'Adding to list…',              done: 'Added to your list',          failed: "Couldn't add to list" },
};

function labelForTool(name: string, state: 'running' | 'done' | 'failed'): string {
  const entry = TOOL_LABELS[name];
  if (entry) return entry[state];
  // Generic fallback — never leak the raw tool name
  if (state === 'running') return 'Working on that…';
  if (state === 'failed') return "That didn't work";
  return 'Done';
}

export function AssistantChat({ variant = 'full', headerExtra, persistKey, hideInternalHeader = false }: AssistantChatProps) {
  const { getToken } = useAuth();
  const api = useApi();

  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window === 'undefined' || !persistKey) return [];
    try {
      const raw = localStorage.getItem(persistKey);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<{ name: string; model: string | null } | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null); // null = Auto
  const [showModelMenu, setShowModelMenu] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Load provider + model list, then validate any stored selection
  useEffect(() => {
    Promise.all([
      api.get<{ provider: { name: string; model: string | null } }>('/assistant/status'),
      api.get<{ provider: string; models: ModelOption[] }>('/assistant/models'),
    ])
      .then(([s, m]) => {
        setProvider(s.provider);
        setModels(m.models);
        try {
          const storedProvider = localStorage.getItem(MODEL_PROVIDER_KEY);
          const storedModel = localStorage.getItem(MODEL_STORAGE_KEY);
          if (storedProvider === s.provider.name && storedModel && m.models.some((x) => x.id === storedModel)) {
            setSelectedModel(storedModel);
          } else {
            localStorage.removeItem(MODEL_STORAGE_KEY);
            localStorage.removeItem(MODEL_PROVIDER_KEY);
            setSelectedModel(null);
          }
        } catch {}
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!persistKey) return;
    try { localStorage.setItem(persistKey, JSON.stringify(messages)); } catch {}
  }, [messages, persistKey]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => {
    if (!showModelMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowModelMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showModelMenu]);

  const handlePickModel = (id: string | null) => {
    setSelectedModel(id);
    setShowModelMenu(false);
    if (typeof window === 'undefined') return;
    if (id && provider) {
      localStorage.setItem(MODEL_STORAGE_KEY, id);
      localStorage.setItem(MODEL_PROVIDER_KEY, provider.name);
    } else {
      localStorage.removeItem(MODEL_STORAGE_KEY);
      localStorage.removeItem(MODEL_PROVIDER_KEY);
    }
  };

  function clearChat() {
    setMessages([]);
    if (persistKey) try { localStorage.removeItem(persistKey); } catch {}
  }

  const send = useCallback(
    async (text?: string) => {
      const userText = (text ?? input).trim();
      if (!userText || busy) return;
      setInput('');
      setBusy(true);

      const history = [...messages, { role: 'user' as const, blocks: [{ type: 'text' as const, text: userText }] }];
      setMessages(history);

      const wire = history.map((m) => ({
        role: m.role,
        content:
          m.role === 'user' && m.blocks.every((b) => b.type === 'text')
            ? m.blocks.map((b) => b.text ?? '').join('\n')
            : m.blocks
                .filter((b) => b.type === 'text' || b.type === 'tool_use' || b.type === 'tool_result')
                .map((b) => {
                  if (b.type === 'text') return { type: 'text', text: b.text };
                  if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
                  return { type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(b.result ?? b.error ?? ''), is_error: !b.ok };
                }),
      }));

      let assistantBlocks: ContentBlock[] = [];
      const flushAssistant = () =>
        setMessages((m) => [...m.filter((_, i) => i < history.length), { role: 'assistant', blocks: [...assistantBlocks] }]);

      try {
        const token = await getToken();
        const body: any = { messages: wire };
        if (selectedModel) body.model = selectedModel; // explicit override; otherwise backend auto-routes

        const res = await fetch('/api/backend/assistant/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        if (!res.ok || !res.body) {
          assistantBlocks.push({ type: 'error', error: 'The AI is unreachable right now. Please try again.' });
          flushAssistant();
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const events = buf.split('\n\n');
          buf = events.pop() ?? '';
          for (const e of events) {
            const line = e.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue;
            try {
              const evt = JSON.parse(line.slice(5).trim());
              if (evt.type === 'text') {
                const last = assistantBlocks[assistantBlocks.length - 1];
                if (last && last.type === 'text') last.text = (last.text ?? '') + evt.data;
                else assistantBlocks.push({ type: 'text', text: evt.data });
                flushAssistant();
              } else if (evt.type === 'tool_use') {
                assistantBlocks.push({ type: 'tool_use', id: evt.data.id, name: evt.data.name, input: evt.data.input });
                flushAssistant();
              } else if (evt.type === 'tool_result') {
                const block = assistantBlocks.find((b) => b.type === 'tool_use' && b.id === evt.data.id);
                if (block) {
                  block.result = evt.data.result;
                  block.ok = evt.data.ok;
                  block.error = evt.data.error;
                }
                flushAssistant();
              } else if (evt.type === 'meta') {
                assistantBlocks.push({ type: 'meta', meta: evt.data });
                flushAssistant();
              } else if (evt.type === 'error') {
                assistantBlocks.push({ type: 'error', error: typeof evt.data === 'string' ? evt.data : 'Something went wrong. Please try again.' });
                flushAssistant();
              }
            } catch { /* skip non-JSON */ }
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [getToken, input, busy, messages, selectedModel],
  );

  const activeModelLabel = selectedModel
    ? models.find((m) => m.id === selectedModel)?.label ?? selectedModel.split('/').pop()
    : 'Auto';

  return (
    <div className="flex h-full flex-col">
      {/* Header — suppressed in the mobile widget (it renders its own bigger header) */}
      {!hideInternalHeader && (
      <div className="flex items-center justify-between border-b border-border/60 bg-gradient-to-r from-primary/5 to-transparent px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Sparkles className="h-4 w-4 text-primary" />
            <div className="absolute -inset-1 -z-10 rounded-full bg-primary/20 blur-sm" />
          </div>
          <span className="text-sm font-semibold">AI Assistant</span>
          {provider?.name === 'groq' && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-600">
              <Zap className="h-2.5 w-2.5" /> Groq
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Clear chat"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Model picker */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setShowModelMenu((s) => !s)}
              className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-[10px] font-medium hover:bg-accent"
              title="Choose model (or Auto)"
            >
              <Cpu className="h-3 w-3" />
              <span className="max-w-[140px] truncate">{activeModelLabel}</span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
            {showModelMenu && (
              <div className="absolute right-0 top-full z-[100] mt-1 w-72 overflow-hidden rounded-lg border bg-background shadow-2xl ring-1 ring-border/50 dark:bg-card">
                <button
                  onClick={() => handlePickModel(null)}
                  className={`block w-full px-3 py-2 text-left text-xs hover:bg-accent ${!selectedModel ? 'bg-primary/10' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="h-3 w-3 text-primary" />
                      <span className="font-semibold">Auto (recommended)</span>
                    </div>
                    {!selectedModel && <CheckCircle2 className="h-3 w-3 text-primary" />}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    Picks the best model for each task — fastest for Q&A, smartest for reasoning.
                  </div>
                </button>
                <div className="border-t border-border/60 bg-muted/30 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Or pick a specific model
                </div>
                <div className="max-h-72 overflow-y-auto p-1">
                  {models.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => handlePickModel(m.id)}
                      className={`block w-full rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-accent ${
                        selectedModel === m.id ? 'bg-primary/10' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{m.label}</span>
                        <div className="flex shrink-0 items-center gap-1">
                          {m.tag && (
                            <span className="rounded bg-primary/15 px-1 py-0.5 text-[9px] font-semibold text-primary">{m.tag}</span>
                          )}
                          <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] text-emerald-600">free</span>
                          {selectedModel === m.id && <CheckCircle2 className="h-3 w-3 text-primary" />}
                        </div>
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">{m.family}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {headerExtra}
        </div>
      </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 ? (
          <div className={`mx-auto ${variant === 'compact' ? 'pt-4' : 'pt-8'} text-center`}>
            <div className="mx-auto inline-flex items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 p-3">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <h2 className="mt-3 text-sm font-semibold">How can I help today?</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Run extractions, verify emails, search leads, push to CRM, draft cold emails — just ask.
            </p>
            <div className="mt-4 grid gap-1.5">
              {DEFAULT_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-md border bg-background px-3 py-1.5 text-left text-xs hover:bg-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => <MessageView key={i} msg={m} compact={variant === 'compact'} />)
        )}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        className="flex gap-2 border-t border-border/60 bg-card/50 p-3"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={variant === 'compact' ? 1 : 2}
          placeholder="Ask anything… (Shift+Enter for newline)"
          className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-md bg-grad-brand px-3 text-white hover:opacity-90 disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

function MessageView({ msg, compact = false }: { msg: Message; compact?: boolean }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`${isUser ? 'max-w-[80%]' : compact ? 'w-full' : 'max-w-[85%] w-full'} space-y-2`}>
        {msg.blocks.map((b, i) => {
          if (b.type === 'text') {
            return (
              <div
                key={i}
                className={`rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                  isUser
                    ? 'bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-sm'
                    : 'bg-muted/50 ring-1 ring-border/50'
                }`}
              >
                {b.text}
              </div>
            );
          }
          if (b.type === 'meta') {
            const m = b.meta ?? {};
            const label = m.routed_to
              ? `Routed to ${m.routed_to.split('/').pop()?.replace(':free', '')}${m.reason ? ` — ${m.reason}` : ''}`
              : m.fallback
                ? `Switched to ${m.fallback}${m.reason ? ` (${m.reason})` : ''}`
                : m.hint ?? '';
            if (!label) return null;
            return (
              <div key={i} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground">
                <Zap className="h-2.5 w-2.5" />
                {label}
              </div>
            );
          }
          if (b.type === 'error') {
            return (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span className="text-amber-700 dark:text-amber-300">{b.error}</span>
              </div>
            );
          }
          if (b.type === 'tool_use') {
            const state = b.ok === undefined ? 'running' : b.ok ? 'done' : 'failed';
            const label = labelForTool(b.name!, state);
            return (
              <div key={i} className="rounded-lg border bg-card/80 p-2.5 text-xs">
                <div className="flex items-center gap-2">
                  {state === 'running' ? (
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  ) : state === 'done' ? (
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  ) : (
                    <AlertCircle className="h-3 w-3 text-amber-500" />
                  )}
                  <span className="text-[11px] font-medium">{label}</span>
                </div>
                {b.ok === true && b.result !== undefined && <ToolResult name={b.name!} result={b.result} compact={compact} />}
                {b.ok === false && (
                  <div className="mt-1.5 text-[11px] text-muted-foreground">Try rephrasing that — I'll get it next time.</div>
                )}
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

function ToolResult({ name, result, compact }: { name: string; result: any; compact: boolean }) {
  if (name === 'create_extraction_job' && result?.job_id) {
    return (
      <Link
        href={`/jobs/${result.job_id}`}
        className="mt-1.5 flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1.5 text-[11px] text-primary hover:bg-primary/15"
      >
        <ExternalLink className="h-3 w-3" /> Open job {result.job_id.slice(-8)} ({result.status})
      </Link>
    );
  }
  if (name === 'search_leads' && Array.isArray(result?.leads)) {
    return (
      <div className="mt-1.5 max-h-[200px] overflow-y-auto rounded border">
        <table className="w-full text-[10px]">
          <thead className="sticky top-0 bg-muted/40 text-left">
            <tr><th className="p-1">Email</th><th>Name</th><th>Score</th></tr>
          </thead>
          <tbody>
            {result.leads.slice(0, 20).map((l: any) => (
              <tr key={l.id} className="border-t">
                <td className="p-1 font-mono">{l.email}</td>
                <td className="max-w-[90px] truncate">{l.fullName ?? '—'}</td>
                <td>{l.qualityScore ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t bg-muted/30 px-2 py-1 text-[9px] text-muted-foreground">
          {Math.min(result.leads.length, 20)} of {result.total}
        </div>
      </div>
    );
  }
  if (name === 'verify_email') {
    const color = result.status === 'VALID' ? 'emerald' : result.status === 'INVALID' ? 'rose' : 'amber';
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md bg-muted/40 p-1.5 text-[10px]">
        <span className={`rounded-full px-1.5 py-0.5 bg-${color}-500/10 text-${color}-600`}>{result.status}</span>
        <span className="font-mono">{result.email}</span>
        <span className="text-muted-foreground">score {result.score} · {result.reason}</span>
      </div>
    );
  }
  if (name === 'list_recent_jobs' && Array.isArray(result?.jobs)) {
    return (
      <ul className="mt-1.5 space-y-1 text-[11px]">
        {result.jobs.slice(0, 5).map((j: any) => (
          <li key={j.id} className="flex justify-between gap-2 rounded border bg-background p-1.5">
            <Link href={`/jobs/${j.id}`} className="truncate hover:underline">{j.name}</Link>
            <span className="whitespace-nowrap text-muted-foreground">{j.status} · {j.leadsFound}/{j.targetLeads}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (name === 'get_team_usage' && result?.workspace) {
    return (
      <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-[10px]">
        <Pill label="Workspace" value={result.workspace} />
        <Pill label="Plan" value={result.plan} />
        <Pill label="Credits" value={`${result.credits_used} / ${result.credits_total}`} />
        <Pill label="Remaining" value={result.credits_remaining} />
        <Pill label="Leads" value={result.total_leads} />
        <Pill label="Jobs" value={result.total_jobs} />
      </div>
    );
  }
  return null; // hide raw JSON entirely — no more <details>/<pre> dumps
}

function Pill({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-md border bg-background px-2 py-1">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xs font-bold tabular-nums">{value}</div>
    </div>
  );
}
