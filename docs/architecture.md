# LeadForge AI — Architecture

## High-level
```
┌────────────┐   HTTPS   ┌────────────────┐   PG/Redis  ┌──────────────┐
│  Next.js   │──────────▶│  Express API   │────────────▶│  PostgreSQL  │
│ Dashboard  │◀── SSE ───│  + REST + WS   │             │  + Redis     │
└────────────┘           └────────┬───────┘             └──────────────┘
                                  │ enqueue
                                  ▼
                         ┌────────────────┐
                         │  BullMQ workers│
                         │  ──────────────│
                         │  • extraction  │ → Playwright/Cheerio + AI
                         │  • verification│ → MX + SMTP + scoring
                         │  • enrichment  │ → OpenAI classifier
                         │  • export      │ → CSV/XLSX/JSON → S3
                         │  • webhook     │ → HMAC-signed delivery
                         └────────────────┘
```

## Data flow — extraction
1. User submits `POST /jobs` → API validates filter tree, checks credits, creates `ExtractionJob`, enqueues `extraction.add({ jobId })`.
2. Extraction worker:
   - Updates job to `RUNNING`.
   - Calls `discoverSources(sources, filters)` → URL list.
   - For each URL (concurrency 4): `scrapePage()` → `extractLeads()` → `matchInMemory(filter)`.
   - Upserts `Lead` by `(teamId, emailNormalized)`.
   - Enqueues `verification` + `enrichment` per lead.
   - Publishes progress to Redis pub/sub channel `job:{id}:progress`.
3. API streams progress to UI via SSE.

## Data flow — verification (6 layers)
| Stage | Check | Network | Cached |
|---|---|---|---|
| 1 | Syntax (RFC) | none | — |
| 2 | Disposable domain | none | static set |
| 3 | MX records | DNS | DomainCache 7d |
| 4 | SMTP RCPT TO | TCP:25 | — |
| 5 | Catch-all probe | TCP:25 | inferred |
| 6 | Role-account flag | none | — |
Result: `score 0-100`, `status: VALID | INVALID | RISKY | CATCH_ALL | UNKNOWN`, persisted to `EmailVerification` (30-day TTL).

## Filter engine
Recursive tree: `Condition | { AND[] } | { OR[] } | { NOT }`.
- `compileFilterToWhere(filter, teamId)` → Prisma `LeadWhereInput` for DB queries.
- `matchInMemory(filter, lead)` → boolean for stream filtering during scrape.
- 25+ supported fields across niche, location, company, role, tech, social, scores.

## Multi-tenancy
- `teamId` scope on every query enforced by `compileFilterToWhere`.
- Roles: `OWNER | ADMIN | MEMBER | VIEWER` gated by `requireRole`.
- `X-Team-Id` header switches active team for users in multiple teams.

## Auth
- **Clerk JWT** for dashboard sessions.
- **API keys** (`lf_<32-byte-base64url>`) for programmatic access — SHA-256 hashed at rest; plaintext returned only once at creation.

## Rate limiting
- Per-user/IP via `rate-limiter-flexible` on Redis (100/min default).
- Per-team credit deduction tracks usage in `CreditTransaction`.

## Security & compliance
- robots.txt respected by `scraper.ts` (cached per origin).
- GDPR/CAN-SPAM:
  - Right-to-delete on user + lead.
  - Verification source URL stored for traceability.
  - Audit log of all sensitive operations.
- Encryption: TLS in transit; column-level encryption optional for stored emails (future).
- Webhook payloads signed with HMAC-SHA256 (`X-LeadForge-Signature`).

## Deployment
- Dev: `docker compose -f infrastructure/docker/docker-compose.yml up`.
- Prod recommendation:
  - Frontend: Vercel.
  - API + workers: AWS ECS / Fly.io; separate `api` and `worker` services.
  - Database: Neon/RDS Postgres.
  - Cache/queue: Upstash/ElastiCache Redis.
  - Exports: S3 with 7-day signed URLs.

## Observability
- pino structured logs.
- `/health` (liveness) + `/ready` (DB ping).
- Future: OpenTelemetry traces, BullMQ Board dashboard, Sentry error tracking.
