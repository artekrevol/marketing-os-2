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
import discoveryInboxRouter from "./discovery-inbox.js";
import competitorCurationRouter from "./competitor-curation.js";
import ahrefsUploadRouter from "./ahrefs-upload.js";
import ahrefsSnapshotsRouter from "./ahrefs-snapshots.js";
import ahrefsIntelligenceRouter from "./ahrefs-intelligence.js";
import gscRouter from "./gsc.js";

/**
 * SEO Intelligence API — mounted at `/api/seo` behind `requireSeoRole`
 * (role ∈ {admin, lead, reviewer}). One sub-router per resource. Every
 * route runs `requireAuth` and resolves brand access via `guardBrand`
 * (see `_shared.ts`); all multi-row DB work goes through `withBrandScope()`
 * for tenant isolation.
 *
 * Discovery Inbox and Competitor Curation further restrict to admin+lead
 * via `requireAdminOrLead` inside their own route handlers.
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
router.use("/discovery-inbox", discoveryInboxRouter);
router.use("/competitor-curation", competitorCurationRouter);

// Ahrefs Intelligence — upload, snapshots, and intelligence query routes
router.use("/gsc", gscRouter);                          // Google Search Console data
router.use("/ahrefs/snapshots", ahrefsSnapshotsRouter); // new two-step (mount FIRST — before /ahrefs prefix swallows it)
router.use("/ahrefs", ahrefsUploadRouter);               // legacy one-shot upload (kept for compatibility)
router.use("/", ahrefsIntelligenceRouter);

export default router;
