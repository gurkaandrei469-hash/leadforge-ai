'use client';
import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Mail, Plus, Trash2, Send, Loader2, CheckCircle2, XCircle, AtSign, Inbox, ShieldCheck, ExternalLink, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useApi, ApiError } from '@/lib/client-api';
import { PROVIDER_PRESETS, detectProviderFromEmail, type ProviderPreset } from '@/lib/email-provider-presets';

interface SendingAccount {
  id: string;
  provider: 'SMTP' | 'SENDGRID' | 'SES' | 'GMAIL_OAUTH' | 'MICROSOFT_OAUTH';
  name: string;
  fromName: string;
  fromEmail: string;
  smtpHost?: string;
  smtpPort?: number;
  imapHost?: string | null;
  imapPort?: number | null;
  imapUser?: string | null;
  imapSecure?: boolean;
  imapEnabled?: boolean;
  imapConfigured?: boolean;
  lastImapPollAt?: string | null;
  dailyLimit: number;
  sentToday: number;
  isActive: boolean;
  hasSecret: boolean;
  createdAt: string;
}

const PROVIDER_COLORS: Record<string, string> = {
  SMTP:            'from-blue-500/20 to-blue-500/0 text-blue-500',
  SENDGRID:        'from-sky-500/20 to-sky-500/0 text-sky-500',
  SES:             'from-amber-500/20 to-amber-500/0 text-amber-500',
  GMAIL_OAUTH:     'from-rose-500/20 to-rose-500/0 text-rose-500',
  MICROSOFT_OAUTH: 'from-blue-500/20 to-cyan-500/0 text-blue-500',
};

