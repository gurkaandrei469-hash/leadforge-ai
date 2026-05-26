# LeadForge AI — MVP Wireframes & Component Specs

12 pages total. Layout uses a 260px left sidebar + topbar shell for authenticated pages. Public pages use centered container.

---

## 1. Landing — `/`
ASCII layout:
```
┌──────────────────────────────────────────────────────────────────────┐
│  LeadForge.AI                    Pricing  API  Sign in  [Start free] │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│              ✨ AI-Powered B2B Lead Engine                            │
│        Find your ideal customers in minutes — not weeks.             │
│                                                                      │
│   LeadForge AI scrapes, verifies, classifies leads via 13+ filters.  │
│                                                                      │
│         [ Start free — 100 credits → ]   [ See pricing ]              │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│  ┌─Search─┐ ┌─Mail─┐ ┌─Brain─┐ ┌─Zap─┐                                │
│  │Smart   │ │Email │ │AI     │ │Fast │                                │
│  │filters │ │verify│ │score  │ │queue│                                │
│  └────────┘ └──────┘ └───────┘ └─────┘                                │
└──────────────────────────────────────────────────────────────────────┘
```
Components: `<NavBar>`, `<Hero>`, `<FeatureGrid>`, `<Footer>`.

---

## 2. Pricing — `/pricing`
Four-column plan grid. Featured plan highlighted with ring + "Most popular" pill.
```
┌─Free─┐ ┌─Starter─┐ ┌─Pro★─┐ ┌─Business─┐
│ $0   │ │  $29    │ │ $99  │ │  $299    │
│ 100  │ │ 2,500   │ │12,000│ │ 50,000   │
│ ...  │ │ ...     │ │ ...  │ │ ...      │
└──────┘ └─────────┘ └──────┘ └──────────┘
```
Components: `<PlanCard featured?>`, `<CheckList>`.

---

## 3. Login & Signup — `/login`, `/signup`
Clerk `<SignIn>` / `<SignUp>` centered. Brand text above.

---

## 4. Dashboard (Overview) — `/dashboard`
```
┌─Sidebar 260px─┐┌──────── Topbar (credits, user) ────────────────┐
│ ▸ Overview    ││ Overview                          [+ New extr.]│
│ ◦ Extraction  │├────────────────────────────────────────────────┤
│ ◦ Leads       ││ ┌Stat┐ ┌Stat┐ ┌Stat┐ ┌Stat┐                    │
│ ◦ Verify      ││ │12k │ │9k  │ │3   │ │72.4│                    │
│ ◦ Analytics   ││ └────┘ └────┘ └────┘ └────┘                    │
│ ◦ Billing     ││                                                │
│ ◦ Settings    ││ ┌─Active jobs─────────┐ ┌─Recent leads──────┐  │
│ ◦ API Keys    ││ │ SaaS founders 64%   │ │ founder@..   92   │  │
│ ◦ API Docs    ││ │ Shopify 22%         │ │ ceo@..       78   │  │
└───────────────┘│ │ Agencies 91%        │ │ ops@..       65   │  │
                 │ └─────────────────────┘ └───────────────────┘  │
                 └────────────────────────────────────────────────┘
```
Components: `<StatCard>`, `<JobProgressList>`, `<RecentLeadsTable>`, `<CreditMeter>`.

---

## 5. New Extraction — `/extraction`
```
Name: [_____________________________________________]
Sources: (chip toggles) [web_search✓] [directory] [linkedin] ...
Target leads: [_200_]

Filters (AND)                                  [+ Add filter]
┌──────────────────────────────────────────────────────────┐
│ [niche ▼] [eq ▼] [SaaS_____________________] [×]         │
│ [country▼] [in▼] [US, CA, UK________________] [×]        │
│ [tech    ▼] [has_any▼] [shopify, klaviyo____] [×]        │
└──────────────────────────────────────────────────────────┘

                                  [Save draft]  [Start →]
```
Components: `<SourceChips>`, `<FilterBuilder>` (recursive AND/OR/NOT groups), `<CreditEstimator>`.

---

## 6. Leads — `/leads`
```
[Search emails, companies, domains ...]      [Filters] [Export ▼]

┌─□─┬─Name / Email───────┬─Company─┬─Title──┬─Country─┬─Score─┬─Verify──┐
│ ☐ │ Anna Müller        │ Acme    │ Head G │ DE      │  82   │ VALID   │
│ ☐ │ anna@acme.io       │         │        │         │       │         │
├───┼────────────────────┼─────────┼────────┼─────────┼───────┼─────────┤
│ ☐ │ ...                │ ...     │ ...    │ ...     │  ...  │ ...     │
└───┴────────────────────┴─────────┴────────┴─────────┴───────┴─────────┘

  ‹ 1 2 3 ... 48 ›       Showing 50 of 12,418
```
Components: `<LeadsTable>` (TanStack table, virtualized), `<BulkActionsBar>`, `<FilterDrawer>`, `<ExportDialog>`.

