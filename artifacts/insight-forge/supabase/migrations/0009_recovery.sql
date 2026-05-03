-- Recovery War Room — Prompt 1 / Sprint Pack.
--
-- Adds three tables backing the /recovery dashboard:
--   recovery_baselines    — locked pre-October baseline per brand (UNIQUE per brand).
--                            Admin-write-only.
--   recovery_initiatives  — manually logged recovery work, brand-scoped.
--                            Admin-or-brand-access write.
--   recovery_snapshots    — nightly daily roll-up per brand. UNIQUE (brand_id, snapshot_date).
--                            Service-role-write-only (RLS denies non-admin writes; worker
--                            bypasses RLS via service_role).
--
-- All three follow Pattern A (brand_id NOT NULL, NOT NULL FK to brands(id)).
-- See `.local/recovery-pack-amendments.md` Sections C and D for the deviations
-- from the original sprint pack:
--   - locked_by / created_by reference user_profiles(user_id), not (id).
--   - GSC and GA4 columns ship NULLABLE (no ingestion yet).
--   - recovery_snapshots gains gap_to_baseline_top10_pct as the rankings-based
--     headline metric until GSC ships.

begin;

----------------------------------------------------------------------
-- 1. recovery_baselines  (one row per brand)
----------------------------------------------------------------------
create table if not exists public.recovery_baselines (
  id                              uuid primary key default gen_random_uuid(),
  brand_id                        uuid not null unique
                                    references public.brands(id) on delete restrict,
  baseline_date                   date not null,
  methodology                     text not null default '30d_rolling_avg',

  -- Locked baseline values (computed at lock time, then immutable).
  -- GSC + GA4 are nullable: ingestion is deferred to a future sprint.
  baseline_gsc_clicks_daily       numeric,
  baseline_ga4_sessions_daily     numeric,
  baseline_avg_position           numeric not null,
  baseline_keywords_in_top_10     integer not null,
  baseline_keywords_in_top_3      integer not null,

  -- Recovery target.
  recovery_threshold_pct          numeric not null default 100,
  recovery_consecutive_days       integer not null default 60,

  locked_at                       timestamptz not null default now(),
  locked_by                       uuid not null
                                    references public.user_profiles(user_id) on delete restrict,
  notes                           text
);

create index if not exists recovery_baselines_brand_id_idx
  on public.recovery_baselines (brand_id);