export default function SendingAccountsPage() {
  const api = useApi();
  const search = useSearchParams();
  const router = useRouter();
  const [accounts, setAccounts] = useState<SendingAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState<'SMTP' | 'SENDGRID' | 'SES' | null>(null);
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [connectingMicrosoft, setConnectingMicrosoft] = useState(false);
  const [pickerProvider, setPickerProvider] = useState<string | null>(null); // SMTP-preset id

  // When user picks a provider preset (Outlook / Yahoo / iCloud / etc.), pre-fill
  // every host/port/secure field so they only have to enter email + app password.
  const activePreset: ProviderPreset | null = pickerProvider
    ? PROVIDER_PRESETS.find((p) => p.id === pickerProvider) ?? null
    : null;

  useEffect(() => {
    if (!activePreset || showAdd !== 'SMTP') return;
    setSmtpHost(activePreset.smtpHost);
    setSmtpPort(activePreset.smtpPort);
    setSmtpSecure(activePreset.smtpSecure);
    if (activePreset.imapHost) {
      setImapEnabled(true);
      setImapHost(activePreset.imapHost);
      setImapPort(activePreset.imapPort);
      setImapSecure(activePreset.imapSecure);
    }
    if (!name) setName(activePreset.name);
  }, [activePreset?.id, showAdd]);

  // Core form state
  const [name, setName] = useState('');
  const [fromName, setFromName] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [dailyLimit, setDailyLimit] = useState(50);
  // IMAP form state
  const [imapEnabled, setImapEnabled] = useState(false);
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState(993);
  const [imapUser, setImapUser] = useState('');
  const [imapPass, setImapPass] = useState('');
  const [imapSecure, setImapSecure] = useState(true);

  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const res = await api.get<{ accounts: SendingAccount[] }>('/sending-accounts');
      setAccounts(res.accounts);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  // Handle OAuth callback redirects from BOTH Gmail and Microsoft flows
  useEffect(() => {
    const gmail = search.get('gmail');
    const microsoft = search.get('microsoft');
    if (!gmail && !microsoft) return;

    if (gmail === 'connected') {
      const email = search.get('email');
      toast.success(`Gmail connected${email ? ` — ${email}` : ''}. Reply detection is on.`);
      load();
    } else if (gmail === 'no_refresh_token') {
      toast.error('Google didn\'t return a refresh token. Revoke this app at myaccount.google.com/permissions and try again.');
    } else if (gmail === 'missing_scope') {
      toast.error(
        'Gmail connection failed — you didn\'t grant the "Send mail" permission. On the consent screen, tick EVERY checkbox (especially "Read, compose, send..."). Try again.',
        { duration: 10000 },
      );
    } else if (gmail === 'invalid_state') {
      toast.error('The OAuth session expired. Please try connecting again.');
    } else if (gmail === 'error') {
      toast.error(`Google sign-in failed: ${search.get('msg') ?? 'unknown error'}`);
    }

    if (microsoft === 'connected') {
      const email = search.get('email');
      toast.success(`Outlook connected${email ? ` — ${email}` : ''}. Reply detection is on.`);
      load();
    } else if (microsoft === 'no_refresh_token') {
      toast.error('Microsoft didn\'t return a refresh token. Remove this app at account.live.com/consent/Manage and reconnect.');
    } else if (microsoft === 'missing_scope') {
      toast.error(
        'Outlook connection failed — the "Send mail" permission wasn\'t granted. Reconnect and approve every requested permission.',
        { duration: 10000 },
      );
    } else if (microsoft === 'invalid_state') {
      toast.error('The OAuth session expired. Please try connecting again.');
    } else if (microsoft === 'error') {
      toast.error(`Microsoft sign-in failed: ${search.get('msg') ?? 'unknown error'}`);
    }

    router.replace('/settings/sending-accounts');
  }, [search]);

  function resetForm() {
    setName(''); setFromName(''); setFromEmail('');
    setSmtpHost(''); setSmtpPort(587); setSmtpUser(''); setSmtpPass(''); setSmtpSecure(false);
    setApiKey(''); setDailyLimit(50);
    setImapEnabled(false); setImapHost(''); setImapPort(993); setImapUser(''); setImapPass(''); setImapSecure(true);
  }

  // Auto-populate IMAP fields with sensible defaults when SMTP user changes
  function autoFillImapForProvider(host: string, user: string) {
    if (!imapHost && /gmail/.test(host)) { setImapHost('imap.gmail.com'); setImapPort(993); }
    if (!imapHost && /outlook|office365|hotmail/.test(host)) { setImapHost('outlook.office365.com'); setImapPort(993); }
    if (!imapUser && user) setImapUser(user);
  }

  async function create() {
    if (!showAdd) return;
    if (!name.trim() || !fromName.trim() || !fromEmail.trim()) {
      return toast.error('Name, from name, and from email are required');
    }
    setCreating(true);
    try {
      const body: any = {
        provider: showAdd,
        name: name.trim(),
        fromName: fromName.trim(),
        fromEmail: fromEmail.trim(),
        dailyLimit,
        imapEnabled,
        imapSecure,
      };
      if (showAdd === 'SMTP') {
        if (!smtpHost || !smtpUser || !smtpPass) { setCreating(false); return toast.error('Fill out all SMTP fields'); }
        Object.assign(body, { smtpHost, smtpPort, smtpUser, smtpPass, smtpSecure });
      } else {
        if (!apiKey) { setCreating(false); return toast.error('API key required'); }
        body.apiKey = apiKey;
      }
      if (imapEnabled) {
        if (!imapHost || !imapUser || !imapPass) { setCreating(false); return toast.error('Fill out IMAP host, user, and password'); }
        Object.assign(body, { imapHost, imapPort, imapUser, imapPass });
      }

      await api.post('/sending-accounts', body);
      toast.success(`${showAdd} account added`);
      resetForm();
      setShowAdd(null);
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to add');
    } finally { setCreating(false); }
  }

  async function connectGmail() {
    setConnectingGmail(true);
    try {
      const res = await api.get<{ authUrl: string; error?: string }>('/sending-accounts/gmail/start');
      if (res.authUrl) window.location.href = res.authUrl;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Gmail sign-in unavailable. The server hasn\'t been configured with Google OAuth credentials yet.');
    } finally { setConnectingGmail(false); }
  }

  async function connectMicrosoft() {
    setConnectingMicrosoft(true);
    try {
      const res = await api.get<{ authUrl: string; error?: string }>('/sending-accounts/microsoft/start');
      if (res.authUrl) {
        window.location.href = res.authUrl;
      } else {
        // OAuth not configured on the server — gracefully fall back to the SMTP+App-Password
        // flow with the Outlook preset auto-applied. Same end-result, zero extra setup needed.
        toast.info('Using Outlook via app password instead — quicker for personal accounts.');
        setPickerProvider('outlook');
        setShowAdd('SMTP');
      }
    } catch (e) {
      // 400 from the server means Microsoft OAuth env vars aren't set → take the app-password path
      if (e instanceof ApiError && e.status === 400) {
        toast.info('Using Outlook via app password instead — quicker for personal accounts.');
        setPickerProvider('outlook');
        setShowAdd('SMTP');
      } else {
        toast.error(e instanceof ApiError ? e.message : 'Outlook sign-in failed.');
      }
    } finally { setConnectingMicrosoft(false); }
  }

  async function test(id: string) {
    setTesting(id);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(`/sending-accounts/${id}/test`, {});
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    } finally { setTesting(null); }
  }

  async function testImap(id: string) {
    setTesting(id + '-imap');
    try {
      const res = await api.post<{ ok: boolean; message: string }>(`/sending-accounts/${id}/test-imap`, {});
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    } finally { setTesting(null); }
  }

  async function toggleImap(id: string, enabled: boolean) {
    try {
      await api.patch(`/sending-accounts/${id}/imap`, { imapEnabled: enabled });
      toast.success(enabled ? 'Reply detection enabled' : 'Reply detection paused');
      load();
    } catch (e: any) { toast.error(e.message ?? 'Failed to update'); }
  }

  async function remove(id: string) {
    if (!confirm('Remove this sending account? Active campaigns using it will pause.')) return;
    try {
      await api.del(`/sending-accounts/${id}`);
      toast.success('Account removed');
      load();
    } catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Sending Accounts</h1>
        <p className="mt-1 text-xs sm:text-sm text-muted-foreground">Connect your inbox to send campaigns and automatically detect replies.</p>
      </div>

      {loading ? (
        <div className="card-elevated grid place-items-center py-12"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : accounts.length > 0 ? (
        <div className="space-y-3">
          {accounts.map((a) => {
            const tint = PROVIDER_COLORS[a.provider];
            const pct = Math.round((a.sentToday / Math.max(a.dailyLimit, 1)) * 100);
            return (
              <div key={a.id} className="card-elevated p-4 sm:p-5">
                <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex gap-3 min-w-0">
                    <div className={`grid h-10 w-10 sm:h-11 sm:w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${tint}`}>
                      <Mail className="h-4 w-4 sm:h-5 sm:w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-semibold">{a.name}</h3>
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          {a.provider === 'GMAIL_OAUTH' ? 'GMAIL' : a.provider.replace('_', ' ')}
                        </span>
                        {a.isActive ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 ring-1 ring-inset ring-emerald-500/30">
                            <CheckCircle2 className="h-2.5 w-2.5" /> Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 ring-1 ring-inset ring-rose-500/30">
                            <XCircle className="h-2.5 w-2.5" /> Inactive
                          </span>
                        )}
                        {a.imapEnabled && a.imapConfigured && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600 ring-1 ring-inset ring-blue-500/30">
                            <Inbox className="h-2.5 w-2.5" /> Replies on
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <AtSign className="h-3 w-3" />
                        <span className="font-mono">{a.fromEmail}</span>
                        <span>·</span>
                        <span>{a.fromName}</span>
                      </div>
                      {a.smtpHost && (
                        <div className="mt-0.5 text-xs text-muted-foreground font-mono">
                          {a.smtpHost}:{a.smtpPort}
                        </div>
                      )}
                      {a.imapEnabled && a.imapHost && (
                        <div className="mt-0.5 text-xs text-muted-foreground font-mono">
                          IMAP {a.imapHost}:{a.imapPort}
                          {a.lastImapPollAt && <span className="ml-2 text-[10px]">· last poll {new Date(a.lastImapPollAt).toLocaleTimeString()}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap shrink-0 gap-1 -mx-1 sm:mx-0">
                    <button
                      onClick={() => test(a.id)}
                      disabled={testing === a.id}
                      className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50 sm:py-1"
                    >
                      {testing === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Test send
                    </button>
                    {a.imapConfigured && (
                      <button
                        onClick={() => testImap(a.id)}
                        disabled={testing === a.id + '-imap'}
                        className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                      >
                        {testing === a.id + '-imap' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Inbox className="h-3 w-3" />} Test IMAP
                      </button>
                    )}
                    {a.imapConfigured && (
                      <button
                        onClick={() => toggleImap(a.id, !a.imapEnabled)}
                        className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium ${a.imapEnabled ? 'border-blue-400/40 text-blue-600 hover:bg-blue-500/10' : 'bg-card hover:bg-accent'}`}
                      >
                        {a.imapEnabled ? 'Pause replies' : 'Enable replies'}
                      </button>
                    )}
                    <button
                      onClick={() => remove(a.id)}
                      className="rounded-md border border-destructive/40 p-1.5 text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                  <div className="flex-1">
                    <div className="flex justify-between"><span>Today</span><span className="tabular-nums font-medium">{a.sentToday} / {a.dailyLimit}</span></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-grad-brand" style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card-elevated grid place-items-center py-12 text-center">
          <Mail className="h-10 w-10 text-muted-foreground/40" />
          <h3 className="mt-3 font-semibold">No sending accounts yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">Connect an inbox below to start sending campaigns.</p>
        </div>
      )}

      {/* Provider picker */}
      {!showAdd ? (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Connect your inbox</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Pick any email provider — Gmail, Outlook, Yahoo, your own custom SMTP, or transactional services.</p>
          </div>

          {/* One-click OAuth — Gmail + Microsoft side by side */}
          <div className="grid gap-3 md:grid-cols-2">
            <button
              onClick={connectGmail}
              disabled={connectingGmail}
              className="card-elevated group relative overflow-hidden p-4 text-left transition-transform hover:scale-[1.01] active:scale-[0.995] disabled:opacity-60 sm:p-5"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-rose-500/10 via-amber-500/10 to-rose-500/0 opacity-50" />
              <div className="relative flex items-center gap-3 sm:gap-4">
                <div className="grid h-11 w-11 sm:h-12 sm:w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-rose-500/30 to-rose-500/0 text-rose-500">
                  {connectingGmail ? <Loader2 className="h-5 w-5 sm:h-6 sm:w-6 animate-spin" /> : <Mail className="h-5 w-5 sm:h-6 sm:w-6" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="font-semibold">Connect Gmail</h3>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 ring-1 ring-inset ring-emerald-500/30">
                      <ShieldCheck className="h-2.5 w-2.5" /> 1-click
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] sm:text-xs text-muted-foreground">
                    Sign in with Google. No app passwords — replies auto-detected.
                  </p>
                </div>
              </div>
            </button>

            <button
              onClick={connectMicrosoft}
              disabled={connectingMicrosoft}
              className="card-elevated group relative overflow-hidden p-4 text-left transition-transform hover:scale-[1.01] active:scale-[0.995] disabled:opacity-60 sm:p-5"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-cyan-500/10 to-blue-500/0 opacity-50" />
              <div className="relative flex items-center gap-3 sm:gap-4">
                <div className="grid h-11 w-11 sm:h-12 sm:w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-500/30 to-blue-500/0 text-blue-500">
                  {connectingMicrosoft ? <Loader2 className="h-5 w-5 sm:h-6 sm:w-6 animate-spin" /> : <Mail className="h-5 w-5 sm:h-6 sm:w-6" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="font-semibold">Connect Outlook</h3>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 ring-1 ring-inset ring-emerald-500/30">
                      <ShieldCheck className="h-2.5 w-2.5" /> 1-click
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] sm:text-xs text-muted-foreground">
                    Microsoft 365, Outlook.com, Hotmail. OAuth — no passwords.
                  </p>
                </div>
              </div>
            </button>
          </div>

          {/* Provider preset picker — pick any common email host */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Or pick your provider</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Yahoo, iCloud, Zoho, Fastmail, GoDaddy, Hostinger, Namecheap, AWS WorkMail, or any custom domain. App-password-based — replies auto-detected.
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {PROVIDER_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setPickerProvider(p.id); setShowAdd('SMTP'); }}
                  className="card-elevated group flex items-center gap-3 p-3 text-left transition-transform hover:scale-[1.01] active:scale-[0.995]"
                >
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary/15 to-primary/0 text-xs font-bold tracking-tighter text-primary">
                    {p.icon || p.id.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{p.name}</div>
                    <div className="truncate text-[10px] text-muted-foreground">{p.tagline}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Transactional services */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Transactional services</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Bulk-friendly API providers — best for high-volume cold outreach.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {(['SENDGRID', 'SES'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => { setPickerProvider(null); setShowAdd(p); }}
                  className="card-elevated group flex items-center gap-3 p-3 text-left transition-transform hover:scale-[1.01]"
                >
                  <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br ${PROVIDER_COLORS[p]}`}>
                    <Plus className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{p === 'SENDGRID' ? 'SendGrid' : 'Amazon SES'}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {p === 'SENDGRID' ? 'API key from SendGrid dashboard' : 'AWS access key + secret'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="card-elevated p-4 sm:p-6">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => { setShowAdd(null); setPickerProvider(null); resetForm(); }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" /> Back
            </button>
            <h3 className="text-sm font-semibold">
              {activePreset ? activePreset.name : `Add ${showAdd} account`}
            </h3>
            <span className="w-12" /> {/* spacer to balance back button */}
          </div>

          {/* Provider preset banner — shows app-password instructions + link */}
          {activePreset && showAdd === 'SMTP' && (
            <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-start gap-2">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/15 text-[10px] font-bold tracking-tighter text-primary">
                  {activePreset.icon || activePreset.id.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1 text-xs">
                  <div className="font-medium">
                    Settings pre-filled · <span className="font-mono text-[10px] text-muted-foreground">{activePreset.smtpHost}:{activePreset.smtpPort}</span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{activePreset.setupNote}</p>
                  {activePreset.appPasswordUrl && (
                    <a
                      href={activePreset.appPasswordUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" /> {activePreset.requires2FA ? 'Generate app password' : 'Find your email password'}
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Field label="Display name">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sales inbox" className={inputCls} />
            </Field>
            <Field label="Daily limit">
              <input type="number" min={1} max={2000} value={dailyLimit} onChange={(e) => setDailyLimit(parseInt(e.target.value || '50'))} className={inputCls} />
            </Field>
            <Field label="From name">
              <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Anna at Acme" className={inputCls} />
            </Field>
            <Field label="From email">
              <input type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="anna@acme.io" className={inputCls} />
            </Field>

            {showAdd === 'SMTP' && (
              <>
                <Field label="SMTP host">
                  <input
                    value={smtpHost}
                    onChange={(e) => { setSmtpHost(e.target.value); autoFillImapForProvider(e.target.value, smtpUser); }}
                    placeholder="smtp.gmail.com"
                    className={inputCls}
                  />
                </Field>
                <Field label="Port">
                  <input type="number" value={smtpPort} onChange={(e) => setSmtpPort(parseInt(e.target.value || '587'))} className={inputCls} />
                </Field>
                <Field label="Username">
                  <input
                    value={smtpUser}
                    onChange={(e) => { setSmtpUser(e.target.value); autoFillImapForProvider(smtpHost, e.target.value); }}
                    placeholder="anna@acme.io"
                    className={inputCls}
                  />
                </Field>
                <Field label="Password / App password">
                  <input type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} className={inputCls} />
                </Field>
                <div className="md:col-span-2 flex items-center gap-2">
                  <input id="secure" type="checkbox" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} className="accent-primary" />
                  <label htmlFor="secure" className="text-xs text-muted-foreground">Use TLS/SSL (port 465 only — leave off for 587 STARTTLS)</label>
                </div>
              </>
            )}

            {showAdd !== 'SMTP' && (
              <Field label={showAdd === 'SES' ? 'AWS credentials (accessKeyId:secret:region)' : 'API key'} className="md:col-span-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={showAdd === 'SES' ? 'AKIAxxxxxxxx:wJalrXxxxxxxx:us-east-1' : 'SG.xxxxxxxxxxxxxxxx'}
                  className={inputCls + ' font-mono'}
                />
              </Field>
            )}
          </div>

          {/* IMAP — optional reply detection */}
          <div className="mt-5 rounded-lg border border-dashed bg-muted/20 p-4">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={imapEnabled}
                onChange={(e) => setImapEnabled(e.target.checked)}
                className="mt-1 accent-primary"
              />
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Inbox className="h-3.5 w-3.5 text-blue-500" />
                  Detect replies via IMAP
                </div>
                <p className="text-xs text-muted-foreground">
                  We'll poll your inbox every 5 minutes and mark recipients as replied when they respond. Most providers use the same credentials as SMTP.
                </p>
              </div>
            </label>

            {imapEnabled && (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Field label="IMAP host">
                  <input value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="imap.gmail.com" className={inputCls} />
                </Field>
                <Field label="IMAP port">
                  <input type="number" value={imapPort} onChange={(e) => setImapPort(parseInt(e.target.value || '993'))} className={inputCls} />
                </Field>
                <Field label="IMAP username">
                  <input value={imapUser} onChange={(e) => setImapUser(e.target.value)} placeholder="anna@acme.io" className={inputCls} />
                </Field>
                <Field label="IMAP password / app password">
                  <input type="password" value={imapPass} onChange={(e) => setImapPass(e.target.value)} className={inputCls} />
                </Field>
                <div className="md:col-span-2 flex items-center gap-2">
                  <input id="imap-secure" type="checkbox" checked={imapSecure} onChange={(e) => setImapSecure(e.target.checked)} className="accent-primary" />
                  <label htmlFor="imap-secure" className="text-xs text-muted-foreground">Use TLS/SSL (recommended — port 993)</label>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={create}
            disabled={creating}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-grad-brand px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
          >
            {creating && <Loader2 className="h-4 w-4 animate-spin" />}
            Add account
          </button>
        </div>
      )}
    </div>
  );
}

const inputCls = 'w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30';

function Field({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}
