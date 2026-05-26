export default function BillingPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Billing</h1>

      <section className="rounded-lg border bg-card p-6">
        <div className="flex items-baseline justify-between">
          <div>
            <h3 className="font-semibold">Current plan: Pro</h3>
            <p className="text-sm text-muted-foreground">$99/mo · renews Jul 22, 2026</p>
          </div>
          <button className="rounded-md border px-3 py-1.5 text-sm">Manage</button>
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-sm"><span>Credits used</span><span>3,241 / 12,000</span></div>
          <div className="mt-1 h-2 rounded bg-muted"><div className="h-full rounded bg-primary" style={{ width: '27%' }} /></div>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-6">
        <h3 className="font-semibold">Invoices</h3>
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-muted-foreground"><tr><th className="py-2">Date</th><th>Amount</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {[['Jun 22, 2026', '$99.00', 'Paid'], ['May 22, 2026', '$99.00', 'Paid'], ['Apr 22, 2026', '$99.00', 'Paid']].map((r) => (
              <tr key={r[0]} className="border-t"><td className="py-2">{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td className="text-right"><a className="text-primary" href="#">Download</a></td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
