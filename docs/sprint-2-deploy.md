# Sprint 2 deploy & smoke test

## Pre-flight

1. **Sprint 1 migrations applied** to the Supabase preview branch
   (0001/0002, optionally 0003). Frontend `types.ts` regenerated.
2. **Sprint 2 migration** applied:
   `artifacts/insight-forge/supabase/migrations/0004_dead_jobs_integration_log.sql`.
   Verify with:
   ```sql
   select count(*) from public.dead_jobs;
   select count(*) from public.integration_call_log;
   select indexname from pg_indexes
     where tablename = 'events' and indexname = 'events_system_heartbeat_idx';
   ```
3. **Upstash Redis** production-tier database provisioned. Capture
   `REDIS_URL` (must be `rediss://` for TLS).
4. **DataForSEO** account: `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`.
5. **Originality.ai** account: `ORIGINALITY_AI_KEY`.
6. **Sentry** project (or reuse the API server's project with environment
   tag `worker`): `SENTRY_DSN`.
7. **Supabase**: pooled connection string for the worker (PgBouncer)
   captured as `DATABASE_URL`, plus `SUPABASE_SERVICE_ROLE_KEY`.
8. **api-server** also needs `SUPABASE_JWT_SECRET` (Project Settings →
   API → JWT Secret) so it can verify access tokens from the frontend.

## Required env vars

### `seo-os-worker` (Railway)

| Var | Notes |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | Railway assigns; default 3001 if local |
| `LOG_LEVEL` | `info` |
| `DATABASE_URL` | Supabase **pooled** connection string |
| `SUPABASE_SERVICE_ROLE_KEY` | not used by Drizzle directly but required by env validator (future use: storage / edge calls) |
| `REDIS_URL` | Upstash `rediss://...` |
| `DATAFORSEO_LOGIN` | |
| `DATAFORSEO_PASSWORD` | |
| `ORIGINALITY_AI_KEY` | |
| `OPENAI_API_KEY` | future use; required at boot |
| `SENTRY_DSN` | |

### `api-server`

| Var | Notes |
| --- | --- |
| `PORT` | from artifact wiring |
| `DATABASE_URL` | same Supabase pooled string |
| `REDIS_URL` | same Upstash URL — api-server enqueues |
| `SUPABASE_JWT_SECRET` | for verifying admin tokens from the frontend |

### Frontend (`insight-forge`)

No new env vars. The `/admin/system` page calls the api-server through
the shared proxy (relative `/api/...`) using the existing Supabase
session access token.

## Railway service

Service name: `seo-os-worker`.

Build command:
```
pnpm install --frozen-lockfile && pnpm --filter @workspace/worker run build
```

Start command:
```
node lib/worker/dist/index.mjs
```

Healthcheck: `GET /health`, port 3001, timeout 30s.
Replicas: 2.

## Smoke tests (run from `/admin/system`)

| # | Action | Expected |
| - | ------ | -------- |
| 1 | Click **Trigger heartbeat** | `system.heartbeat` event row appears in <2s, `Worker heartbeat` card shows `0s ago` |
| 2 | Click **Trigger heartbeat** twice with no auto-refresh between | Exactly one new event row (idempotent within key window) |
| 3 | Click **Test DataForSEO** | `integration.dataforseo.test.ok` event within 30s; `integration_call_log` row with `vendor='dataforseo'`, `status='ok'` |
| 4 | Click **Test Originality.ai** | `integration.originality.test.ok` event within 30s; `aiScore` < 0.5 on baseline text |
| 5 | Set `DATAFORSEO_PASSWORD` to a bad value, redeploy, **Test DataForSEO** | After retries, `integration.error` event; row in `integration_call_log` with `status='error'`; **dead_jobs** row appears |
| 6 | `railway service kill <one replica>` mid-burst | Burst still completes; no rows lost |
| 7 | Burst 100 heartbeats with unique idempotency keys via the smoke script | Exactly 100 new `system.heartbeat` events |

100-heartbeat burst (run from a workstation with the worker already
running):

```bash
DATABASE_URL=... REDIS_URL=... pnpm --filter @workspace/worker run test:enqueue-heartbeat
# Repeat 100x via a small loop, or extend the script.
```

## Rollback

The Sprint 2 migration only adds tables/indexes; it never alters
Sprint 1 columns. To roll back the worker tier without losing Sprint 1
data:

```sql
drop table if exists public.dead_jobs;
drop table if exists public.integration_call_log;
drop index if exists public.events_system_heartbeat_idx;
```

Then disable the Railway service. The frontend `/admin/system` page
will surface API failures but will not crash other admin pages.
