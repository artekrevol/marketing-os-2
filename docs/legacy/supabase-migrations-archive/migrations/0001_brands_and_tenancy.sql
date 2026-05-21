-- Sprint 1 — Multi-brand foundation, migration 1 of 3.
--
-- Creates the four-brand tenancy spine, the events + audit_log tables, the
-- user_profiles table (role/pod/brand_access), adds brand_id to every
-- brand-scoped table, backfills existing rows to TekRevol, then enforces
-- NOT NULL + foreign keys.
--
-- All in a single transaction so a partial failure rolls everything back.
-- Run on a Supabase preview branch first; do not push to prod blind.

begin;

----------------------------------------------------------------------
-- 1. brands
----------------------------------------------------------------------
create table if not exists public.brands (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  name          text not null,
  primary_domain text,
  voice_profile jsonb not null default '{}'::jsonb,
  thresholds    jsonb not null default '{}'::jsonb, -- e.g. {"originality_min":0.7,"reading_grade_target":9}
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

insert into public.brands (slug, name, primary_domain, thresholds)
values
  ('tekrevol',    'TekRevol',    'tekrevol.com',   '{"originality_min":0.70,"reading_grade_target":9}'::jsonb),
  ('claimshield', 'ClaimShield', 'claimshield.io', '{"originality_min":0.70,"reading_grade_target":9}'::jsonb),
  ('reverto',    'Reverto',     'reverto.com',    '{"originality_min":0.70,"reading_grade_target":9}'::jsonb),
  ('censusflow', 'CensusFlow',  'censusflow.com', '{"originality_min":0.70,"reading_grade_target":9}'::jsonb)
on conflict (slug) do nothing;

----------------------------------------------------------------------
-- 2. user_profiles — one row per auth.user with role/pod/brand_access.
--    Kept separate from user_roles (which stays as the legacy admin
--    flag table) so the migration is additive and reversible.
----------------------------------------------------------------------
do $$ begin
  create type public.app_user_role as enum ('admin','editor','writer','strategist','analyst');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.app_pod as enum ('content','technical','growth');
exception when duplicate_object then null; end $$;

create table if not exists public.user_profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  role         public.app_user_role not null default 'writer',
  pod          public.app_pod,
  brand_access uuid[] not null default '{}'::uuid[],
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists user_profiles_brand_access_gin on public.user_profiles using gin (brand_access);

-- Seed profiles for every existing auth user. Tekrevol users get the
-- TekRevol brand id so their projects keep loading post-RLS.
insert into public.user_profiles (user_id, role, brand_access)
select
  u.id,
  case
    when exists (select 1 from public.user_roles ur where ur.user_id = u.id and ur.role = 'admin') then 'admin'::public.app_user_role
    else 'writer'::public.app_user_role
  end,
  case
    when lower(coalesce(u.email,'')) like '%@tekrevol.com'
      then array[(select id from public.brands where slug='tekrevol')]
    else '{}'::uuid[]
  end
from auth.users u
on conflict (user_id) do nothing;

-- Trigger: auto-create profile on signup. Tekrevol email → TekRevol access.
create or replace function public.on_auth_user_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_profiles (user_id, role, brand_access)
  values (
    new.id,
    'writer'::public.app_user_role,
    case
      when lower(coalesce(new.email,'')) like '%@tekrevol.com'
        then array[(select id from public.brands where slug='tekrevol')]
      else '{}'::uuid[]
    end
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_trg on auth.users;
create trigger on_auth_user_created_trg
  after insert on auth.users
  for each row execute function public.on_auth_user_created();

----------------------------------------------------------------------
-- 3. events — append-only event log
----------------------------------------------------------------------
create table if not exists public.events (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid references public.brands(id) on delete set null,
  actor_id     uuid references auth.users(id) on delete set null,
  event_type   text not null,
  subject_type text,
  subject_id   text,
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists events_brand_created_idx on public.events (brand_id, created_at desc);
create index if not exists events_subject_idx       on public.events (subject_type, subject_id);

----------------------------------------------------------------------
-- 4. audit_log — admin-sensitive actions, justification required
----------------------------------------------------------------------
create table if not exists public.audit_log (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid references public.brands(id) on delete set null,
  actor_id      uuid references auth.users(id) on delete set null,
  action        text not null,
  target_type   text,
  target_id     text,
  justification text not null check (length(trim(justification)) > 0),
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_actor_idx   on public.audit_log (actor_id, created_at desc);

----------------------------------------------------------------------
-- 5. brand_id columns on brand-scoped tables.
--
-- Strategy: every brand-scoped table gets brand_id NOT NULL post-backfill
-- (Sprint 1 requirement: strict tenant isolation, no NULL escape hatch).
--   a) "tenant_root" (projects) — set by client.
--   b) "tenant_child" (everything else) — auto-filled by tenant_brand_inherit()
--      BEFORE INSERT trigger which:
--        1. returns NEW.brand_id if the caller already supplied it;
--        2. else inherits from the parent projects row via project_id;
--        3. else falls back to the caller's first brand_access entry from
--           user_profiles (lets writes that have no project_id — telemetry,
--           voice library captures, fetched pages — still land in the
--           writer's primary brand);
--        4. else raises so the row is never created without tenancy.
--   Backfill assigns existing rows to TekRevol so the NOT NULL flip is safe.
----------------------------------------------------------------------
do $$
declare
  tek uuid;
  t   text;
  tenant_root text[]     := array['projects'];
  tenant_child text[]    := array[
    'drafts','draft_scores','outlines','research_briefs',
    'proof_points','interview_answers',
    'voice_library','usage_logs',
    'playbook','playbook_sections','fetched_pages','page_events'
  ];
  tenant_optional text[] := array[]::text[];
  all_tables text[];
begin
  select id into tek from public.brands where slug = 'tekrevol';
  if tek is null then
    raise exception 'TekRevol brand not seeded — aborting';
  end if;

  all_tables := tenant_root || tenant_child || tenant_optional;

  foreach t in array all_tables loop
    execute format('alter table public.%I add column if not exists brand_id uuid', t);
    execute format('update public.%I set brand_id = $1 where brand_id is null', t) using tek;
    begin
      execute format(
        'alter table public.%I add constraint %I foreign key (brand_id) references public.brands(id) on delete restrict',
        t, t || '_brand_id_fkey'
      );
    exception when duplicate_object then null;
    end;
    execute format('create index if not exists %I on public.%I (brand_id)', t || '_brand_id_idx', t);
  end loop;

  -- NOT NULL only on root + child (child gets the trigger below).
  foreach t in array (tenant_root || tenant_child) loop
    execute format('alter table public.%I alter column brand_id set not null', t);
  end loop;
end $$;

-- Trigger: BEFORE INSERT on every brand-scoped child table. Resolution
-- order: (1) honour client-supplied brand_id; (2) inherit from parent
-- projects via project_id when present; (3) fall back to the caller's
-- first brand_access entry from user_profiles; (4) raise so no row
-- escapes without a brand. This makes brand_id NOT NULL safe to enforce
-- on tables whose existing insert paths don't yet thread brand_id
-- (voice_library, usage_logs, page_events, playbook, etc.).
create or replace function public.tenant_brand_inherit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  parent_brand uuid;
  fallback_brand uuid;
  has_pid boolean;
  pid uuid;
begin
  if new.brand_id is not null then
    return new;
  end if;

  -- Does this table have a project_id column?
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = tg_table_name
      and column_name  = 'project_id'
  ) into has_pid;

  if has_pid then
    execute format('select ($1).%I', 'project_id') into pid using new;
    if pid is not null then
      select brand_id into parent_brand from public.projects where id = pid;
      if parent_brand is not null then
        new.brand_id := parent_brand;
        return new;
      end if;
    end if;
  end if;

  -- Fall back to the caller's first brand_access entry. Skips if there
  -- is no auth.uid() (service-role inserts are expected to set brand_id
  -- explicitly).
  if auth.uid() is not null then
    select case when array_length(brand_access,1) > 0 then brand_access[1] else null end
      into fallback_brand
      from public.user_profiles
      where user_id = auth.uid();
    if fallback_brand is not null then
      new.brand_id := fallback_brand;
      return new;
    end if;
  end if;

  raise exception 'brand_id required on %.% — no parent project, no caller brand_access',
    tg_table_schema, tg_table_name;
end;
$$;

do $$
declare
  t text;
  -- Every brand-scoped child table gets the trigger; the function
  -- handles project_id presence/absence dynamically.
  child_tables text[] := array[
    'drafts','draft_scores','outlines','research_briefs',
    'proof_points','interview_answers',
    'voice_library','usage_logs',
    'playbook','playbook_sections','fetched_pages','page_events'
  ];
begin
  foreach t in array child_tables loop
    execute format('drop trigger if exists %I on public.%I', t || '_brand_inherit_trg', t);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.tenant_brand_inherit()',
      t || '_brand_inherit_trg', t
    );
  end loop;
end $$;

----------------------------------------------------------------------
-- 6. Helper functions used by RLS policies (defined here so 0002 can
--    reference them; SECURITY DEFINER so they bypass RLS on the
--    profile lookup itself).
----------------------------------------------------------------------
create or replace function public.current_user_brand_access()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(brand_access, '{}'::uuid[]) from public.user_profiles where user_id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'
  ) or exists (
    select 1 from public.user_profiles where user_id = auth.uid() and role = 'admin'
  );
$$;

----------------------------------------------------------------------
-- 7. list_app_users_v2 — superset of list_app_users with role / pod /
--    brand_access. Existing list_app_users is left intact so any cached
--    UI keeps working until the AdminUsers page switches over.
----------------------------------------------------------------------
create or replace function public.list_app_users_v2()
returns table (
  user_id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  is_admin boolean,
  is_tekrevol boolean,
  project_count bigint,
  role public.app_user_role,
  pod public.app_pod,
  brand_access uuid[]
) language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  return query
    select
      u.id,
      u.email,
      u.created_at,
      u.last_sign_in_at,
      coalesce((select true from public.user_roles ur where ur.user_id = u.id and ur.role = 'admin' limit 1), false),
      lower(coalesce(u.email,'')) like '%@tekrevol.com',
      coalesce((select count(*) from public.projects p where p.created_by = u.id), 0)::bigint,
      coalesce(up.role, 'writer'::public.app_user_role),
      up.pod,
      coalesce(up.brand_access, '{}'::uuid[])
    from auth.users u
    left join public.user_profiles up on up.user_id = u.id
    order by u.created_at desc;
end;
$$;

commit;
