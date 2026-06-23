import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { withBrandScope, rankSnapshotsTable } from "@workspace/db";
import { requireAuth } from "../../middlewares/auth.js";
import { guardBrand, fail, UUID_RE } from "./_shared.js";

const router: IRouter = Router();
router.use(requireAuth);

interface CurrentRankingRow {
  keyword_id: string;
  keyword_text: string;
  location_id: string;
  position: number | null;
  url: string | null;
  found_at_position: boolean;
  captured_at: string;
}

/**
 * GET /api/seo/rankings/current?brandId= — latest snapshot per keyword.
 *
 * `DISTINCT ON (keyword_id) … ORDER BY keyword_id, captured_at DESC`
 * collapses each keyword's history to its newest row. Runs inside
 * `withBrandScope` and carries an explicit `brand_id` filter (raw
 * `db.execute` bypasses the scoped helpers, so the filter is mandatory).
 */
router.get("/current", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  try {
    const rows = await withBrandScope(guard.brandId, async ({ db }) => {
      const result = (await db.execute(sql`
        select distinct on (rs.keyword_id)
          rs.keyword_id,
          k.keyword_text,
          rs.location_id,
          rs.position,
          rs.url,
          rs.found_at_position,
          rs.captured_at
        from public.rank_snapshots rs
        join public.keywords k on k.id = rs.keyword_id
        where rs.brand_id = ${guard.brandId}::uuid
        order by rs.keyword_id, rs.captured_at desc
      `)) as unknown as { rows?: CurrentRankingRow[] } | CurrentRankingRow[];
      return Array.isArray(result) ? result : (result.rows ?? []);
    });
    res.json({ rankings: rows });
  } catch (err) {
    fail(res, req, "rankings.current", err);
  }
});

/** GET /api/seo/rankings/history?brandId=&keywordId= — full history for a keyword */
router.get("/history", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  const keywordId = req.query["keywordId"];
  if (typeof keywordId !== "string" || !UUID_RE.test(keywordId)) {
    res.status(400).json({ error: "keywordId (UUID) required" });
    return;
  }
  try {
    const rows = await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.select(rankSnapshotsTable, {
        where: eq(rankSnapshotsTable.keywordId, keywordId),
        orderBy: desc(rankSnapshotsTable.capturedAt),
        limit: 1000,
      }),
    );
    res.json({ history: rows });
  } catch (err) {
    fail(res, req, "rankings.history", err);
  }
});

/** GET /api/seo/rankings?brandId= — recent snapshots across the brand */
router.get("/", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  try {
    const rows = await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.select(rankSnapshotsTable, {
        orderBy: desc(rankSnapshotsTable.capturedAt),
        limit: 2000,
      }),
    );
    res.json({ rankings: rows });
  } catch (err) {
    fail(res, req, "rankings.list", err);
  }
});

export default router;
