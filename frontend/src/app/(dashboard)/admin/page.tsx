export default function AdminPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin Panel</h1>
      <div className="grid gap-4 md:grid-cols-4">
        {[
          ['Total teams', 1284],
          ['Active subscriptions', 412],
          ['Jobs running', 18],
          ['MRR', '$31,420'],
        ].map(([k, v]) => (
          <div key={String(k)} className="rounded-lg border bg-card p-5">
            <div className="text-sm text-muted-foreground">{k}</div>
            <div className="mt-2 text-2xl font-bold">{v as any}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border bg-card p-6">
        <h3 className="font-semibold">Recent activity</h3>
        <ul className="mt-3 space-y-1 text-sm">
          <li>· acme-marketing upgraded to Pro</li>
          <li>· orbital-labs ran a 5,000-lead extraction</li>
          <li>· user@spam.io flagged for abuse</li>
        </ul>
      </div>
    </div>
  );
}