Detail drawer slides in from right:
```
┌─Anna Müller ─────────────────────────────────── ×─┐
│ anna@acme.io   [verify] [add to list] [favorite]  │
│ Head of Growth at Acme · Berlin, DE               │
│ Quality 82 · Intent 71 · Authority 68             │
│ Tags: decision-maker · saas · growth              │
│ ─ Verification ─                                  │
│ Status: VALID  Score: 95  Reason: deliverable     │
│ MX: aspmx.l.google.com  Catch-all: No             │
│ ─ Source ─                                        │
│ https://acme.io/team   Found Jun 10               │
│ ─ Notes ─                                         │
│ [textarea]                                        │
└───────────────────────────────────────────────────┘
```

---

## 7. Verification — `/verification`
```
Valid 9,237  |  Risky 412  |  Invalid 1,283  |  Unknown 188

┌─Verify single email──────────────────────────────────┐
│ [contact@example.com________________]   [Verify]     │
│ Runs syntax + disposable + MX + SMTP + catch-all     │
└──────────────────────────────────────────────────────┘

┌─Bulk verify──────────────────────────────────────────┐
│ [Re-verify expired]    [Verify all unverified]       │
└──────────────────────────────────────────────────────┘
```
Components: `<VerifyForm>`, `<VerifyResultCard>`, `<BulkVerifyPanel>`.

---

## 8. Analytics — `/analytics`
```
┌─Leads acquired 30d (bar chart)────┐ ┌─Top niches─────────┐
│ ▆▃▅▇▂▆▅▇▅▆▇▃▆▂▇▆▇                  │ │ SaaS         3,214 │
│                                   │ │ E-commerce   2,188 │
└───────────────────────────────────┘ │ Agencies     1,842 │
                                      │ Coaching     1,011 │
┌─Verification mix (donut)──────────┐ │ DTC          894   │
│  Valid 70% · Risky 5% · Inv 12%   │ └────────────────────┘
└───────────────────────────────────┘
```
Components: `<TimeseriesChart>`, `<DonutChart>`, `<RankList>`.

---

## 9. Settings — `/settings`
Sections: Team profile · Members (table with role badges + invite) · Danger zone.
Components: `<MembersTable>`, `<InviteDialog>`, `<DangerCard>`.

---

## 10. Billing — `/settings/billing`
```
Current plan: Pro · $99/mo · renews Jul 22, 2026   [Manage in Stripe]
Credits used: 3,241 / 12,000  ████░░░░░░░░░░░░░░░░░░░░░░░

Invoices:
Jun 22 2026   $99.00   Paid   [Download PDF]
May 22 2026   $99.00   Paid   [Download PDF]
```
Components: `<PlanCard>`, `<CreditMeter>`, `<InvoicesTable>`.

---

## 11. API Keys — `/settings/api-keys`
Table with name, prefix, scopes, last used. "Create" dialog reveals key once. "Revoke" confirms.
Components: `<ApiKeysTable>`, `<CreateKeyDialog>`, `<RevealOnceField>`.

---

## 12. API Docs — `/docs`
- Authentication snippet (curl with `lf_` Bearer)
- Quick endpoints list
- Link to downloadable OpenAPI spec (`/docs/openapi.json`)
- Linked sub-pages: Jobs, Leads, Verification, Webhooks
Components: `<CodeBlock>`, `<EndpointList>`.

---

## 13. Admin Panel — `/admin` (platform OWNER only)
KPI tiles (teams, subs, jobs running, MRR) + recent activity. Future: per-team drilldown, flagged content, abuse review.
Components: `<KPITile>`, `<ActivityFeed>`.

---

## Shared component spec
| Component | Props | Purpose |
|---|---|---|
| `<Sidebar />` | `nav[]`, `active` | Left rail nav |
| `<TopBar />` | `creditsUsed`, `creditsTotal` | Topbar + user menu |
| `<StatCard />` | `label`, `value`, `delta`, `icon` | KPI tile |
| `<JobProgressList />` | `jobs[]` | Live progress with SSE binding |
| `<LeadsTable />` | `data`, `filters`, `onSort` | Sortable, virtualized rows |
| `<FilterBuilder />` | `value: Filter`, `onChange` | Recursive AND/OR/NOT tree builder |
| `<BulkActionsBar />` | `selected[]` | Archive / verify / export / delete |
| `<ExportDialog />` | `filter`, `count` | Pick format → enqueue export |
| `<CreditMeter />` | `used`, `total` | Linear progress + upgrade CTA |
| `<VerifyResultCard />` | `result: EmailVerification` | Color-coded status + reason |
| `<TimeseriesChart />` | `series[]` | Recharts bar/line |
| `<MembersTable />` | `members[]`, `onInvite` | Role badges + invite/remove |
| `<ApiKeysTable />` | `keys[]` | Create reveals once, revoke flow |

Loading/empty/error states for all data components are required.
Real-time updates use SSE from `GET /api/v1/jobs/:id/stream`.
