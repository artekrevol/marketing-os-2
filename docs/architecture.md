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
