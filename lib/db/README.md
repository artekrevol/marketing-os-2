# `@workspace/db`

Drizzle schema for the platform Postgres DB (Replit-managed), plus the
brand-tenancy enforcement helpers used by the API server and worker.

## `withBrandScope(brandId, fn)`

Tenancy is enforced **in application code** — there is no Postgres RLS
and there are no row-level triggers in production. Every read or write
against a brand-scoped table must happen through `ScopedDb`, which
automatically applies `brand_id = scope.brandId` and rejects cross-brand
inserts/updates with `BrandScopeViolationError`.

```ts
import { withBrandScope, assertBrandScope } from "@workspace/db";
import { projectsTable } from "@workspace/db/schema";

await withBrandScope(brandId, async ({ db, brandId }) => {
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
3. Telemetry rows in `events`, `audit_log`, and `integration_call_log` are
   either brand-scoped (`brand_id` required) or explicitly global
   (`scope = 'global'` with no brand). `usage_logs.brand_id` is always
   required. System writes happen outside `withBrandScope`.
4. Always pair `brandIdFilter(scope)` with `eq(table.brandId, scope.brandId)`
   on raw SQL queries; never hand-build the predicate from request input.

### Brand-scoped tables

The full list lives in `BRAND_SCOPED_TABLES` (`src/brand-scope.ts`).

### Adding a new brand-scoped table

1. Author the `pgTable(...)` in `src/schema/<name>.ts`.
2. Re-export it from `src/schema/index.ts`.
3. Add the **table name string** to `BRAND_SCOPED_TABLES` in
   `src/brand-scope.ts`.
4. Worker code that touches it now MUST go through `withBrandScope`.

## Migrations

Drizzle is the single source of truth for the schema. To apply schema
changes to dev:

```bash
pnpm --filter @workspace/db run push
```

For production, run the same `push` against the prod `DATABASE_URL` from
a controlled environment (see the deployment skill). Do **not** patch
the schema from the API server boot path — schema patches belong in
Drizzle migrations only.

The legacy Supabase migration SQL has been archived under
`docs/legacy/supabase-migrations-archive/` for historical reference. It
is no longer applied to any environment.

## Running tests

```bash
DATABASE_URL=postgres://... pnpm --filter @workspace/db test
```

Tests auto-skip when `DATABASE_URL` is unset.
