export default function DocsPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">API Documentation</h1>
      <p className="text-sm text-muted-foreground">REST endpoints, auth, rate limits, and webhooks.</p>

      <section className="rounded-lg border bg-card p-6">
        <h3 className="font-semibold">Authentication</h3>
        <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-3 text-xs">{`curl https://api.leadforge.ai/v1/leads \\
  -H "Authorization: Bearer lf_YOUR_API_KEY"`}</pre>
      </section>

      <section className="rounded-lg border bg-card p-6">
        <h3 className="font-semibold">Quick endpoints</h3>
        <ul className="mt-3 space-y-1 text-sm font-mono">
          <li>POST /v1/jobs — create extraction</li>
          <li>GET  /v1/jobs/:id — get job</li>
          <li>GET  /v1/leads — list leads</li>
          <li>POST /v1/leads/search — filter leads</li>
          <li>POST /v1/verification/single — verify one email</li>
          <li>POST /v1/verification/batch — verify many</li>
          <li>POST /v1/exports — create export</li>
        </ul>
        <a href="/docs/openapi.json" className="mt-4 inline-block text-sm text-primary">Download OpenAPI spec →</a>
      </section>
    </div>
  );
}
