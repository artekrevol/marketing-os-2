# Pre-Deploy Checklist

Run these steps before every `Publish` / `Deploy` action on the platform.

---

## Step 0 — Schema smoke tests (automated)

Run the schema smoke tests to catch insert-type regressions **before** touching the database:

```bash
pnpm run validate
```

This runs two checks in sequence:

1. **Compile-time type assertions** (`pnpm run typecheck:libs && tsc --noEmit --project lib/db/tsconfig.test.json`):
   Every brand-scoped table's `$inferInsert` type is asserted to require `brandId` and all other
   NOT NULL / no-default columns. If a column's nullability changes in the schema file, the
   TypeScript compiler errors out immediately — before any SQL reaches the database.

2. **Zod runtime validation** (`vitest run` in `@workspace/db`):
   `drizzle-zod`'s `createInsertSchema` generates a live Zod schema from each Drizzle table
   definition. The test suite verifies that:
   - Inserting without `brand_id` fails Zod validation for all 16 brand-scoped tables.
   - A minimal valid insert (only the required columns) parses successfully.
   - Tables with intentionally nullable `brand_id` (events, audit_log, usage_logs,
     integration_call_log) correctly allow cross-brand writes.

**What this catches:**

| Schema change | How caught |
|---|---|
| `brandId` changed from `.notNull()` to nullable | TypeScript compile error + Zod no longer flags missing `brandId` |
| New NOT NULL column added without default | TypeScript compile error (minimal insert missing the new field) |
| Column type changed (e.g. `uuid` → `text`) | TypeScript compile error on the typed constant |
| Required column accidentally given `.default()` | Zod no longer reports it as required (test catches the gap) |

Test file: `lib/db/test/schema-smoke.test.ts`

---

## Step 1 — Schema diff review

Run the Drizzle push in dry-run mode to preview what the migration would do:

```bash
pnpm --filter @workspace/db run push
```

Review every generated SQL statement:

| SQL pattern | Required action |
|---|---|
| `ALTER TABLE … ADD COLUMN … NOT NULL` | Confirm the inserting route always supplies that column. If it can be missing, add a default or drop the NOT NULL via a boot migration. |
| `ALTER TABLE … DROP NOT NULL` | Add an idempotent boot migration in `artifacts/api-server/src/index.ts` (see existing `runBootMigrations()` examples). |
| `ALTER TABLE … ALTER COLUMN … TYPE …` | Check every route that reads or writes that column; handle both old and new types for the rolling deploy window. |
| `DROP COLUMN` | Check all routes; never drop a column used by a live frontend without a code-first deploy that stops reading it. |

---

## Step 2 — Production DB column sanity check

After deploying, query `information_schema.columns` for every table you modified:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = '<your_table>'
ORDER BY ordinal_position;
```

Confirm:
- Column exists with the correct `data_type`
- `is_nullable` matches what the Drizzle schema expects (`YES` = nullable, `NO` = `.notNull()`)
- `column_default` matches any `.default(...)` call in the schema

---

## Step 3 — Route serialization check

Grep for raw Drizzle row spreads:

```bash
grep -rn "res\.json(.*\.\.\." artifacts/api-server/src/routes/
grep -rn "res\.json(row" artifacts/api-server/src/routes/
```

For each hit, confirm the consuming frontend reads the right field names:

| Route class | Field naming | Action needed |
|---|---|---|
| Routes covered by OpenAPI spec + Orval codegen | camelCase is fine — generated hooks handle it | None |
| Manually written routes (not in `lib/api-spec/openapi.yaml`) | Must be snake_case if the frontend reads snake_case keys directly | Map explicitly |

**Routes in the OpenAPI spec** (Orval-generated hooks, camelCase safe):
- `GET/POST /api/quality-gate/*`
- `GET/POST/PUT /api/recovery/*`
- `GET/POST /api/admin/system/*`
- `GET /api/healthz`

**Routes NOT in the OpenAPI spec** (manually written — must use explicit snake_case mapping):
- `GET /api/projects` and all sub-routes → uses `projectToSnake()` helper ✓
- `GET /api/brands` → explicit snake_case mapping ✓
- `GET /api/admin/users` → explicit snake_case mapping ✓
- `GET /api/admin/playbook` → explicit snake_case mapping ✓
- `GET /api/admin/activity` → explicit snake_case mapping ✓
- `GET /api/admin/usage` → explicit snake_case mapping ✓
- `GET /api/admin/dashboard` → explicit snake_case mapping via `voiceMapped` + per-field project/scores mapping ✓

---

## Step 4 — Boot migration check

Open `artifacts/api-server/src/index.ts` and read `runBootMigrations()`.

For any NOT NULL constraint that exists in production but is absent (or wrong) in the Drizzle schema, an idempotent SQL snippet must be present here. Current boot migrations:

- `playbook.brand_id` → nullable (idempotent `ALTER TABLE … ALTER COLUMN … DROP NOT NULL IF EXISTS`)
- `playbook_sections.brand_id` → nullable

If you add a new column with a NOT NULL constraint to Drizzle that doesn't have a matching constraint in production, either:
- Add a boot migration to add the constraint, or
- Confirm the column already exists as NOT NULL in production from a previous migration

---

## Step 5 — Smoke test on the production URL

After the publish completes, run at minimum:

1. **Auth**: Log in at the root URL; confirm `GET /api/me` returns `{ userId, role, brands }` with no 500.
2. **The specific flow touched by this deploy**: End-to-end from the UI.
3. **Any adjacent flow sharing the same tables**: e.g., drafting + final-stitch if you touched the drafts schema.

Minimum E2E flows by deploy area:

| Changed area | Required smoke flows |
|---|---|
| `lib/db/src/schema/drafts.ts` | Draft a section → verify content appears; final-stitch → verify draft score saved |
| `lib/db/src/schema/content-objects.ts` | Submit for review → verify status = `submitted`; reviewer approve → verify `decided_by` saved |
| `lib/db/src/schema/proof-points.ts` | Run research-generate job → verify proof points appear in project |
| `artifacts/api-server/src/routes/admin.ts` | Load admin dashboard → verify all cards render without 500 |
| `lib/services-recovery/*` | Open Recovery War Room → overview + snapshots + initiatives load |

---

## Step 6 — Check production logs within 2 minutes of publish

Search deployment logs for:

```
ERROR
500
constraint
null value in column
invalid input syntax
```

A clean boot looks like:

```
boot-migration: playbook.brand_id is now nullable
boot-migration: playbook_sections.brand_id is now nullable
Server listening  port=8080
```

No `ERROR` lines, no `constraint violation`, no `null value in column` messages = clean deploy.

---

## Quick reference: known permanent schema drifts

These mismatches are intentional — do not "fix" them by pushing the Drizzle schema to prod:

| Table | Column | Drizzle | Production | Reason |
|---|---|---|---|---|
| `playbook` | `brand_id` | nullable | nullable (was NOT NULL, boot migration dropped it) | Playbooks are global, not brand-scoped |
| `playbook_sections` | `brand_id` | nullable | nullable | Same as above |
