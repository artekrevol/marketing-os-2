-- Sprint 3 — Quality Gate Part 1.
--
-- Adds the six quality-gate tables, brand-derive triggers, RLS policies,
-- and seeds 16 rows of qa_check_definitions (4 brands × 4 checks).
--
-- All Pattern A (brand-scoped, NOT NULL brand_id, RLS enabled). Tables:
--   content_objects        — reviewable artifact lifecycle
--   qa_runs                — one row per submission's automated check pass
--   qa_check_results       — per-check pass/fail/error rows
--   qa_signoffs            — reviewer approve/reject record
--   qa_overrides           — admin/editor manual override of a hard fail
--   qa_check_definitions   — per-brand thresholds & enabled flags

begin;

----------------------------------------------------------------------
-- 1. content_objects
----------------------------------------------------------------------
create table if not exists public.content_objects (
  id                uuid primary key default gen_random_uuid(),
  brand_id          uuid not null references public.brands(id) on delete restrict,
  project_id        uuid not null references public.projects(id) on delete cascade,
  draft_id          uuid,
  title             text not null default '',
  body_md           text not null default '',
  word_count        integer not null default 0,
  status            text not null default 'drafting'
    check (status in ('drafting','submitted','in_review','approved','rejected')),
  submitted_at      timestamptz,
  submitted_by      uuid references auth.users(id) on delete set null,
  decided_at        timestamptz,
  decided_by        uuid references auth.users(id) on delete set null,
  decision_comment  text,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists content_objects_brand_status_idx
  on public.content_objects (brand_id, status, submitted_at desc);
create index if not exists content_objects_project_idx
  on public.content_objects (project_id);
create index if not exists content_objects_brand_id_idx
  on public.content_objects (brand_id);

----------------------------------------------------------------------
-- 2. qa_runs
----------------------------------------------------------------------
create table if not exists public.qa_runs (
  id                  uuid primary key default gen_random_uuid(),
  brand_id            uuid not null references public.brands(id) on delete restrict,
  content_object_id   uuid not null references public.content_objects(id) on delete cascade,
  status              text not null default 'queued'
    check (status in ('queued','running','passed','failed','error')),
  triggered_by        uuid references auth.users(id) on delete set null,
  started_at          timestamptz,
  completed_at        timestamptz,
  duration_ms         integer,
  summary             jsonb not null default '{}'::jsonb,
  error_message       text,
  created_at          timestamptz not null default now()
);

create index if not exists qa_runs_content_object_idx
  on public.qa_runs (content_object_id, created_at desc);
create index if not exists qa_runs_brand_status_idx
  on public.qa_runs (brand_id, status, created_at desc);
create index if not exists qa_runs_brand_id_idx on public.qa_runs (brand_id);

----------------------------------------------------------------------
-- 3. qa_check_results
----------------------------------------------------------------------
create table if not exists public.qa_check_results (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references public.brands(id) on delete restrict,
  qa_run_id     uuid not null references public.qa_runs(id) on delete cascade,
  check_name    text not null,
  severity      text not null check (severity in ('hard','warn')),
  outcome       text not null check (outcome in ('pass','fail','error')),
  score         numeric(10,4),
  threshold     numeric(10,4),
  summary       text,
  details       jsonb not null default '{}'::jsonb,
  duration_ms   integer,
  completed_at  timestamptz not null default now()
);

create index if not exists qa_check_results_run_idx on public.qa_check_results (qa_run_id);
create index if not exists qa_check_results_check_idx
  on public.qa_check_results (check_name, outcome);
create index if not exists qa_check_results_brand_id_idx
  on public.qa_check_results (brand_id);

----------------------------------------------------------------------
-- 4. qa_signoffs
----------------------------------------------------------------------
create table if not exists public.qa_signoffs (
  id                  uuid primary key default gen_random_uuid(),
  brand_id            uuid not null references public.brands(id) on delete restrict,
  content_object_id   uuid not null references public.content_objects(id) on delete cascade,
  reviewer_id         uuid not null references auth.users(id) on delete restrict,
  decision            text not null check (decision in ('approved','rejected')),
  comment             text,
  created_at          timestamptz not null default now(),
  -- 'rejected' must include a non-empty comment.
  constraint qa_signoffs_reject_comment_chk
    check (decision <> 'rejected' or (comment is not null and length(trim(comment)) > 0))
);

create index if not exists qa_signoffs_content_object_idx
  on public.qa_signoffs (content_object_id, created_at desc);
create index if not exists qa_signoffs_brand_id_idx on public.qa_signoffs (brand_id);

----------------------------------------------------------------------
-- 5. qa_overrides
----------------------------------------------------------------------
create table if not exists public.qa_overrides (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references public.brands(id) on delete restrict,
  qa_run_id       uuid not null references public.qa_runs(id) on delete cascade,
  check_name      text not null,
  overridden_by   uuid not null references auth.users(id) on delete restrict,
  justification   text not null check (length(trim(justification)) > 0),
  created_at      timestamptz not null default now()
);

create index if not exists qa_overrides_run_idx on public.qa_overrides (qa_run_id);
create index if not exists qa_overrides_brand_id_idx on public.qa_overrides (brand_id);

----------------------------------------------------------------------
-- 6. qa_check_definitions  (per-brand thresholds)
----------------------------------------------------------------------
create table if not exists public.qa_check_definitions (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references public.brands(id) on delete cascade,
  check_name   text not null,
  severity     text not null check (severity in ('hard','warn')),
  threshold    numeric(10,4),
  enabled      boolean not null default true,
  config       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint qa_check_definitions_brand_name_uq unique (brand_id, check_name)
);

create index if not exists qa_check_definitions_brand_id_idx
  on public.qa_check_definitions (brand_id);

----------------------------------------------------------------------
-- 7. Brand-derive triggers (uses Sprint 1 tenant_brand_inherit()).
--    Each child table inherits brand_id from project_id when present,
--    or the caller's first brand_access entry as fallback.
----------------------------------------------------------------------
do $$
declare
  t text;
  qa_tables text[] := array[
    'content_objects','qa_runs','qa_check_results',
    'qa_signoffs','qa_overrides','qa_check_definitions'
  ];
begin
  foreach t in array qa_tables loop
    execute format('drop trigger if exists %I on public.%I',
      t || '_brand_inherit_trg', t);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.tenant_brand_inherit()',
      t || '_brand_inherit_trg', t
    );
  end loop;
