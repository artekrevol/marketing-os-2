# `@workspace/db`

Drizzle bindings for the Supabase schema, plus the worker's tenancy
helpers. Schema source-of-truth still lives in
`artifacts/insight-forge/supabase/migrations/*.sql`; the tables declared
here are the subset the worker reads or writes.

## `withBrandScope(brandId, fn)`

The worker uses the Supabase **service role** and therefore bypasses
RLS. To preserve tenant isolation we enforce brand scoping in code:

```ts
import { withBrandScope, assertBrandScope } from "@workspace/db";
import { projectsTable } from "@workspace/db/schema";

await withBrandScope(brandId, async ({ db, brandId }) => {
  // db is a Drizzle transaction with:
  //   set local row_security = off;
  //   select set_config('app.current_brand', brandId, true);

  const row = { brandId, topic: "Hello", contentType: "blog" };
  assertBrandScope(brandId, row); // throws on mismatch / missing brand_id
  await db.insert(projectsTable).values(row);
});
```

### Rules

1. Every read/write that touches a `BRAND_SCOPED_TABLES` member must
   happen inside `withBrandScope`.
2. Every insert/update against a brand-scoped table must call
   `assertBrandScope(scope.brandId, row)` first. Mismatched or missing
   `brand_id` throws synchronously.
3. Telemetry tables with nullable `brand_id` (`events`,
   `integration_call_log`, `dead_jobs`) are intentionally **not**
   brand-scoped — system writes happen outside `withBrandScope`.
4. Always pair `brandIdFilter(scope)` with `eq(table.brandId, scope.brandId)`
   on raw SQL queries; never hand-build the predicate from request input.

### Brand-scoped tables

The full list lives in `BRAND_SCOPED_TABLES` (`src/brand-scope.ts`).
Currently scoped:

- Sprint 1: `projects`, `drafts`, `outlines`, `research_findings`,
  `voice_library`, `fetched_pages`, `ai_calls`, `page_visits`,
  `topic_briefs`, `brand_personas`, `competitor_pages`,
  `keyword_lists`, `rank_snapshots`.
- Sprint 3 — Quality Gate: `content_objects`, `qa_runs`,
  `qa_check_results`, `qa_signoffs`, `qa_overrides`,
  `qa_check_definitions`.
- Recovery War Room (Pattern A, all three): `recovery_baselines`
  (UNIQUE per brand, admin-write-only via RLS), `recovery_initiatives`,
  `recovery_snapshots` (admin-write-only via RLS; worker writes via
  service_role).

### Adding a new brand-scoped table

1. Author the `pgTable(...)` in `src/schema/<name>.ts`.
2. Re-export it from `src/schema/index.ts`.
3. Add the **table name string** to `BRAND_SCOPED_TABLES` in
   `src/brand-scope.ts`.
4. Worker code that touches it now MUST go through `withBrandScope`.

## Migrations

Migrations are NOT applied by Drizzle in this repo — the source of
truth is `artifacts/insight-forge/supabase/migrations/*.sql`, applied
by hand to a Supabase preview branch by the operator. The Drizzle
schema must stay aligned with whatever has been applied; if you add a
column in SQL, mirror it here in the same PR.

## Running tests

```bash
DATABASE_URL=postgres://... pnpm --filter @workspace/db test
```

Tests auto-skip when `DATABASE_URL` is unset.
