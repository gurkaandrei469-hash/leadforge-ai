# Database Schema Reference

Full Prisma source: [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma).

## Tables

| Table | Purpose |
|---|---|
| `User` | Clerk-linked user identity |
| `Team` | Tenant + plan + credits |
| `TeamMembership` | Many-to-many user↔team with role |
| `Invitation` | Pending email invites (7-day token) |
| `ApiKey` | SHA-256 hashed `lf_*` keys with scopes |
| `ExtractionJob` | One scrape run; filters + sources + progress |
| `JobEvent` | Timeline events per job |
| `Lead` | Discovered contact; unique per `(teamId, emailNormalized)` |
| `LeadEnrichment` | Raw enrichment provider data |
| `EmailVerification` | 6-layer verification snapshot, 30d TTL |
| `DomainCache` | MX + disposable cache, 7d TTL |
| `Export` | CSV/XLSX/JSON files, 7d signed URLs |
| `Subscription` | Stripe subscription state |
| `Invoice` | Stripe invoice history |
| `CreditTransaction` | Append-only credit ledger |
| `AuditLog` | Sensitive actions (RBAC, billing, key mgmt) |
| `Webhook` | Outbound HMAC-signed event delivery |
| `Notification` | In-app notifications |
| `RateLimit` | Future: persistent rate-limit buckets |

## Key indexes
- `Lead (teamId, status)` and `(teamId, verificationStatus)` for table views.
- `Lead (companyDomain)` for domain rollups.
- `Lead (qualityScore)` for top-N queries.
- `ExtractionJob (teamId, status)` for dashboard listings.
- `ApiKey (keyHash)` for O(1) auth lookup.
- `DomainCache (domain)` + `(expiresAt)` for sweep jobs.

## Unique constraints
- `User.clerkId`, `User.email`
- `Team.slug`, `Team.stripeCustomerId`, `Team.stripeSubscriptionId`
- `TeamMembership(userId, teamId)`
- `Invitation(email, teamId)`, `Invitation.token`
- `ApiKey.keyHash`
- `Lead(teamId, emailNormalized)` — primary dedupe key
- `EmailVerification.leadId` (1:1)
- `DomainCache.domain`

## Cascades
- Delete `Team` → cascades to memberships, jobs, leads, exports, api keys, subs, invoices, webhooks.
- Delete `Lead` → cascades to verification + enrichment.
- Soft delete: `Team.deletedAt`, `User.deletedAt` reserved for GDPR.
