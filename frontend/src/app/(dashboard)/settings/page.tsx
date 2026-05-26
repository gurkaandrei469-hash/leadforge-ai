export default function SettingsPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="rounded-lg border bg-card p-6">
        <h3 className="font-semibold">Team profile</h3>
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-sm">Team name</label>
            <input defaultValue="Acme Marketing" className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-sm">Billing email</label>
            <input defaultValue="finance@acme.io" className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" />
          </div>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-6">
        <h3 className="font-semibold">Members</h3>
        <ul className="mt-4 divide-y text-sm">
          {[
            ['Anna Müller', 'anna@acme.io', 'OWNER'],
            ['Tom Chen', 'tom@acme.io', 'ADMIN'],
            ['Lina Park', 'lina@acme.io', 'MEMBER'],
          ].map(([n, e, r]) => (
            <li key={String(e)} className="flex items-center justify-between py-2.5">
              <div><div>{n}</div><div className="text-xs text-muted-foreground">{e}</div></div>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{r}</span>
            </li>
          ))}
        </ul>
        <button className="mt-4 rounded-md border px-3 py-1.5 text-sm">+ Invite member</button>
      </section>

      <section className="rounded-lg border bg-card p-6">
        <h3 className="font-semibold">Danger zone</h3>
        <p className="mt-1 text-sm text-muted-foreground">Permanently delete this team and all data.</p>
        <button className="mt-3 rounded-md border border-destructive px-3 py-1.5 text-sm text-destructive">Delete team</button>
      </section>
    </div>
  );
}
