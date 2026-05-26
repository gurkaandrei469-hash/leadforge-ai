'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Trash2, ExternalLink, Loader2, Plug } from 'lucide-react';
import { toast } from 'sonner';
import { useApi, ApiError } from '@/lib/client-api';

interface Connection {
  id: string;
  provider: 'HUBSPOT' | 'SALESFORCE' | 'PIPEDRIVE';
  accountLabel: string | null;
  isActive: boolean;
  totalPushed: number;
  lastSyncAt: string | null;
  createdAt: string;
}

export default function IntegrationsPage() {
  const api = useApi();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [hsToken, setHsToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ connections: Connection[] }>('/integrations');
      setConnections(res.connections);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const hubspot = connections.find((c) => c.provider === 'HUBSPOT');

  async function connectHubspot() {
    if (!hsToken.trim()) return toast.error('Paste your HubSpot Private App token first');
    setConnecting(true);
    try {
      await api.post('/integrations/hubspot/connect', { access_token: hsToken.trim() });
      setHsToken('');
      toast.success('HubSpot connected ✓');
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  }

  async function disconnectHubspot() {
    if (!confirm('Disconnect HubSpot? Pushed contacts will remain on HubSpot, but future syncs will be disabled.')) return;
    setDisconnecting(true);
    try {
      await api.del('/integrations/hubspot');
      toast.success('HubSpot disconnected');
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Integrations</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sync your leads to external CRMs and email tools.</p>
      </div>

      {/* ─────────────────── HubSpot ─────────────────── */}
      <section className="rounded-lg border bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="rounded-md bg-orange-500/10 p-2">
            <Plug className="h-5 w-5 text-orange-500" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">HubSpot</h2>
              {hubspot ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600">
                  <CheckCircle2 className="h-3 w-3" /> Connected
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Not connected · free tier OK</span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Push verified leads as Contacts to your HubSpot account. Works with the free HubSpot CRM.
            </p>

            {hubspot ? (
              <div className="mt-4 rounded-md border bg-background p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{hubspot.accountLabel ?? 'HubSpot account'}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {hubspot.totalPushed.toLocaleString()} contacts pushed
                      {hubspot.lastSyncAt && ` · last sync ${new Date(hubspot.lastSyncAt).toLocaleString()}`}
                    </div>
                  </div>
                  <button
                    onClick={disconnectHubspot}
                    disabled={disconnecting}
                    className="inline-flex items-center gap-1 rounded-md border border-destructive px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" /> Disconnect
                  </button>
                </div>
                <div className="mt-3 rounded-md bg-muted/40 p-3 text-xs">
                  <div className="font-medium">How to push leads:</div>
                  <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                    <li>Open any job page → click <span className="font-mono">Push to HubSpot</span></li>
                    <li>Or from chat: <span className="font-mono">"sync job xxxxxx to hubspot"</span></li>
                  </ul>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <details className="rounded-md border bg-background p-3 text-sm" open>
                  <summary className="cursor-pointer font-medium">How to get a HubSpot Private App token (free)</summary>
                  <ol className="mt-2 list-decimal pl-5 space-y-1 text-xs text-muted-foreground">
                    <li>Sign up for free at <a className="text-primary" href="https://app.hubspot.com/signup-hubspot/crm" target="_blank" rel="noreferrer">hubspot.com <ExternalLink className="inline h-3 w-3" /></a></li>
                    <li>Go to <span className="font-mono">Settings → Integrations → Private Apps</span></li>
                    <li>Click <span className="font-mono">Create a private app</span>, name it "LeadForge"</li>
                    <li>On the <span className="font-mono">Scopes</span> tab, enable: <code>crm.objects.contacts.read</code>, <code>crm.objects.contacts.write</code>, <code>oauth</code></li>
                    <li>Click <span className="font-mono">Create app</span>, then copy the <span className="font-mono">Access token</span></li>
                    <li>Paste it below ↓</li>
                  </ol>
                </details>
                <div>
                  <label className="block text-sm font-medium">HubSpot Private App access token</label>
                  <input
                    type="password"
                    value={hsToken}
                    onChange={(e) => setHsToken(e.target.value)}
                    placeholder="pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
                  />
                </div>
                <button
                  onClick={connectHubspot}
                  disabled={connecting || !hsToken.trim()}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {connecting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Connect HubSpot
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ─────────────────── Salesforce / Pipedrive — placeholders ─────────────────── */}
      <section className="rounded-lg border bg-card p-6 opacity-60">
        <div className="flex items-start gap-4">
          <div className="rounded-md bg-blue-500/10 p-2">
            <Plug className="h-5 w-5 text-blue-500" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Salesforce</h2>
              <span className="text-xs text-muted-foreground">Coming soon · OAuth required</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Salesforce free Developer Edition is supported; OAuth flow lands in next release.</p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-6 opacity-60">
        <div className="flex items-start gap-4">
          <div className="rounded-md bg-emerald-500/10 p-2">
            <Plug className="h-5 w-5 text-emerald-500" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Pipedrive</h2>
              <span className="text-xs text-muted-foreground">Coming soon · API token</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Same Private-App-style token flow as HubSpot — pending build.</p>
          </div>
        </div>
      </section>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading connections…
        </div>
      )}
    </div>
  );
}
