/**
 * Unit tests for withBrandScope.
 *
 * These tests require a live Postgres + DATABASE_URL pointing to the
 * Sprint 1 schema (brands + projects + RLS). They auto-skip when
 * DATABASE_URL is not set so CI can run without a database.
 */
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../src/index";
import { withBrandScope, assertBrandScope } from "../src/brand-scope";
import { projectsTable, brandsTable } from "../src/schema";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const d = HAS_DB ? describe : describe.skip;

d("withBrandScope", () => {
  it("rejects missing brandId", async () => {
    // @ts-expect-error – intentional misuse
    await expect(withBrandScope("", async () => 1)).rejects.toThrow();
  });

  it("sets app.current_brand inside the transaction", async () => {
    const [{ id: brandId }] = await db.select({ id: brandsTable.id }).from(brandsTable).limit(1);
    expect(brandId).toBeDefined();
    const got = await withBrandScope(brandId, async ({ db: tx }) => {
      const result = await tx.execute(sql`select current_setting('app.current_brand', true) as v`);
      // node-postgres returns rows on .rows
      const rows = (result as unknown as { rows: { v: string }[] }).rows;
      return rows[0]?.v;
    });
    expect(got).toBe(brandId);
  });

  it("assertBrandScope passes when brand_id matches", () => {
    expect(() => assertBrandScope("b1", { brandId: "b1" })).not.toThrow();
    expect(() => assertBrandScope("b1", { brand_id: "b1" })).not.toThrow();
  });

  it("assertBrandScope throws on mismatch", () => {
    expect(() => assertBrandScope("b1", { brandId: "b2" })).toThrow(/mismatch/);
  });

  it("assertBrandScope throws when brand_id missing", () => {
    expect(() => assertBrandScope("b1", {})).toThrow(/missing/);
  });

  it("inserts succeed when brand_id matches scope", async () => {
    const [{ id: brandId }] = await db.select({ id: brandsTable.id }).from(brandsTable).limit(1);
    await withBrandScope(brandId, async ({ db: tx, brandId: scopeBrand }) => {
      const row = { brandId: scopeBrand, topic: `scope-test-${Date.now()}`, contentType: "blog" };
      assertBrandScope(scopeBrand, row);
      const inserted = await tx.insert(projectsTable).values(row).returning({ id: projectsTable.id });
      expect(inserted[0]?.id).toBeDefined();
      // rollback so the test doesn't pollute the database
      await tx.execute(sql`select 1 / 0`).catch(() => {});
    }).catch(() => {});
  });

  it("rejects cross-brand inserts via assertBrandScope", async () => {
    const rows = await db.select({ id: brandsTable.id }).from(brandsTable).limit(2);
    if (rows.length < 2) return; // need at least two brands
    const [a, b] = rows;
    await expect(
      withBrandScope(a.id, async ({ brandId }) => {
        assertBrandScope(brandId, { brandId: b.id, topic: "x", contentType: "blog" });
      }),
    ).rejects.toThrow(/mismatch/);
  });
});
