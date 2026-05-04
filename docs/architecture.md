# Architecture

## Workspace layout

```
artifacts/
  api-server/        @workspace/api-server    Express 5 admin/system surface
  insight-forge/     @workspace/insight-forge ContentForge web UI
  mockup-sandbox/                              Component preview server (dev only)
lib/
  api-spec/          @workspace/api-spec      OpenAPI source-of-truth + orval codegen
  api-zod/           @workspace/api-zod       Generated zod request/response schemas
  api-client-react/  @workspace/api-client-react Generated react-query hooks
  db/                @workspace/db            Drizzle bindings + withBrandScope helper
  jobs/              @workspace/jobs          BullMQ queues + typed enqueue
  worker/            @workspace/worker        SEO OS worker process (Railway target)
  integrations/
    dataforseo/                @workspace/integrations-dataforseo
    originality-ai/            @workspace/integrations-originality-ai
```

## Worker tier (Sprint 2)

```
                ┌───────────────┐  HTTP+JWT  ┌────────────────┐
 Admin (browser)│ insight-forge │───────────►│   api-server   │
                │ /admin/system │            │ /admin/system/* │
                └───────────────┘            └─────────┬──────┘
                                                       │ enqueue<JobName>
                                                       ▼
                                              ┌────────────────┐
                                              │  Upstash Redis │
                                              │  (5 queues)    │
                                              └─────────┬──────┘
                                                        │ BullMQ
                                                        ▼
                                              ┌────────────────┐
                                              │  seo-os-worker │   ◄── Railway
                                              │  (2 replicas)  │
                                              └─────────┬──────┘
                                                        │ Drizzle (service role)
                                                        ▼
                                              ┌────────────────┐
                                              │   Supabase PG  │
                                              │ events,         │
                                              │ dead_jobs,      │
                                              │ integration_log │
                                              └────────────────┘
```

### Queues

`maintenance`, `integrations`, `projects`, `content`, `scoring`. One
ioredis connection multiplexed across all five `Worker` instances; the
worker process registers a single dispatcher (`lib/worker/src/jobs/index.ts`)
that looks each job up in `JOB_REGISTRY` and routes to its handler.

### BullMQ defaults

```ts
{ attempts: 3,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: { count: 1000 },
  removeOnFail:    { count: 1000 } }
```

Idempotency is enforced at enqueue time by setting BullMQ `jobId` to
`<jobName>:<idempotencyKey>`; handlers also short-circuit on duplicate
`payload->>'idempotencyKey'` lookups against `events`.

### Tenancy

The worker uses the Supabase **service role** so RLS does not protect
it. `withBrandScope(brandId, fn)` (in `lib/db/src/brand-scope.ts`) opens
a transaction that:

1. `set local row_security = off` (explicit, not a search-path trick).
2. `select set_config('app.current_brand', brandId, true)`.
3. Returns a typed `scope.db` for use inside `fn`.

Every write to a brand-scoped table must call `assertBrandScope(scope.brandId, row)`
first; mismatches throw synchronously. Brand-scoped tables are
enumerated in `BRAND_SCOPED_TABLES` (Sprint 1's 13 tables).

System tables (`events`, `dead_jobs`, `integration_call_log`) use
nullable `brand_id` and are written outside `withBrandScope`.

### Observability

- pino structured JSON logs via `@workspace/worker → src/logger.ts`.
- Per-job child loggers tagged with `{ jobId, jobName, queueName, attempt, brandId }`.
- Sentry DSN initialized at boot; every failed job captured with full job context.
- `GET /health` on PORT (default 3001) returns `{ status, uptime, queues }`
  for Railway's healthcheck.

### Deployment

- Worker → Railway service `seo-os-worker`, two replicas, Nixpacks.
- Frontend (insight-forge) → unchanged.
- API server → unchanged location, gains admin/system routes.

See `docs/sprint-2-deploy.md` for env-var inventory and smoke-test
procedure.

## Recovery War Room

The Recovery War Room is a parallel-track executive dashboard that locks
pre-October 2025 baselines and projects recovery timelines per brand.
12–18 month lifespan; retire when recovery completes.

### Data flow

```
rank_snapshots (existing)
        │
        ▼
┌──────────────────────┐  nightly cron   ┌──────────────────────┐
│  recovery_baselines  │ ◄───────────────│  scoring queue       │
│  (1 row per brand,   │  backfill or    │  recovery-snapshot   │
│   locked immutably)  │  0 3 * * * UTC  │  handler             │
└──────────────────────┘                 └──────────┬───────────┘
                                                    │ writes
                                                    ▼
                                         ┌──────────────────────┐
                                         │  recovery_snapshots  │
                                         │  (daily roll-up)     │
                                         └──────────┬───────────┘
                                                    │
       ┌────────────────────────────────────────────┤
       ▼                                            ▼
┌──────────────────┐                   ┌──────────────────────┐
│ /recovery UI     │                   │ /api/recovery/export │
│ (seo-os artifact)│                   │ /:brandId.pdf        │
│ burn-down chart  │                   │ /all.pdf (admin)     │
│ + initiatives    │                   │ @react-pdf/renderer  │
└──────────────────┘                   └──────────────────────┘
```

### Tables

| Table | Scope | Key constraint |
|---|---|---|
| `recovery_baselines` | Pattern A, UNIQUE(brand_id) | Immutable after lock |
| `recovery_initiatives` | Pattern A | Manual CRUD by admin/editor |
| `recovery_snapshots` | Pattern A, UNIQUE(brand_id, snapshot_date) | Worker-written |

### Headline metric

Rankings-based (`gap_to_baseline_top10_pct`), not clicks-based. GSC/GA4
fields exist in the schema as nullable placeholders for a future
ingestion sprint. The burn-down projection uses linear regression on
top-10 keyword gap over the last 30 snapshots.

### PDF export

Server-side via `@react-pdf/renderer` (pinned in workspace catalog).
Routes `GET /api/recovery/export/:brandId.pdf` and
`GET /api/recovery/export/all.pdf` are admin-only. One page per brand:
TekRevol-branded header, four-metric row (avg position, top-10 delta,
top-3 delta, GSC placeholder), embedded SVG trend chart, top 3 active
initiatives, projected recovery date, page-numbered footer.

### Key files

- Service: `lib/services/recovery/`
- API routes: `artifacts/api-server/src/routes/recovery.ts`
- PDF components: `artifacts/api-server/src/pdf/`
- UI: `artifacts/seo-os/src/pages/Recovery.tsx`
- Migration: `artifacts/insight-forge/supabase/migrations/0009_recovery.sql`

See `docs/recovery-runbook.md` for operational guidance.
