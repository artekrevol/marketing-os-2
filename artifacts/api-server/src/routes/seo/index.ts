import { Router, type IRouter } from "express";
import keywordsRouter from "./keywords.js";
import locationsRouter from "./locations.js";
import keywordListsRouter from "./keyword-lists.js";
import competitorPagesRouter from "./competitor-pages.js";
import competitorInsightsRouter from "./competitor-insights.js";
import blacklistedDomainsRouter from "./blacklisted-domains.js";
import crawlsRouter from "./crawls.js";
import rankingsRouter from "./rankings.js";
import dashboardRouter from "./dashboard.js";
import schedulesRouter from "./schedules.js";

/**
 * SEO Intelligence API — mounted at `/api/seo` behind `requireSeoRole`
 * (role ∈ {admin, lead, reviewer}). One sub-router per resource. Every
 * route runs `requireAuth` and resolves brand access via `guardBrand`
 * (see `_shared.ts`); all multi-row DB work goes through `withBrandScope()`
 * for tenant isolation.
 */
const router: IRouter = Router();

router.use("/keywords", keywordsRouter);
router.use("/locations", locationsRouter);
router.use("/keyword-lists", keywordListsRouter);
router.use("/competitor-pages", competitorPagesRouter);
router.use("/competitor-insights", competitorInsightsRouter);
router.use("/blacklisted-domains", blacklistedDomainsRouter);
router.use("/crawls", crawlsRouter);
router.use("/rankings", rankingsRouter);
router.use("/dashboard", dashboardRouter);
router.use("/schedules", schedulesRouter);

export default router;