end $$;

----------------------------------------------------------------------
-- 8. RLS — strict brand isolation.
----------------------------------------------------------------------
do $$
declare
  t text;
  qa_tables text[] := array[
    'content_objects','qa_runs','qa_check_results',
    'qa_signoffs','qa_overrides','qa_check_definitions'
  ];
  pred text;
begin
  foreach t in array qa_tables loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);

    pred := 'public.is_admin() or brand_id = any(public.current_user_brand_access())';

    execute format('create policy %I on public.%I for select using (%s)',
      t || '_select', t, pred);
    execute format('create policy %I on public.%I for insert with check (%s)',
      t || '_insert', t, pred);
    execute format('create policy %I on public.%I for update using (%s) with check (%s)',
      t || '_update', t, pred, pred);
    execute format('create policy %I on public.%I for delete using (%s)',
      t || '_delete', t, pred);
  end loop;
end $$;

----------------------------------------------------------------------
-- 9. Seed qa_check_definitions — 4 brands × 4 checks = 16 rows.
--    Hard-fail thresholds (originality.ai-score percent):
--      TekRevol, Reverto      = 20
--      ClaimShield, CensusFlow = 15
--    Warn thresholds:
--      reading-level.flesch-grade  target=9 (warns when |Δ| > 2)
--      brand-voice.confidence       min=0.70
--      brief-compliance.coverage    min=0.80
----------------------------------------------------------------------
insert into public.qa_check_definitions (brand_id, check_name, severity, threshold, enabled, config)
select b.id, c.check_name, c.severity, c.threshold, true, c.config
from public.brands b
cross join (
  values
    -- Hard fail thresholds vary per brand; resolved below.
    ('originality.ai-score',       'hard'::text, null::numeric, '{}'::jsonb),
    ('reading-level.flesch-grade', 'warn'::text, 9::numeric,    '{"tolerance":2}'::jsonb),
    ('brand-voice.confidence',     'warn'::text, 0.70::numeric, '{}'::jsonb),
    ('brief-compliance.coverage',  'warn'::text, 0.80::numeric, '{}'::jsonb)
) as c(check_name, severity, threshold, config)
on conflict (brand_id, check_name) do nothing;

-- Set brand-specific Originality thresholds (percent AI-score allowed).
update public.qa_check_definitions q
   set threshold = case b.slug
     when 'tekrevol'    then 20
     when 'reverto'     then 20
     when 'claimshield' then 15
     when 'censusflow'  then 15
   end
  from public.brands b
 where q.brand_id = b.id
   and q.check_name = 'originality.ai-score';

commit;

-- Smoke checks (run after commit):
-- select table_name from information_schema.tables where table_schema='public'
--   and table_name in ('content_objects','qa_runs','qa_check_results','qa_signoffs','qa_overrides','qa_check_definitions');
-- select b.slug, q.check_name, q.severity, q.threshold from public.qa_check_definitions q
--   join public.brands b on b.id = q.brand_id order by b.slug, q.check_name;
