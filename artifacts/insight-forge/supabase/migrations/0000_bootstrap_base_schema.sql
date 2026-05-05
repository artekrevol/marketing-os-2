-- Bootstrap: base schema originally created by Lovable Cloud.
--
-- This migration creates the tables and functions that existed in the original
-- Lovable-hosted Supabase project but were not in our own migration files.
-- It must run BEFORE migrations 0001–0009.
--
-- Safe to run on a fresh Supabase project. All statements are idempotent
-- (IF NOT EXISTS / OR REPLACE / ON CONFLICT DO NOTHING).

----------------------------------------------------------------------
-- 0. app_role enum + user_roles table (Lovable's bootstrap enum/table)
----------------------------------------------------------------------
do $$ begin
  create type public.app_role as enum ('admin', 'member');
exception when duplicate_object then null; end $$;

create table if not exists public.user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.app_role not null default 'member',
  created_at timestamptz not null default now(),
  constraint user_roles_user_role_uq unique (user_id, role)
);
create index if not exists user_roles_user_id_idx on public.user_roles (user_id);

----------------------------------------------------------------------
-- 1. projects  (root tenant table — brand_id added by 0001)
----------------------------------------------------------------------
create table if not exists public.projects (
  id                  uuid primary key default gen_random_uuid(),
  topic               text not null,
  content_type        text not null,
  mode                text not null default 'research',
  status              text not null default 'active',
  current_stage       integer not null default 0,
  created_by          uuid references auth.users(id) on delete set null,
  writer_id           uuid references auth.users(id) on delete set null,
  url                 text,
  keyword             text,
  keyword_cluster     jsonb,
  funnel_stage        text,
  pod                 text,
  company_domain      text,
  competitor_url      text,
  benchmark_url       text,
  playbook_version    integer,
  ai_proposed_brief   jsonb,
  brief_confirmed_at  timestamptz,
  brief_error         text,
  user_notes          text,
  user_overrides      jsonb,
  icps                integer[],
  brand_id            uuid,          -- NOT NULL enforced by 0001
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists projects_created_by_idx on public.projects (created_by);
create index if not exists projects_brand_id_idx   on public.projects (brand_id);

----------------------------------------------------------------------
-- 2. Child tables (project_id FK)
----------------------------------------------------------------------
create table if not exists public.drafts (
  id                              uuid primary key default gen_random_uuid(),
  project_id                      uuid not null references public.projects(id) on delete cascade,
  section_id                      text not null,
  section_heading                 text,
  content                         text,
  approved                        boolean,
  voice_match_score               numeric,
  voice_flags                     jsonb,
  dismissed_voice_flags           jsonb not null default '[]'::jsonb,
  review_questions                jsonb,
  citation_count                  integer,
  revision_count                  integer,
  ai_citation_readiness_score     numeric,
  atomic_chunks_count             integer,
  entity_density_score            numeric,
  schema_markup_recommendations   jsonb,
  last_edited_by                  uuid references auth.users(id) on delete set null,
  brand_id                        uuid,          -- NOT NULL enforced by 0001
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);
create index if not exists drafts_project_id_idx on public.drafts (project_id);
create index if not exists drafts_brand_id_idx   on public.drafts (brand_id);

create table if not exists public.draft_scores (
  id                              uuid primary key default gen_random_uuid(),
  project_id                      uuid not null unique references public.projects(id) on delete cascade,
  final_draft                     text,
  voice_match_score               numeric,
  originality_score               numeric,
  ai_citation_readiness_score     numeric,
  citation_completeness           numeric,
  atomic_chunks_count             integer,
  atomic_questions_count          integer,
  banned_phrase_count             integer,
  word_count                      integer,
  schema_markup_recommendations   jsonb,
  brand_id                        uuid,          -- NOT NULL enforced by 0001
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);
create index if not exists draft_scores_brand_id_idx on public.draft_scores (brand_id);

create table if not exists public.outlines (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null unique references public.projects(id) on delete cascade,
  h1               text,
  meta_description text,
  sections         jsonb,
  internal_links   jsonb,
  cta_placement    text,
  tone_reminder    text,
  locked_at        timestamptz,
  brand_id         uuid,          -- NOT NULL enforced by 0001
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists outlines_brand_id_idx on public.outlines (brand_id);

create table if not exists public.research_briefs (
  id                        uuid primary key default gen_random_uuid(),
  project_id                uuid not null unique references public.projects(id) on delete cascade,
  search_intent             jsonb,
  angle_inventory           jsonb,
  benchmark_teardown        jsonb,
  competitor_teardown       jsonb,
  synergy_map               jsonb,
  atomic_question_map       jsonb,
  entity_data_requirements  jsonb,
  conversion_signals        jsonb,
  ai_citation_landscape     jsonb,
  raw_output                text,
  approved_at               timestamptz,
  progress_stage            integer,
  progress_status           jsonb,
  progress_error            text,
  proof_points_status       text,
  sub_status                jsonb not null default '{}'::jsonb,
  brand_id                  uuid,          -- NOT NULL enforced by 0001
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index if not exists research_briefs_brand_id_idx on public.research_briefs (brand_id);

create table if not exists public.proof_points (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  claim               text not null,
  source_url          text,
  source_publication  text,
  publication_date    text,
  verification_status text,
  starred             boolean,
  brand_id            uuid,          -- NOT NULL enforced by 0001
  created_at          timestamptz not null default now()
);
create index if not exists proof_points_project_id_idx on public.proof_points (project_id);
create index if not exists proof_points_brand_id_idx   on public.proof_points (brand_id);

create table if not exists public.interview_answers (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  section_id text not null,
  question   text not null,
  answer     text,
  follow_up  text,
  brand_id   uuid,          -- NOT NULL enforced by 0001
  created_at timestamptz not null default now()
);
create index if not exists interview_answers_project_id_idx on public.interview_answers (project_id);
create index if not exists interview_answers_brand_id_idx   on public.interview_answers (brand_id);

----------------------------------------------------------------------
-- 3. Brand-optional tables (no required project_id FK)
----------------------------------------------------------------------
create table if not exists public.voice_library (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid references public.projects(id) on delete set null,
  writer_id         uuid references auth.users(id) on delete set null,
  original_ai_text  text not null,
  edited_human_text text not null,
  edit_type         text,
  brand_id          uuid,          -- NOT NULL enforced by 0001
  captured_at       timestamptz not null default now()
);
create index if not exists voice_library_brand_id_idx on public.voice_library (brand_id);

create table if not exists public.usage_logs (
  id                           uuid primary key default gen_random_uuid(),
  project_id                   uuid references public.projects(id) on delete set null,
  model                        text,
  stage                        text,
  sub_stage                    text,
  input_tokens                 integer,
  output_tokens                integer,
  cache_read_input_tokens      integer,
  cache_creation_input_tokens  integer,
  duration_ms                  integer,
  estimated_cost_usd           numeric,
  ok                           boolean,
  error                        text,
  metadata_user_id             uuid,
  brand_id                     uuid,
  created_at                   timestamptz not null default now()
);
create index if not exists usage_logs_brand_id_idx   on public.usage_logs (brand_id);
create index if not exists usage_logs_project_id_idx on public.usage_logs (project_id);

create table if not exists public.playbook (
  id               uuid primary key default gen_random_uuid(),
  version          integer not null default 1,
  content_markdown text not null,
  source_filename  text,
  uploaded_by      uuid references auth.users(id) on delete set null,
  brand_id         uuid,          -- NOT NULL enforced by 0001
  uploaded_at      timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
create index if not exists playbook_brand_id_idx on public.playbook (brand_id);

create table if not exists public.playbook_sections (
  id                     uuid primary key default gen_random_uuid(),
  version                integer not null,
  section_number         integer not null,
  section_title          text,
  section_content        text not null,
  section_token_estimate integer not null default 0,
  always_include         boolean not null default false,
  brand_id               uuid,          -- NOT NULL enforced by 0001
  created_at             timestamptz not null default now()
);
create index if not exists playbook_sections_brand_id_idx on public.playbook_sections (brand_id);

create table if not exists public.fetched_pages (
  id         uuid primary key default gen_random_uuid(),
  url        text not null,
  title      text,
  content    text not null,
  byte_size  integer,
  brand_id   uuid,          -- NOT NULL enforced by 0001
  fetched_at timestamptz not null default now()
);
create index if not exists fetched_pages_brand_id_idx on public.fetched_pages (brand_id);

create table if not exists public.page_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  path        text not null,
  project_id  uuid references public.projects(id) on delete set null,
  referrer    text,
  user_agent  text,
  user_email  text,
  duration_ms integer,
  brand_id    uuid,          -- NOT NULL enforced by 0001
  entered_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists page_events_brand_id_idx on public.page_events (brand_id);

----------------------------------------------------------------------
-- 4. Lovable helper functions
----------------------------------------------------------------------
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles where user_id = _user_id and role = _role
  );
$$;

create or replace function public.can_access_app(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select lower(coalesce((select email from auth.users where id = _user_id), '')) like '%@tekrevol.com'
    or exists (select 1 from public.user_roles where user_id = _user_id and role = 'admin');
$$;

create or replace function public.is_tekrevol_member(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select lower(coalesce((select email from auth.users where id = _user_id), '')) like '%@tekrevol.com';
$$;

create or replace function public.list_app_users()
returns table (
  user_id         uuid,
  email           text,
  created_at      timestamptz,
  last_sign_in_at timestamptz,
  is_admin        boolean,
  is_tekrevol     boolean,
  project_count   bigint
) language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;
  return query
    select u.id, u.email, u.created_at, u.last_sign_in_at,
      coalesce((select true from public.user_roles r where r.user_id = u.id and r.role = 'admin' limit 1), false),
      lower(coalesce(u.email,'')) like '%@tekrevol.com',
      coalesce((select count(*) from public.projects p where p.created_by = u.id), 0)::bigint
    from auth.users u
    order by u.created_at desc;
end;
$$;

create or replace function public.admin_usage_summary(
  _since timestamptz default now() - interval '30 days'
)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return (
    select jsonb_build_object(
      'total_cost_usd',      coalesce(sum(estimated_cost_usd), 0),
      'total_input_tokens',  coalesce(sum(input_tokens), 0),
      'total_output_tokens', coalesce(sum(output_tokens), 0),
      'call_count',          count(*)
    )
    from public.usage_logs
    where created_at >= _since
  );
end;
$$;

create or replace function public.admin_user_activity(
  _since timestamptz default now() - interval '30 days'
)
returns table (
  user_id      uuid,
  user_email   text,
  path         text,
  visits       bigint,
  avg_seconds  numeric,
  max_seconds  numeric,
  total_seconds numeric,
  last_seen    timestamptz
) language plpgsql security definer set search_path = public as $$
begin
  return query
    select
      pe.user_id, pe.user_email, pe.path,
      count(*),
      round(avg(coalesce(pe.duration_ms, 0)) / 1000.0, 1),
      round(max(coalesce(pe.duration_ms, 0)) / 1000.0, 1),
      round(sum(coalesce(pe.duration_ms, 0)) / 1000.0, 1),
      max(pe.entered_at)
    from public.page_events pe
    where pe.entered_at >= _since
    group by pe.user_id, pe.user_email, pe.path
    order by max(pe.entered_at) desc;
end;
$$;
