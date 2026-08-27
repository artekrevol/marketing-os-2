import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { withBrandScope } from "@workspace/db";
import { requireAuth } from "../../middlewares/auth.js";
import { guardBrand, fail } from "./_shared.js";

const router: IRouter = Router();
router.use(requireAuth);

interface StatsRow {
  keyword_count: number;
  location_count: number;
  competitor_count: number;
  active_schedule_count: number;
  last_crawl_at: string | null;
}

/**
 * GET /api/seo/dashboard/stats?brandId= — headline counts for the SEO
 * dashboard. A single round-trip of scalar subqueries (all brand-scoped
 * via explicit `brand_id` filters) instead of N separate count queries.
 */
router.get("/stats", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  try {
    const stats = await withBrandScope(guard.brandId, async ({ db }) => {
      const result = (await db.execute(sql`
        select
          (select count(*)::int from public.keywords where brand_id = ${guard.brandId}::uuid) as keyword_count,
          (select count(*)::int from public.locations where brand_id = ${guard.brandId}::uuid) as location_count,
          (select count(distinct competitor_domain)::int from public.competitor_pages where brand_id = ${guard.brandId}::uuid) as competitor_count,
          (select count(*)::int from public.crawl_schedules where brand_id = ${guard.brandId}::uuid and active = true) as active_schedule_count,
          (select max(finished_at) from public.crawl_batches where brand_id = ${guard.brandId}::uuid and status = 'complete') as last_crawl_at
      `)) as unknown as { rows?: StatsRow[] } | StatsRow[];
      const rows = Array.isArray(result) ? result : (result.rows ?? []);
      return rows[0] ?? null;
    });
    res.json({ scope: "brand", brand_id: guard.brandId, stats });
  } catch (err) {
    fail(res, req, "dashboard.stats", err);
  }
});

export default router;