----------------------------------------------------------------------
-- 2. recovery_initiatives  (brand-scoped, manually logged)
----------------------------------------------------------------------
create table if not exists public.recovery_initiatives (
  id                          uuid primary key default gen_random_uuid(),
  brand_id                    uuid not null
                                references public.brands(id) on delete restrict,

  name                        text not null,
  type                        text not null
    check (type in ('content_refresh','content_kill','content_consolidation',
                    'technical_fix','link_building','quality_gate','other')),
  description                 text,

  expected_impact_pct         numeric,
  expected_impact_clicks      integer,

  started_at                  timestamptz not null,
  completed_at                timestamptz,
  status                      text not null default 'active'
    check (status in ('active','completed','abandoned')),

  actual_impact_clicks_14d    integer,

  created_by                  uuid not null
                                references public.user_profiles(user_id) on delete restrict,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists recovery_initiatives_brand_status_started_idx
  on public.recovery_initiatives (brand_id, status, started_at desc);
create index if not exists recovery_initiatives_brand_id_idx
  on public.recovery_initiatives (brand_id);

----------------------------------------------------------------------
-- 3. recovery_snapshots  (brand-scoped, nightly worker write)
----------------------------------------------------------------------
create table if not exists public.recovery_snapshots (
  id                              uuid primary key default gen_random_uuid(),
  brand_id                        uuid not null
                                    references public.brands(id) on delete restrict,
  snapshot_date                   date not null,

  -- 30d rolling averages ending on snapshot_date.
  -- GSC/GA4 nullable until ingestion ships.
  gsc_clicks_30d_avg              numeric,
  ga4_sessions_30d_avg            numeric,
  avg_position_30d                numeric not null,
  keywords_in_top_10              integer not null,
  keywords_in_top_3               integer not null,

  -- Computed deltas vs baseline.
  gap_to_baseline_clicks_pct      numeric,
  gap_to_baseline_position        numeric,
  -- Rankings-based headline metric (amendments §D.4): the burn-down chart
  -- projects on this. Switches to clicks-based once GSC ingestion lands.
  gap_to_baseline_top10_pct       numeric,

  computed_at                     timestamptz not null default now(),

  constraint recovery_snapshots_brand_date_uq unique (brand_id, snapshot_date)
);

create index if not exists recovery_snapshots_brand_date_idx
  on public.recovery_snapshots (brand_id, snapshot_date desc);
create index if not exists recovery_snapshots_brand_id_idx
  on public.recovery_snapshots (brand_id);

----------------------------------------------------------------------
-- 4. updated_at trigger for recovery_initiatives.
----------------------------------------------------------------------
create or replace function public.recovery_initiatives_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists recovery_initiatives_set_updated_at_trg
  on public.recovery_initiatives;
create trigger recovery_initiatives_set_updated_at_trg
  before update on public.recovery_initiatives
  for each row execute function public.recovery_initiatives_set_updated_at();

----------------------------------------------------------------------
-- 5. RLS policies.
--
-- recovery_baselines:
--   SELECT  — admin OR brand_id ∈ caller's brand_access
--   INSERT/UPDATE/DELETE — admin only. Service layer is responsible for
--                          writing a paired audit_log row at lock time.
--
-- recovery_initiatives:
--   SELECT  — admin OR brand_access
--   INSERT/UPDATE/DELETE — admin OR (editor with brand_access). The
--     pack's "admin or lead" wording maps to the existing role enum:
--     `lead` does not exist; pod leads carry `editor` role. Writers /
--     strategists / analysts get read-only on initiatives. Service
--     layer (Prompt 11) layers any additional gating on top.
--
-- recovery_snapshots:
--   SELECT  — admin OR brand_access
--   INSERT/UPDATE/DELETE — admin only. Worker writes via service_role
--                          which bypasses RLS entirely.
----------------------------------------------------------------------
-- Helper: admin OR caller has `editor` role AND brand_id is in their
-- brand_access. SECURITY DEFINER so it can read user_profiles regardless
-- of caller's RLS visibility on that table.
create or replace function public.is_admin_or_editor_for_brand(target_brand uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (
        select 1
          from public.user_profiles
         where user_id = auth.uid()
           and role = 'editor'::public.app_user_role
           and target_brand = any(brand_access)
      );
$$;

do $$
declare
  read_pred       text := 'public.is_admin() or brand_id = any(public.current_user_brand_access())';
  admin_pred      text := 'public.is_admin()';
  initiative_pred text := 'public.is_admin_or_editor_for_brand(brand_id)';
  t text;
begin
  ----- recovery_baselines: read = standard, write = admin-only -----
  alter table public.recovery_baselines enable row level security;

  drop policy if exists recovery_baselines_select on public.recovery_baselines;
  drop policy if exists recovery_baselines_insert on public.recovery_baselines;
  drop policy if exists recovery_baselines_update on public.recovery_baselines;
  drop policy if exists recovery_baselines_delete on public.recovery_baselines;

  execute format(
    'create policy recovery_baselines_select on public.recovery_baselines for select using (%s)',
    read_pred);
  execute format(
    'create policy recovery_baselines_insert on public.recovery_baselines for insert with check (%s)',
    admin_pred);
  execute format(
    'create policy recovery_baselines_update on public.recovery_baselines for update using (%s) with check (%s)',
    admin_pred, admin_pred);
  execute format(
    'create policy recovery_baselines_delete on public.recovery_baselines for delete using (%s)',
    admin_pred);

  ----- recovery_initiatives: standard read+write -----
  alter table public.recovery_initiatives enable row level security;

  drop policy if exists recovery_initiatives_select on public.recovery_initiatives;
  drop policy if exists recovery_initiatives_insert on public.recovery_initiatives;
  drop policy if exists recovery_initiatives_update on public.recovery_initiatives;
  drop policy if exists recovery_initiatives_delete on public.recovery_initiatives;

  execute format(
    'create policy recovery_initiatives_select on public.recovery_initiatives for select using (%s)',
    read_pred);
  execute format(
    'create policy recovery_initiatives_insert on public.recovery_initiatives for insert with check (%s)',
    initiative_pred);
  execute format(
    'create policy recovery_initiatives_update on public.recovery_initiatives for update using (%s) with check (%s)',
    initiative_pred, initiative_pred);
  execute format(
    'create policy recovery_initiatives_delete on public.recovery_initiatives for delete using (%s)',
    initiative_pred);

  ----- recovery_snapshots: read = standard, write = admin-only (worker uses service_role) -----
  alter table public.recovery_snapshots enable row level security;

  drop policy if exists recovery_snapshots_select on public.recovery_snapshots;
  drop policy if exists recovery_snapshots_insert on public.recovery_snapshots;
  drop policy if exists recovery_snapshots_update on public.recovery_snapshots;
  drop policy if exists recovery_snapshots_delete on public.recovery_snapshots;

  execute format(
    'create policy recovery_snapshots_select on public.recovery_snapshots for select using (%s)',
    read_pred);
  execute format(
    'create policy recovery_snapshots_insert on public.recovery_snapshots for insert with check (%s)',
    admin_pred);
  execute format(
    'create policy recovery_snapshots_update on public.recovery_snapshots for update using (%s) with check (%s)',
    admin_pred, admin_pred);
  execute format(
    'create policy recovery_snapshots_delete on public.recovery_snapshots for delete using (%s)',
    admin_pred);
end $$;

commit;

-- Smoke checks (run after commit):
-- select table_name from information_schema.tables
--   where table_schema='public'
--     and table_name in ('recovery_baselines','recovery_initiatives','recovery_snapshots');
-- select polname, polcmd from pg_policies where schemaname='public'
--   and tablename like 'recovery_%' order by tablename, polname;
