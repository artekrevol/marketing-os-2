# Sprint 1 — Multi-brand foundation

Lays the multi-tenant data spine that every later SEO-OS service rides on.
Ships **no new user-facing services**: existing TekRevol flows are
unchanged, but the database is now able to host four brand tenants
(TekRevol, ClaimShield, Reverto, CensusFlow), expanded role/pod metadata,
an immutable event log, and an audit log.

## Migration order

All SQL lives in `artifacts/insight-forge/supabase/migrations/`. Apply on
a Supabase preview branch first; do not push to prod blind.

1. `0001_brands_and_tenancy.sql` — creates `brands`, `user_profiles`,
   `events`, `audit_log`; seeds the four brands; adds `brand_id` to every
   brand-scoped table; backfills existing rows to TekRevol. Two tenancy
   classes — **every brand-scoped table is `brand_id NOT NULL`**, no
   NULL escape hatch:
   - **Root** (`projects`) — `brand_id NOT NULL`, set by the client.
   - **Child** (everything else: `drafts`, `draft_scores`, `outlines`,
     `research_briefs`, `proof_points`, `interview_answers`,
     `voice_library`, `usage_logs`, `playbook`, `playbook_sections`,
     `fetched_pages`, `page_events`) — `brand_id NOT NULL`, auto-filled
     by the `tenant_brand_inherit()` `BEFORE INSERT` trigger which
     resolves brand in this order: (1) caller-supplied `brand_id`;
     (2) parent `projects.brand_id` via `project_id` when present;
     (3) caller's first `user_profiles.brand_access` entry; else raises.
     This keeps existing insert paths working without threading
     `brand_id` while guaranteeing tenancy on every row.

   Also adds the `current_user_brand_access()` and `is_admin()` helper
   functions and the `on_auth_user_created` trigger.
2. `0002_rls_policies.sql` — enables RLS on every brand-scoped table
   with a single strict predicate:
   `is_admin() OR brand_id = ANY(current_user_brand_access())`.
   No `brand_id IS NULL` clause — strict isolation across all 13
   brand-scoped tables.
3. `0003_pen_check.sql` — manual penetration test script. Read-only —
   commented out by default. Run it interactively in the SQL editor
   after a ClaimShield-only test user exists.

After applying 0001+0002 to a Supabase project, regenerate
`src/integrations/supabase/types.ts` from the dashboard so TypeScript
picks up the new tables.

## Brand context

`src/lib/brands.tsx` exposes a `BrandProvider` and `useActiveBrand()`
hook. The provider:

- Loads `brands` and the caller's `user_profiles.brand_access` row.
- Picks an active brand from `localStorage["contentforge.activeBrandSlug"]`
  if it's still accessible, else the first accessible brand.
- Exposes `accessible` (the brands the user can see), `activeBrand`,
  `setActiveBrand`, and `isAdmin`.

The brand switcher renders in the AppShell top bar — a dropdown for
multi-brand users, a static label for single-brand users, hidden when
signed-out.

## Audit + event helpers

- `src/lib/events.ts → emit(eventType, subjectType, subjectId, payload, brandId?)`
  — fire-and-forget; convention is `snake_case.<verb>` (e.g. `project.created`).
- `src/lib/audit.ts → recordAudit(action, targetType, targetId, justification, metadata?, brandId?)`
  — admin-only; the DB enforces non-empty justification with a check
  constraint. Returns `{ ok: false, error }` if the user blanks the
  justification.

Both helpers degrade silently on RLS denial — they log to console but
never throw.

## Adding a new brand

1. Insert into `public.brands (slug, name, primary_domain, voice_profile, thresholds)`
   from the SQL editor (or, eventually, from `/admin/brands`).
2. The new brand becomes selectable on `/admin/users` for any user.
3. Grant a user `brand_access = ARRAY[<brand_id>]` via `/admin/users`.
4. The user's next sign-in shows the new brand in the switcher.

## Inviting a cross-brand user

1. The user creates an account via Google OAuth (any domain) or email +
   password — the auth-state hook in `AppShell.tsx` will mark them
   `blocked` until they have brand access or admin role.
2. An admin opens `/admin/users`, finds the new row, and assigns a role,
   pod, and the brand(s) they should see. A justification is required.
3. The user signs out and back in to refresh their JWT claims (Supabase
   Auth).

## Reading the audit log

- Direct SQL in the Supabase dashboard: `select * from public.audit_log order by created_at desc limit 100;`
- A future sprint will land the `/admin/audit` page; for Sprint 1 the
  table is populated but not yet rendered.

## Rollback plan

If a migration goes wrong on production:

1. **Before NOT NULL**: drop the `brand_id` columns and re-run from
   scratch on the preview branch.
2. **After NOT NULL**: every brand-scoped table is strictly
   `brand_id NOT NULL` and RLS is strict, so nullifying values is not a
   safe rollback. Instead, drop the per-table policies (admins still see
   everything via service role / superuser), then drop the trigger and
   the NOT NULL constraints in that order. Re-apply on the next attempt.
3. **RLS lockout**: a superuser can `alter table <t> disable row level security;`
   in the SQL editor to restore unrestricted access while you debug.
