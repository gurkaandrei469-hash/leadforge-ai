import { BadgeCheck, AlertCircle, Ban, HelpCircle } from 'lucide-react';

export default function VerificationPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Email Verification</h1>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: 'Valid', count: 9237, icon: BadgeCheck, color: 'emerald' },
          { label: 'Risky', count: 412, icon: AlertCircle, color: 'amber' },
          { label: 'Invalid', count: 1283, icon: Ban, color: 'rose' },
          { label: 'Unknown', count: 188, icon: HelpCircle, color: 'slate' },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border bg-card p-5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><s.icon className="h-4 w-4" /> {s.label}</div>
            <div className="mt-2 text-2xl font-bold">{s.count.toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border bg-card p-6">
        <h3 className="font-semibold">Verify a single email</h3>
        <div className="mt-3 flex gap-2">
          <input className="flex-1 rounded-md border bg-background px-3 py-2 text-sm" placeholder="contact@example.com" />
          <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Verify</button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Runs all 6 checks: syntax, disposable, MX, SMTP, catch-all, role.</p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <h3 className="font-semibold">Bulk verify selected leads</h3>
        <p className="mt-1 text-sm text-muted-foreground">Select leads from the Leads page and run verification in the background.</p>
        <div className="mt-3 flex gap-2">
          <button className="rounded-md border px-4 py-2 text-sm">Re-verify expired</button>
          <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Verify all unverified</button>
        </div>
      </div>
    </div>
  );
}
