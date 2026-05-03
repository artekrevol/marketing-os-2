/**
 * Unit tests for withBrandScope + ScopedDb middleware.
 *
 * Tests that depend on a live Postgres auto-skip when DATABASE_URL is
 * absent. The pure-helper tests run unconditionally so CI catches
 * regressions without a database.
 *
 * Required scenarios (per Sprint 2 acceptance):
 *   1. assertBrandScope — pass / mismatch / missing
 *   2. ScopedDb refuses non-brand-scoped tables
 *   3. ScopedDb.insert auto-stamps brand_id; cross-brand throws
 *   4. ScopedDb.update refuses mutation of brand_id
 *   5. ScopedDb.select / .update / .delete only see scope's brand
 *      (cross-brand reads return 0 rows; cross-brand writes are no-ops)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { sql, eq } from "drizzle-orm";
import { db } from "../src/index";
import { withBrandScope, assertBrandScope } from "../src/brand-scope";
import {
  BrandScopeViolationError,
  ScopedDb,
  stampBrandId,
} from "../src/middleware";
import { projectsTable, brandsTable, eventsTable } from "../src/schema";

// Live-DB tests require a Postgres reachable via DATABASE_URL with the
// Sprint 1 schema applied (brands + projects). When DATABASE_URL is
// unset OR the brands table is missing (e.g. a fresh Replit DB without
// migrations), we skip so CI is not gated on a fully-seeded environment.
const HAS_URL = Boolean(process.env.DATABASE_URL);
let SCHEMA_READY = false;
const dbDescribe = HAS_URL ? describe : describe.skip;

describe("guardedDb (root export — protects worker tier)", () => {
  it("throws when worker code calls insert() on a brand-scoped table outside withBrandScope", async () => {
    const { guardedDb } = await import("../src/index");
    expect(() => guardedDb.insert(projectsTable).values({ brandId: "b1", name: "x" } as never)).toThrow(
      BrandScopeViolationError,
    );
  });
  it("throws when worker code calls select().from() on a brand-scoped table outside withBrandScope", async () => {
    const { guardedDb } = await import("../src/index");
    expect(() => guardedDb.select().from(projectsTable)).toThrow(BrandScopeViolationError);
  });
  it("allows select().from() on system tables (events) without scope", async () => {
    const { guardedDb } = await import("../src/index");
    expect(() => guardedDb.select().from(eventsTable)).not.toThrow();
  });
});

describe("stampBrandId (pure transform — no DB required)", () => {
  it("emits Drizzle camelCase `brandId` (not `brand_id`)", () => {
    const out = stampBrandId("b1", { topic: "t" });
    expect(out).toEqual({ topic: "t", brandId: "b1" });
    expect(out).not.toHaveProperty("brand_id");
  });
  it("normalizes snake_case input to camelCase output", () => {
    const out = stampBrandId("b1", { brand_id: "b1", topic: "t" });
    expect(out).toEqual({ topic: "t", brandId: "b1" });
    expect(out).not.toHaveProperty("brand_id");
  });
  it("preserves matching camelCase input", () => {
    const out = stampBrandId("b1", { brandId: "b1", topic: "t" });
    expect(out).toEqual({ topic: "t", brandId: "b1" });
  });
  it("throws on cross-brand camelCase", () => {
    expect(() => stampBrandId("b1", { brandId: "b2", topic: "t" })).toThrow(
      BrandScopeViolationError,
    );
  });
  it("throws on cross-brand snake_case", () => {
    expect(() => stampBrandId("b1", { brand_id: "b2", topic: "t" })).toThrow(
      /does not match scope/,
    );
  });
  it("preserves all other fields untouched", () => {
    const out = stampBrandId("b1", { topic: "t", contentType: "blog", metadata: { foo: 1 } });
    expect(out).toMatchObject({ topic: "t", contentType: "blog", metadata: { foo: 1 }, brandId: "b1" });
  });
});

describe("assertBrandScope", () => {
  it("passes when brand_id matches (camelCase)", () => {
    expect(() => assertBrandScope("b1", { brandId: "b1" })).not.toThrow();
  });
  it("passes when brand_id matches (snake_case)", () => {
    expect(() => assertBrandScope("b1", { brand_id: "b1" })).not.toThrow();
  });
  it("throws on mismatch", () => {
    expect(() => assertBrandScope("b1", { brandId: "b2" })).toThrow(/mismatch/);
  });
  it("throws when brand_id missing", () => {
    expect(() => assertBrandScope("b1", {})).toThrow(/missing/);
  });
});

describe("ScopedDb runtime guards (no DB required)", () => {
  // Use a fake tx — these tests assert the guard fires BEFORE any SQL is executed.
  const fakeTx = {} as never;
  const scoped = new ScopedDb("b-fixture", fakeTx);

  it("refuses select against a non-brand-scoped table", () => {
    expect(() => scoped.select(eventsTable)).toThrow(BrandScopeViolationError);
    expect(() => scoped.select(eventsTable)).toThrow(/not in BRAND_SCOPED_TABLES/);
  });

  it("refuses insert against a non-brand-scoped table", async () => {
    await expect(
      scoped.insert(eventsTable, { eventType: "x", subjectType: "y", subjectId: "z" }),
    ).rejects.toThrow(BrandScopeViolationError);
  });

  it("refuses update against a non-brand-scoped table", async () => {
    await expect(scoped.update(eventsTable, { subjectId: "x" })).rejects.toThrow(
      BrandScopeViolationError,
    );
  });

  it("refuses delete against a non-brand-scoped table", async () => {
    await expect(scoped.delete(eventsTable)).rejects.toThrow(BrandScopeViolationError);
  });

  it("refuses cross-brand insert (row brand_id != scope)", async () => {
    await expect(
      scoped.insert(projectsTable, {
        brandId: "b-other",
        topic: "x",
        contentType: "blog",
      }),
    ).rejects.toThrow(/cross_brand_insert|does not match scope/);
  });

  it("refuses update that would mutate brand_id", async () => {
    await expect(
      scoped.update(projectsTable, { brandId: "b-other", topic: "y" }),
    ).rejects.toThrow(/cannot mutate brand_id|mutate_brand_id/);
  });
});

dbDescribe("scope.db (guarded raw tx)", () => {
  beforeAll(async () => {
    try {
      await db.select({ id: brandsTable.id }).from(brandsTable).limit(1);
      SCHEMA_READY = true;
    } catch {
      SCHEMA_READY = false;
    }
  });

  it("throws when raw tx tries to insert into a brand-scoped table", async () => {
    if (!SCHEMA_READY) return;
    const [{ id: brandId }] = await db
      .select({ id: brandsTable.id })
      .from(brandsTable)
      .limit(1);
    class Rollback extends Error {}
    await expect(
      withBrandScope(brandId!, async ({ db: rawTx }) => {
        await rawTx.insert(projectsTable).values({
          brandId: brandId!,
          topic: "guard-test",
          contentType: "blog",
        });
        throw new Rollback();
      }),
    ).rejects.toThrow(/brand-scoped table.*forbidden|use scope\.scoped/);
  });

  it("throws when raw tx tries to select from a brand-scoped table", async () => {
    if (!SCHEMA_READY) return;
    const [{ id: brandId }] = await db
      .select({ id: brandsTable.id })
      .from(brandsTable)
      .limit(1);
    class Rollback extends Error {}
    await expect(
      withBrandScope(brandId!, async ({ db: rawTx }) => {
        await rawTx.select().from(projectsTable);
        throw new Rollback();
      }),
    ).rejects.toThrow(/brand-scoped table.*forbidden|use scope\.scoped/);
  });

  it("allows raw tx to read system tables (events)", async () => {
    if (!SCHEMA_READY) return;
    const [{ id: brandId }] = await db
      .select({ id: brandsTable.id })
      .from(brandsTable)
      .limit(1);
    // Should not throw — events is a system table.
    const out = await withBrandScope(brandId!, async ({ db: rawTx }) => {
      return await rawTx.select().from(eventsTable).limit(0);
    });
    expect(Array.isArray(out)).toBe(true);
  });
});

dbDescribe("withBrandScope (live DB)", () => {
  beforeAll(async () => {
    try {
      await db.select({ id: brandsTable.id }).from(brandsTable).limit(1);
      SCHEMA_READY = true;
    } catch {
      SCHEMA_READY = false;
      // eslint-disable-next-line no-console
      console.warn("[brand-scope.test] brands table not found — live-DB tests skipped");
    }
  });

  it("rejects empty brandId", async () => {
    await expect(withBrandScope("", async () => 1)).rejects.toThrow();
  });

  it("sets app.current_brand inside the transaction", async () => {
    if (!SCHEMA_READY) return;
    const [{ id: brandId }] = await db
      .select({ id: brandsTable.id })
      .from(brandsTable)
      .limit(1);
    expect(brandId).toBeTruthy();
    const got = await withBrandScope(brandId!, async ({ db: tx }) => {
      const r = await tx.execute(sql`select current_setting('app.current_brand', true) as v`);
      return (r as unknown as { rows: { v: string }[] }).rows[0]?.v;
    });
    expect(got).toBe(brandId);
  });

  it("scope.scoped.insert succeeds and stamps brand_id from scope", async () => {
    if (!SCHEMA_READY) return;
    const [{ id: brandId }] = await db
      .select({ id: brandsTable.id })
      .from(brandsTable)
      .limit(1);
    const topic = `scope-insert-ok-${Date.now()}`;
    let insertedId: string | undefined;

    // Use savepoint-style rollback: throw a sentinel at the end so the
    // outer transaction rolls back without polluting the database, but
    // the assertion result is captured before the throw.
    class Rollback extends Error {}
    await expect(
      withBrandScope(brandId!, async ({ scoped }) => {
        const rows = (await scoped.insert(
          projectsTable,
          { topic, contentType: "blog" },
          { returning: true },
        )) as { id: string; brandId: string }[];
        insertedId = rows[0]?.id;
        expect(insertedId).toBeTruthy();
        expect(rows[0]?.brandId).toBe(brandId);
        throw new Rollback("intentional rollback");
      }),
    ).rejects.toThrow(Rollback);

    // Confirm the row is gone after rollback.
    const after = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.topic, topic));
    expect(after).toHaveLength(0);
  });

  it("scope.scoped.select only sees the scope's brand", async () => {
    if (!SCHEMA_READY) return;
    const rows = await db
      .select({ id: brandsTable.id })
      .from(brandsTable)
      .limit(2);
    if (rows.length < 2) return;
    const [a, b] = rows;
    const topicA = `scope-iso-A-${Date.now()}`;
    const topicB = `scope-iso-B-${Date.now()}`;

    class Rollback extends Error {}
    await expect(
      withBrandScope(a!.id, async ({ scoped, db: tx }) => {
        // Seed one project under scope A, one directly under brand B (raw tx).
        await scoped.insert(projectsTable, { topic: topicA, contentType: "blog" });
        await tx
          .insert(projectsTable)
          .values({ brandId: b!.id, topic: topicB, contentType: "blog" });

        // ScopedDb.select MUST return only the scope-A row.
        const seen = (await scoped.select(projectsTable)) as Array<{
          id: string;
          brand_id: string;
          topic: string;
        }>;
        const topics = seen.map((r) => r.topic);
        expect(topics).toContain(topicA);
        expect(topics).not.toContain(topicB);

        throw new Rollback("intentional rollback");
      }),
    ).rejects.toThrow(Rollback);
  });

  it("scope.scoped.delete cannot delete other brand's rows", async () => {
    if (!SCHEMA_READY) return;
    const rows = await db
      .select({ id: brandsTable.id })
      .from(brandsTable)
      .limit(2);
    if (rows.length < 2) return;
    const [a, b] = rows;
    const topicB = `scope-del-B-${Date.now()}`;

    class Rollback extends Error {}
    await expect(
      withBrandScope(a!.id, async ({ scoped, db: tx }) => {
        await tx
          .insert(projectsTable)
          .values({ brandId: b!.id, topic: topicB, contentType: "blog" });

        // Try to delete brand-B rows from inside scope A — must be a no-op.
        await scoped.delete(projectsTable, eq(projectsTable.topic, topicB));

        // Verify the row still exists.
        const stillThere = await tx
          .select({ id: projectsTable.id })
          .from(projectsTable)
          .where(eq(projectsTable.topic, topicB));
        expect(stillThere).toHaveLength(1);

        throw new Rollback("intentional rollback");
      }),
    ).rejects.toThrow(Rollback);
  });
});
