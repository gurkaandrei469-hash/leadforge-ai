export default function ApiKeysPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">API Keys</h1>
        <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">+ Create key</button>
      </div>

      <div className="rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left"><tr>
            <th className="p-3">Name</th><th>Prefix</th><th>Scopes</th><th>Last used</th><th></th>
          </tr></thead>
          <tbody>
            {[
              ['Prod webhook', 'lf_a3c87feb', 'leads:read, jobs:*', '2h ago'],
              ['Zapier integration', 'lf_9b05441c', 'leads:read', '3d ago'],
            ].map((r) => (
              <tr key={String(r[1])} className="border-t">
                <td className="p-3">{r[0]}</td><td className="font-mono text-xs">{r[1]}…</td>
                <td className="text-xs">{r[2]}</td><td className="text-muted-foreground">{r[3]}</td>
                <td className="text-right pr-3"><button className="text-destructive text-xs">Revoke</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
