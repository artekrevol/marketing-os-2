-- Sprint 3 — Quality Gate Part 1
--
-- 0005_quality_gate.sql attached the generic Sprint 1
-- `tenant_brand_inherit()` BEFORE INSERT trigger to qa_runs,
-- qa_check_results, qa_signoffs, qa_overrides, and qa_check_definitions.
-- Those tables have no `project_id`, so the generic trigger falls
-- back to the caller's first `brand_access` entry — which can
-- mis-attribute brand on any unscoped insert.
--
-- This migration replaces those triggers with parent-derived ones:
-- each QA child table inherits brand_id strictly from its declared
-- parent FK (content_objects.brand_id for qa_runs/qa_signoffs;
-- qa_runs.brand_id for qa_check_results/qa_overrides), and refuses
-- to write a row whose caller-supplied brand_id disagrees with the
-- parent. qa_check_definitions has brand_id in its unique constraint
-- and must always be supplied by the caller.
--
-- content_objects keeps the generic trigger because it has
-- project_id, which resolves correctly via the Sprint 1 chain.

drop trigger if exists qa_runs_brand_inherit_trg            on public.qa_runs;
drop trigger if exists qa_check_results_brand_inherit_trg   on public.qa_check_results;
drop trigger if exists qa_signoffs_brand_inherit_trg        on public.qa_signoffs;
drop trigger if exists qa_overrides_brand_inherit_trg       on public.qa_overrides;
drop trigger if exists qa_check_definitions_brand_inherit_trg on public.qa_check_definitions;

----------------------------------------------------------------------
-- qa_runs: parent = content_objects (via content_object_id).
----------------------------------------------------------------------
create or replace function public.qa_runs_brand_inherit()
returns trigger language plpgsql security definer set search_path = public as $$
declare parent_brand uuid;
begin
  select brand_id into parent_brand
    from public.content_objects where id = new.content_object_id;
  if parent_brand is null then
    raise exception 'qa_runs.brand_inherit: parent content_object % missing or has no brand_id',
      new.content_object_id;
  end if;
  if new.brand_id is null then
    new.brand_id := parent_brand;
  elsif new.brand_id <> parent_brand then
    raise exception 'qa_runs.brand_inherit: brand_id % does not match parent content_object brand_id %',
      new.brand_id, parent_brand;
  end if;
  return new;
end $$;

create trigger qa_runs_brand_inherit_trg
  before insert on public.qa_runs
  for each row execute function public.qa_runs_brand_inherit();

----------------------------------------------------------------------
-- qa_signoffs: parent = content_objects (via content_object_id).
----------------------------------------------------------------------
create or replace function public.qa_signoffs_brand_inherit()
returns trigger language plpgsql security definer set search_path = public as $$
declare parent_brand uuid;
begin
  select brand_id into parent_brand
    from public.content_objects where id = new.content_object_id;
  if parent_brand is null then
    raise exception 'qa_signoffs.brand_inherit: parent content_object % missing or has no brand_id',
      new.content_object_id;
  end if;
  if new.brand_id is null then
    new.brand_id := parent_brand;
  elsif new.brand_id <> parent_brand then
    raise exception 'qa_signoffs.brand_inherit: brand_id % does not match parent content_object brand_id %',
      new.brand_id, parent_brand;
  end if;
  return new;
end $$;

create trigger qa_signoffs_brand_inherit_trg
  before insert on public.qa_signoffs
  for each row execute function public.qa_signoffs_brand_inherit();

----------------------------------------------------------------------
-- qa_check_results: parent = qa_runs (via qa_run_id).
----------------------------------------------------------------------
create or replace function public.qa_check_results_brand_inherit()
returns trigger language plpgsql security definer set search_path = public as $$
declare parent_brand uuid;
begin
  select brand_id into parent_brand
    from public.qa_runs where id = new.qa_run_id;
  if parent_brand is null then
    raise exception 'qa_check_results.brand_inherit: parent qa_run % missing or has no brand_id',
      new.qa_run_id;
  end if;
  if new.brand_id is null then
    new.brand_id := parent_brand;
  elsif new.brand_id <> parent_brand then
    raise exception 'qa_check_results.brand_inherit: brand_id % does not match parent qa_run brand_id %',
      new.brand_id, parent_brand;
  end if;
  return new;
end $$;

create trigger qa_check_results_brand_inherit_trg
  before insert on public.qa_check_results
  for each row execute function public.qa_check_results_brand_inherit();

----------------------------------------------------------------------
-- qa_overrides: parent = qa_runs (via qa_run_id).
----------------------------------------------------------------------
create or replace function public.qa_overrides_brand_inherit()
returns trigger language plpgsql security definer set search_path = public as $$
declare parent_brand uuid;
begin
  select brand_id into parent_brand
    from public.qa_runs where id = new.qa_run_id;
  if parent_brand is null then
    raise exception 'qa_overrides.brand_inherit: parent qa_run % missing or has no brand_id',
      new.qa_run_id;
  end if;
  if new.brand_id is null then
    new.brand_id := parent_brand;
  elsif new.brand_id <> parent_brand then
    raise exception 'qa_overrides.brand_inherit: brand_id % does not match parent qa_run brand_id %',
      new.brand_id, parent_brand;
  end if;
  return new;
end $$;

create trigger qa_overrides_brand_inherit_trg
  before insert on public.qa_overrides
  for each row execute function public.qa_overrides_brand_inherit();

----------------------------------------------------------------------
-- qa_check_definitions: brand_id is part of (brand_id, check_name)
-- unique key; must always be supplied by the caller.
----------------------------------------------------------------------
create or replace function public.qa_check_definitions_brand_required()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.brand_id is null then
    raise exception 'qa_check_definitions.brand_id must be supplied by caller (no parent to derive from)';
  end if;
  return new;
end $$;

create trigger qa_check_definitions_brand_required_trg
  before insert on public.qa_check_definitions
  for each row execute function public.qa_check_definitions_brand_required();
