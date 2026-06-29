import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./brand-scope";
export * from "./middleware";
export * from "./queries/types";
export * from "./queries/cross-module";

import { createGuardedDb } from "./middleware";

/**
 * Guarded root DB client for worker/integration callers. Throws at
 * runtime if any insert/update/delete or `select().from()` targets a
 * BRAND_SCOPED_TABLES member outside `withBrandScope(...)`. Use this
 * everywhere in the worker tier; for tenant-scoped reads/writes use
 * `withBrandScope(brandId, async (scope) => scope.db... / scope.scoped...)`.
 *
 * The raw `db` export remains available for the API server, where
 * admin/system endpoints intentionally read across brands.
 */
export const guardedDb = createGuardedDb(db);
