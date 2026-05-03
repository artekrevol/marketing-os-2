/**
 * Brand-scope middleware.
 *
 * The worker uses the Supabase service role, which bypasses RLS. We
 * therefore enforce tenancy in code via this module:
 *
 *   - `ScopedDb` exposes explicit `select / insert / update / delete`
 *     methods that AUTOMATICALLY apply `brand_id = scope.brandId`. Cross-
 *     brand attempts (an insert row with the wrong brand_id, an update
 *     trying to mutate brand_id, etc.) throw `BrandScopeViolationError`.
 *
 *   - Operations on non-brand-scoped tables refuse via runtime throw,
 *     forcing the caller to use the underlying `tx` (`scope.db`)
 *     deliberately for system tables (events, dead_jobs, integration_call_log).
 *
 * This is the worker-side counterpart to RLS in the application path.
 */
import {
  and,
  eq,
  getTableColumns,
  getTableName,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { BRAND_SCOPED_TABLES, type DbClient } from "./brand-scope";

export class BrandScopeViolationError extends Error {
  constructor(
    public readonly violation:
      | "not_brand_scoped"
      | "cross_brand_insert"
      | "cross_brand_update"
      | "missing_brand_id_column"
      | "mutate_brand_id",
    message: string,
  ) {
    super(message);
    this.name = "BrandScopeViolationError";
  }
}

/**
 * Resolve the `brand_id` column on a Drizzle table. Tries both camelCase
 * and snake_case keys; falls back to scanning columns by SQL name.
 */
function getBrandIdColumn(table: PgTable): AnyColumn {
  const cols = getTableColumns(table) as Record<string, AnyColumn>;
  for (const key of Object.keys(cols)) {
    const c = cols[key];
    if (c.name === "brand_id") return c;
  }
  throw new BrandScopeViolationError(
    "missing_brand_id_column",
    `Brand-scoped table "${getTableName(table)}" has no brand_id column declared in its Drizzle schema.`,
  );
}

export interface SelectOpts {
  where?: SQL;
  limit?: number;
  orderBy?: SQL | AnyColumn | (SQL | AnyColumn)[];
}

/**
 * Brand-aware DB helpers. Every method MUST take a `BRAND_SCOPED_TABLES`
 * member; trying to use these against a system table throws so callers
 * are forced to drop down to `scope.db` deliberately.
 */
export class ScopedDb {
  constructor(
    public readonly brandId: string,
    private readonly tx: DbClient,
  ) {}

  /** SELECT … FROM table WHERE brand_id = scope AND (where), [orderBy], [limit]. */
  select<T extends PgTable>(table: T, opts: SelectOpts = {}) {
    this.requireScoped(table);
    const col = getBrandIdColumn(table);
    const filter = eq(col, this.brandId);
    const where = opts.where ? and(filter, opts.where)! : filter;

    let q = this.tx
      .select()
      .from(table as PgTable)
      .where(where) as unknown as {
        orderBy: (...args: unknown[]) => unknown;
        limit: (n: number) => unknown;
      };
    if (opts.orderBy != null) {
      const ob = Array.isArray(opts.orderBy) ? opts.orderBy : [opts.orderBy];
      q = q.orderBy(...ob) as typeof q;
    }
    if (opts.limit != null) q = q.limit(opts.limit) as typeof q;
    return q as unknown as Promise<Array<Record<string, unknown>>>;
  }

  /**
   * INSERT into a brand-scoped table. If the row(s) omit brand_id, it
   * is filled from scope. If the row carries a different brand_id, we
   * throw — never silently rewrite the caller's intent.
   */
  async insert<T extends PgTable>(
    table: T,
    values: Record<string, unknown> | Record<string, unknown>[],
    opts: { returning?: true } = {},
  ): Promise<unknown> {
    this.requireScoped(table);
    const arr = Array.isArray(values) ? values : [values];
    const stamped = arr.map((row) => {
      const present =
        (row["brandId"] as string | undefined) ??
        (row["brand_id"] as string | undefined);
      if (present != null && present !== this.brandId) {
        throw new BrandScopeViolationError(
          "cross_brand_insert",
          `insert into "${getTableName(table)}": row.brand_id=${String(present)} does not match scope ${this.brandId}`,
        );
      }
      return { ...row, brand_id: this.brandId };
    });

    const builder = this.tx.insert(table as PgTable).values(stamped as never);
    if (opts.returning) {
      return await (builder as unknown as { returning: () => Promise<unknown> }).returning();
    }
    return await builder;
  }

  /** UPDATE … SET … WHERE brand_id = scope AND (where). Refuses to mutate brand_id. */
  async update<T extends PgTable>(
    table: T,
    set: Record<string, unknown>,
    where?: SQL,
  ): Promise<unknown> {
    this.requireScoped(table);
    if ("brandId" in set || "brand_id" in set) {
      throw new BrandScopeViolationError(
        "mutate_brand_id",
        `update "${getTableName(table)}": cannot mutate brand_id under scope ${this.brandId}`,
      );
    }
    const col = getBrandIdColumn(table);
    const filter = eq(col, this.brandId);
    const w = where ? and(filter, where)! : filter;
    return await this.tx
      .update(table as PgTable)
      .set(set as never)
      .where(w);
  }

  /** DELETE FROM … WHERE brand_id = scope AND (where). */
  async delete<T extends PgTable>(table: T, where?: SQL): Promise<unknown> {
    this.requireScoped(table);
    const col = getBrandIdColumn(table);
    const filter = eq(col, this.brandId);
    const w = where ? and(filter, where)! : filter;
    return await this.tx.delete(table as PgTable).where(w);
  }

  private requireScoped(table: PgTable): void {
    const name = getTableName(table);
    if (!BRAND_SCOPED_TABLES.has(name)) {
      throw new BrandScopeViolationError(
        "not_brand_scoped",
        `Table "${name}" is not in BRAND_SCOPED_TABLES; use scope.db (the raw tx) for system tables.`,
      );
    }
  }
}
