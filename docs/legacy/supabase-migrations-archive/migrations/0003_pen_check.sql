-- Sprint 1 — Multi-brand foundation, migration 3 of 3.
--
-- Manual penetration test. Do NOT run as part of the schema apply — run
-- it interactively in the Supabase SQL editor *after* 0001 + 0002.
--
-- How to use:
--   1. Sign in as a non-admin ClaimShield-only user via the app once so
--      a row exists in user_profiles for them. Grant them brand_access
--      to ClaimShield only via the /admin/users editor.
--   2. In the SQL editor, switch the role to that user with:
--        select set_config('request.jwt.claim.sub', '<their auth.users.id>', true);
--        set role authenticated;
--   3. Run each section below. The "PASS" lines must all return zero
--      rows except where noted.

-- 3a. Cross-brand denial: ClaimShield-only user must see zero TekRevol
--     projects.
-- expected: 0 rows
-- select count(*) as tekrevol_visible from public.projects
--   where brand_id = (select id from public.brands where slug = 'tekrevol');

-- 3b. Same-brand visibility: ClaimShield-only user must see ClaimShield
--     projects (will be 0 until ClaimShield content is created).
-- select count(*) as claimshield_visible from public.projects
--   where brand_id = (select id from public.brands where slug = 'claimshield');

-- 3c. Insert blocked: attempt to create a project tagged to a brand the
--     user does not have access to. Must error with an RLS violation.
-- insert into public.projects (topic, content_type, brand_id)
-- values ('pen-check', 'blog', (select id from public.brands where slug='tekrevol'));

-- 3d. Audit log writes blocked for non-admin.
-- insert into public.audit_log (action, justification) values ('test','should fail');

-- 3e. Admin path: switch back to your admin account and confirm
--     is_admin() returns true and current_user_brand_access() returns
--     the expected uuid[].
-- select public.is_admin(), public.current_user_brand_access();

-- Reset:
--   reset role;
