-- Sprint 1 — Multi-brand foundation, migration 2 of 3.
--
-- Enable RLS and write per-table policies on every brand-scoped table.
-- Single strict policy shape: admin bypass OR brand_id ∈ caller's
-- brand_access[]. brand_id is NOT NULL on every brand-scoped table
-- (enforced in 0001 + tenant_brand_inherit() trigger), so there is no
-- NULL escape hatch.
--
-- The brands / events / audit_log / user_profiles tables get their own
-- policies tuned to their access shape.

begin;

----------------------------------------------------------------------
-- Brand-scoped tables — uniformly strict.
----------------------------------------------------------------------
do $$
declare
  t text;
  strict_tables text[] := array[
    'projects',
    'drafts','draft_scores','outlines','research_briefs',
    'proof_points','interview_answers',
    'voice_library','usage_logs',
    'playbook','playbook_sections','fetched_pages','page_events'
  ];
  pred text;
begin
  foreach t in array strict_tables loop
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
-- brands — readable by any authenticated user (so the switcher can
-- populate); writes are admin-only.
----------------------------------------------------------------------
alter table public.brands enable row level security;
drop policy if exists brands_select on public.brands;
drop policy if exists brands_admin_write on public.brands;
create policy brands_select on public.brands for select using (auth.uid() is not null);
create policy brands_admin_write on public.brands for all
  using (public.is_admin()) with check (public.is_admin());

----------------------------------------------------------------------
-- user_profiles — a user can read their own row; admins can read/write
-- anyone.
----------------------------------------------------------------------
alter table public.user_profiles enable row level security;
drop policy if exists user_profiles_self_select on public.user_profiles;
drop policy if exists user_profiles_admin_all on public.user_profiles;
create policy user_profiles_self_select on public.user_profiles for select
  using (user_id = auth.uid() or public.is_admin());
create policy user_profiles_admin_all on public.user_profiles for all
  using (public.is_admin()) with check (public.is_admin());

----------------------------------------------------------------------
-- events — any authenticated user can insert events scoped to a brand
-- they have access to (or null brand_id for global events). Read is
-- admin-only for now; later sprints can broaden.
----------------------------------------------------------------------
alter table public.events enable row level security;
drop policy if exists events_insert on public.events;
drop policy if exists events_admin_select on public.events;
create policy events_insert on public.events for insert with check (
  auth.uid() is not null
  and (
    brand_id is null
    or public.is_admin()
    or brand_id = any(public.current_user_brand_access())
  )
  and actor_id = auth.uid()
);
create policy events_admin_select on public.events for select
  using (public.is_admin() or actor_id = auth.uid());

----------------------------------------------------------------------
-- audit_log — admin-only insert and read.
----------------------------------------------------------------------
alter table public.audit_log enable row level security;
drop policy if exists audit_log_admin_insert on public.audit_log;
drop policy if exists audit_log_admin_select on public.audit_log;
create policy audit_log_admin_insert on public.audit_log for insert
  with check (public.is_admin() and actor_id = auth.uid());
create policy audit_log_admin_select on public.audit_log for select
  using (public.is_admin());

commit;
