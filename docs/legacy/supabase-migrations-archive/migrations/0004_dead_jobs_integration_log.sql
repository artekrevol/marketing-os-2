-- Sprint 2 — Worker tier system tables.
--
-- Two new tables that the worker process writes to:
--   * dead_jobs            — BullMQ jobs that exhausted their retry budget
--   * integration_call_log — telemetry for outbound integration calls
--
-- Both are Pattern C (system tables): brand_id is nullable, no RLS, only
-- accessible via the service role from the worker. Surfaced read-only on
-- /admin/system in the frontend (admin-only via existing is_admin()).
--
-- Run this migration on the Supabase preview branch first; do not push
-- to prod blind.

begin;

----------------------------------------------------------------------
-- 1. dead_jobs
----------------------------------------------------------------------
create table if not exists public.dead_jobs (
  id              uuid primary key default gen_random_uuid(),
  queue_name      text not null,
  job_name        text not null,
  job_id          text not null,
  payload         jsonb not null default '{}'::jsonb,
  failure_reason  text not null,
  stack           text,
  attempts_made   integer not null default 0,
  failed_at       timestamptz not null default now()
);

create index if not exists dead_jobs_failed_at_idx on public.dead_jobs (failed_at desc);
create index if not exists dead_jobs_queue_idx on public.dead_jobs (queue_name, failed_at desc);

alter table public.dead_jobs enable row level security;

-- Admins can read; nobody else.
drop policy if exists dead_jobs_admin_select on public.dead_jobs;
create policy dead_jobs_admin_select on public.dead_jobs
  for select using (public.is_admin());

----------------------------------------------------------------------
-- 2. integration_call_log
----------------------------------------------------------------------
create table if not exists public.integration_call_log (
  id                 uuid primary key default gen_random_uuid(),
  vendor             text not null,
  endpoint           text not null,
  status             text not null check (status in ('ok','error','rate_limited','timeout')),
  http_status        integer,
  duration_ms        integer not null,
  cost_estimate_usd  numeric(12,6),
  brand_id           uuid references public.brands(id) on delete set null,
  request_meta       jsonb not null default '{}'::jsonb,
  error_message      text,
  occurred_at        timestamptz not null default now()
);

create index if not exists integration_call_log_occurred_idx on public.integration_call_log (occurred_at desc);
create index if not exists integration_call_log_vendor_idx on public.integration_call_log (vendor, occurred_at desc);
create index if not exists integration_call_log_brand_idx on public.integration_call_log (brand_id, occurred_at desc);

alter table public.integration_call_log enable row level security;

-- Admins can read all rows.
drop policy if exists integration_call_log_admin_select on public.integration_call_log;
create policy integration_call_log_admin_select on public.integration_call_log
  for select using (public.is_admin());

-- Brand-scoped readers can read their own brand's rows. NULL brand_id
-- rows (cross-brand system pings) are visible to admins only.
drop policy if exists integration_call_log_brand_select on public.integration_call_log;
create policy integration_call_log_brand_select on public.integration_call_log
  for select using (
    brand_id is not null and brand_id = any(public.current_user_brand_access())
  );

----------------------------------------------------------------------
-- 3. system.heartbeat — adds a partial index on the events table for
--    fast freshness lookups on /admin/system. The events table itself
--    already exists (created in 0001).
----------------------------------------------------------------------
create index if not exists events_system_heartbeat_idx
  on public.events (created_at desc)
  where event_type = 'system.heartbeat';

commit;

-- Smoke checks (run after commit):
-- select count(*) from public.dead_jobs;
-- select count(*) from public.integration_call_log;
-- select indexname from pg_indexes where tablename = 'events' and indexname like 'events_system%';
