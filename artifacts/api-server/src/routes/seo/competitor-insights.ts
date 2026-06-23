import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { withBrandScope, competitorInsightsTable } from "@workspace/db";
import { enqueue } from "@workspace/jobs";
import { requireAuth } from "../../middlewares/auth.js";
import { guardBrand, fail } from "./_shared.js";

const router: IRouter = Router();
router.use(requireAuth);

/** GET /api/seo/competitor-insights?brandId= */
router.get("/", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  try {
    const rows = await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.select(competitorInsightsTable, {
        orderBy: desc(competitorInsightsTable.sharedKeywordCount),
      }),
    );
    res.json({ competitorInsights: rows });
  } catch (err) {
    fail(res, req, "competitor-insights.list", err);
  }
});

/**
 * POST /api/seo/competitor-insights/compute — { brandId }
 *
 * Enqueues `seo.competitor-insights.compute` (pure DB aggregation, no
 * external API cost). Returns 202.
 */
router.post("/compute", async (req, res) => {
  const body = (req.body ?? {}) as { brandId?: string };
  const guard = await guardBrand(req, body.brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  try {
    const { jobId } = await enqueue("seo.competitor-insights.compute", {
      brandId: guard.brandId,
      idempotencyKey: `seo-competitor-insights:${guard.brandId}-${Date.now()}`,
    });
    res.status(202).json({ ok: true, status: "queued", jobId });
  } catch (err) {
    fail(res, req, "competitor-insights.compute", err);
  }
});

export default router;
