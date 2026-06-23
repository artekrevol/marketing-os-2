---
name: Drizzle push drift hazard
description: Why blanket `drizzle-kit push` is unsafe in this repo and what to do for additive schema changes
---

The dev database contains tables that are NOT present in the Drizzle schema (drift). Running a blanket `pnpm --filter @workspace/db run push` triggers drizzle-kit's interactive rename/drop resolver and will offer to **DROP those unrelated tables** as part of reconciling the DB to the schema.

**Rule:** For purely additive schema changes (new tables/indexes/constraints), do not run a blanket `push`. Apply the exact approved DDL in a single transaction via `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f file.sql` instead. This creates only your objects and never touches drifted tables.

**Why:** push reconciles the *entire* DB to the schema; with pre-existing drift that means destructive drops of tables outside your change's scope. A scoped DDL transaction is non-destructive and predictable.

**How to apply:** When asked to "push" additive SEO/feature tables, write the CREATE TABLE/INDEX statements (FK-dependency order) into a temp `.sql`, wrap in BEGIN/COMMIT, run via psql. Reserve full `push` for when the schema and DB are known to be in sync.
