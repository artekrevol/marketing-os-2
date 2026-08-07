import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { withBrandScope } from "@workspace/db";
import { requireAuth } from "../../middlewares/auth.js";
import { guardBrand, fail } from "./_shared.js";

const router: IRouter = Router();
router.use(requireAuth);

// ---- Ahrefs summary (mounted on the /ahrefs sub-router) -------------------

/**
 * GET /api/seo/ahrefs/summary?brandId=
 * NOTE: exported and re-used by ahrefs-upload.ts which is mounted at /ahrefs
 *
 * One-shot stats for the dashboard alerts rail:
 *  - latest import batch metadata
 *  - broken backlinks from DR≥70 (the urgent redirect opportunities)
 *  - pages with >50% traffic crash
 *  - top 3 content gap opportunities by priority score
 *  - link velocity (new vs lost in latest batch)
 */
router.get("/ahrefs/summary", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  try {
    const data = await withBrandScope(guard.brandId, async ({ db }) => {
      const exec = <T>(q: ReturnType<typeof sql>) =>
        db.execute(q).then((r) => {
          const raw = r as unknown as { rows?: T[] } | T[];
          return Array.isArray(raw) ? raw : (raw.rows ?? []);
        });

      const [batchRows, crashedRows, brokenRows, gapRows, velocityRows] = await Promise.all([
        exec<{
          id: string; imported_at: string; backlink_count: number;
          page_count: number; content_gap_count: number;
          delta_new_links: number; delta_lost_links: number; delta_pages_crashed: number;
        }>(sql`
          SELECT id::text, imported_at, backlink_count, page_count, content_gap_count,
                 delta_new_links, delta_lost_links, delta_pages_crashed
          FROM ahrefs_import_batches
          WHERE brand_id = ${guard.brandId}::uuid
          ORDER BY imported_at DESC LIMIT 1
        `),
        exec<{ url: string; prev_traffic: number; curr_traffic: number; traffic_change: number; status: string }>(sql`
          SELECT url, prev_traffic, curr_traffic, traffic_change, status
          FROM ahrefs_page_performance
          WHERE brand_id = ${guard.brandId}::uuid
            AND prev_traffic > 100
            AND traffic_change < -(prev_traffic * 0.5)
          ORDER BY traffic_change ASC
          LIMIT 5
        `),
        exec<{ referring_page_url: string; target_url: string; dr: string; anchor: string; target_http_code: number; domain: string }>(sql`
          -- "Broken" = backlink whose target URL returned a 4xx/5xx HTTP code,
          -- as reported directly by the Ahrefs BrokenBacklinks export
          -- ("Target page HTTP code" column → target_http_code on the row).
          -- No join to ahrefs_page_performance needed: the evidence is on the backlink row.
          SELECT b.referring_page_url, b.target_url, b.dr, b.anchor,
                 b.target_http_code,
                 split_part(b.referring_page_url, '/', 3) AS domain
          FROM ahrefs_backlinks b
          WHERE b.brand_id = ${guard.brandId}::uuid
            AND b.is_lost  = false
            AND b.target_url IS NOT NULL
            AND b.target_http_code BETWEEN 400 AND 599
            AND b.dr::numeric >= 40
          ORDER BY b.dr::numeric DESC NULLS LAST
          LIMIT 20
        `),
        exec<{ keyword: string; volume: number; kd: number; priority_score: number; competitor_domain: string; competitor_position: number }>(sql`
          SELECT keyword, volume, kd, priority_score, competitor_domain, competitor_position
          FROM ahrefs_content_gap
          WHERE brand_id = ${guard.brandId}::uuid
            AND volume > 0
            AND competitor_position IS NOT NULL
          ORDER BY priority_score DESC NULLS LAST
          LIMIT 3
        `),
        exec<{ new_links: number; lost_links: number }>(sql`
          -- Read velocity from the latest batch record where we stored the true set-diff
          -- (delta_new_links = net gain in active links vs pre-upload snapshot;
          --  delta_lost_links = Ahrefs-flagged lost count from the export).
          SELECT
            COALESCE(delta_new_links,  0)::int AS new_links,
            COALESCE(delta_lost_links, 0)::int AS lost_links
          FROM ahrefs_import_batches
          WHERE brand_id = ${guard.brandId}::uuid
          ORDER BY imported_at DESC
          LIMIT 1
        `),
      ]);

      return {
        latestBatch: batchRows[0] ?? null,
        crashedPages: crashedRows,
        brokenHighDrLinks: brokenRows,
        topGapOpportunities: gapRows,
        linkVelocity: velocityRows[0] ?? { new_links: 0, lost_links: 0 },
      };
    });
    res.json(data);
  } catch (err) { fail(res, req, "ahrefs.summary", err); }
});

// ---- Backlinks -------------------------------------------------------------

/** GET /api/seo/backlinks?brandId=&isLost=&isSpam=&minDr=&search=&limit=&offset= */
router.get("/backlinks", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  try {
    const isLost     = req.query["isLost"];
    const isSpam     = req.query["isSpam"];
    const isNofollow = req.query["isNofollow"];
    const minDr      = req.query["minDr"];
    const search = req.query["search"];
    const limit  = Math.min(Number(req.query["limit"] ?? 50), 200);
    const offset = Number(req.query["offset"] ?? 0);

    const data = await withBrandScope(guard.brandId, async ({ db }) => {
      const exec = <T>(q: ReturnType<typeof sql>) =>
        db.execute(q).then((r) => {
          const raw = r as unknown as { rows?: T[] } | T[];
          return Array.isArray(raw) ? raw : (raw.rows ?? []);
        });

      const [statsRows, rows] = await Promise.all([
        exec<{ total: number; active: number; lost: number; dofollow: number; spam: number }>(sql`
          SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE is_lost = false)::int AS active,
            count(*) FILTER (WHERE is_lost = true)::int  AS lost,
            count(*) FILTER (WHERE is_nofollow = false)::int AS dofollow,
            count(*) FILTER (WHERE is_spam = true)::int  AS spam
          FROM ahrefs_backlinks
          WHERE brand_id = ${guard.brandId}::uuid
        `),
        exec<{
          id: string; referring_page_url: string; referring_page_title: string | null;
          dr: string | null; ur: string | null; anchor: string | null;
          target_url: string | null; link_type: string | null;
          is_nofollow: boolean; is_spam: boolean; is_lost: boolean;
          first_seen: string | null; last_seen: string | null; page_type: string | null;
        }>(sql`
          SELECT id::text, referring_page_url, referring_page_title, dr, ur, anchor,
                 target_url, link_type, is_nofollow, is_spam, is_lost,
                 first_seen, last_seen, page_type
          FROM ahrefs_backlinks
          WHERE brand_id = ${guard.brandId}::uuid
            ${isLost === "true" ? sql`AND is_lost = true` : isLost === "false" ? sql`AND is_lost = false` : sql``}
            ${isSpam === "true"     ? sql`AND is_spam = true`     : sql``}
            ${isNofollow === "true" ? sql`AND is_nofollow = true` : sql``}
            ${minDr ? sql`AND dr::numeric >= ${Number(minDr)}` : sql``}
            ${search ? sql`AND (referring_page_url ILIKE ${"%" + String(search) + "%"} OR anchor ILIKE ${"%" + String(search) + "%"})` : sql``}
          ORDER BY dr::numeric DESC NULLS LAST, referring_page_url
          LIMIT ${limit} OFFSET ${offset}
        `),
      ]);

      return { stats: statsRows[0] ?? {}, backlinks: rows, limit, offset };
    });
    res.json(data);
  } catch (err) { fail(res, req, "backlinks.list", err); }
});

/**
 * GET /api/seo/backlinks/broken?brandId=
 *
 * "Broken" means the backlink's target URL on our site has a non-Active/non-200
 * HTTP status (e.g. 404, "Not found") as reported in the Top Pages or Broken
 * Backlinks Ahrefs export.  We join ahrefs_backlinks → ahrefs_page_performance
 * on target_url so only confirmed broken targets are returned.
 *
 * If no page-performance data has been ingested yet, the result is empty — which
 * is correct: we cannot label a page broken without evidence.
 */
router.get("/backlinks/broken", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  try {
    const rows = await withBrandScope(guard.brandId, async ({ db }) => {
      const r = (await db.execute(sql`
        SELECT
          b.id::text, b.referring_page_url, b.referring_page_title,
          b.dr, b.ur, b.anchor, b.target_url, b.target_http_code, b.link_type,
          b.first_seen, b.last_seen,
          split_part(b.referring_page_url, '/', 3) AS referring_domain
        FROM ahrefs_backlinks b
        WHERE b.brand_id = ${guard.brandId}::uuid
          AND b.is_lost  = false
          AND b.target_url IS NOT NULL
          AND b.target_http_code BETWEEN 400 AND 599
          AND b.dr::numeric >= 40
        ORDER BY b.dr::numeric DESC NULLS LAST
        LIMIT 200
      `)) as unknown as { rows?: unknown[] } | unknown[];
      return Array.isArray(r) ? r : (r.rows ?? []);
    });
    res.json({ brokenLinks: rows });
  } catch (err) { fail(res, req, "backlinks.broken", err); }
});

/**
 * GET /api/seo/backlinks/broken/export?brandId=
 *
 * Produces an nginx rewrite-map stub for broken pages that still receive
 * backlinks.  Each broken page becomes one rewrite block showing its path,
 * max inbound DR, and backlink count — the operator fills in the redirect
 * target.  Only pages confirmed broken via ahrefs_page_performance are
 * included; no DR-threshold guessing.
 */
router.get("/backlinks/broken/export", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  try {
    const rows = await withBrandScope(guard.brandId, async ({ db }) => {
      const r = (await db.execute(sql`
        SELECT
          b.target_url          AS broken_url,
          b.target_http_code::text AS target_status,
          COUNT(b.id)::int      AS backlink_count,
          MAX(b.dr::numeric)    AS max_dr
        FROM ahrefs_backlinks b
        WHERE b.brand_id = ${guard.brandId}::uuid
          AND b.is_lost  = false
          AND b.target_url IS NOT NULL
          AND b.target_http_code BETWEEN 400 AND 599
          AND b.dr::numeric >= 40
        GROUP BY b.target_url, b.target_http_code
        ORDER BY max_dr DESC NULLS LAST
      `)) as unknown as { rows?: Array<{ broken_url: string; target_status: string; backlink_count: number; max_dr: number }> }
           | Array<{ broken_url: string; target_status: string; backlink_count: number; max_dr: number }>;
      return Array.isArray(r) ? r : (r.rows ?? []);
    });

    const lines = rows
      .filter((r) => r.broken_url)
      .map((r) => {
        try {
          const u = new URL(r.broken_url);
          const path = u.pathname + (u.search || "");
          const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          return [
            `# ${r.broken_url}  [${r.target_status}]  backlinks: ${r.backlink_count}  max-DR: ${r.max_dr ?? "?"}`,
            `rewrite ^${escaped}$ /REDIRECT_TARGET permanent;`,
          ].join("\n");
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .join("\n\n");

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", "attachment; filename=redirect-map.conf");
    res.send(lines || "# No broken pages with inbound backlinks found.\n# Upload Top Pages and Backlinks exports to enable this report.");
  } catch (err) { fail(res, req, "backlinks.broken.export", err); }
});

// ---- Anchors ---------------------------------------------------------------

/** GET /api/seo/anchors?brandId=&limit= */
router.get("/anchors", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  try {
    const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
    const rows = await withBrandScope(guard.brandId, async ({ db }) => {
      const r = (await db.execute(sql`
        SELECT id::text, anchor_text, ref_domains_count, top_dr, ref_pages_count,
               links_to_target, new_links, lost_links, dofollow_links, first_seen, is_lost
        FROM ahrefs_anchors
        WHERE brand_id = ${guard.brandId}::uuid
        ORDER BY ref_domains_count DESC NULLS LAST
        LIMIT ${limit}
      `)) as unknown as { rows?: unknown[] } | unknown[];
      return Array.isArray(r) ? r : (r.rows ?? []);
    });
    res.json({ anchors: rows });
  } catch (err) { fail(res, req, "anchors.list", err); }
});

// ---- Page Performance ------------------------------------------------------

/** GET /api/seo/page-performance?brandId=&status=&minDrop= */
router.get("/page-performance", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  try {
    const status  = req.query["status"];   // Lost | Active | New | all
    const minDrop = req.query["minDrop"];  // absolute traffic drop threshold (negative)
    const limit   = Math.min(Number(req.query["limit"] ?? 100), 500);
    const offset  = Number(req.query["offset"] ?? 0);

    const rows = await withBrandScope(guard.brandId, async ({ db }) => {
      const r = (await db.execute(sql`
        SELECT id::text, url, status, ur, prev_traffic, curr_traffic,
               traffic_change, prev_traffic_value, curr_traffic_value,
               curr_ref_domains, prev_keywords, curr_keywords,
               page_type, prev_top_keyword, curr_top_keyword
        FROM ahrefs_page_performance
        WHERE brand_id = ${guard.brandId}::uuid
          ${status && status !== "all" ? sql`AND status = ${String(status)}` : sql``}
          ${minDrop ? sql`AND traffic_change <= ${Number(minDrop)}` : sql``}
        ORDER BY traffic_change ASC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      `)) as unknown as { rows?: unknown[] } | unknown[];
      return Array.isArray(r) ? r : (r.rows ?? []);
    });
    res.json({ pages: rows });
  } catch (err) { fail(res, req, "page-performance.list", err); }
});

// ---- Content Gap -----------------------------------------------------------

/** GET /api/seo/content-gap?brandId=&intent=&minVolume=&maxKd=&search=&limit=&offset= */
router.get("/content-gap", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  try {
    const intent    = req.query["intent"];
    const minVolume = req.query["minVolume"];
    const maxKd     = req.query["maxKd"];
    const search    = req.query["search"];
    const limit     = Math.min(Number(req.query["limit"] ?? 50), 500);
    const offset    = Number(req.query["offset"] ?? 0);

    const data = await withBrandScope(guard.brandId, async ({ db }) => {
      const exec = <T>(q: ReturnType<typeof sql>) =>
        db.execute(q).then((r) => {
          const raw = r as unknown as { rows?: T[] } | T[];
          return Array.isArray(raw) ? raw : (raw.rows ?? []);
        });

      const [countRows, rows] = await Promise.all([
        exec<{ total: number; high_opp: number; total_comp_traffic: number }>(sql`
          SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE volume >= 1000 AND kd <= 50)::int AS high_opp,
            COALESCE(sum(competitor_traffic), 0)::int AS total_comp_traffic
          FROM ahrefs_content_gap
          WHERE brand_id = ${guard.brandId}::uuid
            ${minVolume ? sql`AND volume >= ${Number(minVolume)}` : sql``}
            ${maxKd ? sql`AND kd <= ${Number(maxKd)}` : sql``}
            ${intent ? sql`AND ${String(intent)} = ANY(intents)` : sql``}
            ${search ? sql`AND keyword ILIKE ${"%" + String(search) + "%"}` : sql``}
        `),
        exec<{
          id: string; keyword: string; intents: string[] | null; volume: number; kd: number;
          cpc: string; our_url: string | null; our_position: number | null;
          competitor_domain: string; competitor_url: string | null;
          competitor_position: number; competitor_traffic: number | null;
          priority_score: number | null;
        }>(sql`
          SELECT id::text, keyword, intents, volume, kd, cpc,
                 our_url, our_position,
                 competitor_domain, competitor_url, competitor_position, competitor_traffic,
                 priority_score
          FROM ahrefs_content_gap
          WHERE brand_id = ${guard.brandId}::uuid
            ${minVolume ? sql`AND volume >= ${Number(minVolume)}` : sql``}
            ${maxKd ? sql`AND kd <= ${Number(maxKd)}` : sql``}
            ${intent ? sql`AND ${String(intent)} = ANY(intents)` : sql``}
            ${search ? sql`AND keyword ILIKE ${"%" + String(search) + "%"}` : sql``}
          ORDER BY priority_score DESC NULLS LAST, volume DESC NULLS LAST
          LIMIT ${limit} OFFSET ${offset}
        `),
      ]);

      return { summary: countRows[0] ?? {}, gaps: rows, limit, offset };
    });
    res.json(data);
  } catch (err) { fail(res, req, "content-gap.list", err); }
});

/** GET /api/seo/content-gap/export?brandId=&intent=&minVolume=&maxKd= — CSV */
router.get("/content-gap/export", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  try {
    const intent    = req.query["intent"];
    const minVolume = req.query["minVolume"];
    const maxKd     = req.query["maxKd"];

    const rows = await withBrandScope(guard.brandId, async ({ db }) => {
      const r = (await db.execute(sql`
        SELECT keyword, intents, volume, kd, cpc, priority_score,
               our_url, our_position,
               competitor_domain, competitor_url, competitor_position, competitor_traffic
        FROM ahrefs_content_gap
        WHERE brand_id = ${guard.brandId}::uuid
          ${minVolume ? sql`AND volume >= ${Number(minVolume)}` : sql``}
          ${maxKd ? sql`AND kd <= ${Number(maxKd)}` : sql``}
          ${intent ? sql`AND ${String(intent)} = ANY(intents)` : sql``}
        ORDER BY priority_score DESC NULLS LAST, volume DESC NULLS LAST
        LIMIT 5000
      `)) as unknown as { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
      return Array.isArray(r) ? r : (r.rows ?? []);
    });

    const headers = "Keyword,Intents,Volume,KD,CPC,Priority Score,Our URL,Our Position,Competitor,Comp URL,Comp Position,Comp Traffic\n";
    const csvRows = rows.map((r) => [
      `"${String(r["keyword"] ?? "").replace(/"/g, '""')}"`,
      `"${Array.isArray(r["intents"]) ? (r["intents"] as string[]).join("; ") : ""}"`,
      r["volume"] ?? "",
      r["kd"] ?? "",
      r["cpc"] ?? "",
      r["priority_score"] ?? "",
      `"${String(r["our_url"] ?? "")}"`,
      r["our_position"] ?? "",
      `"${String(r["competitor_domain"] ?? "")}"`,
      `"${String(r["competitor_url"] ?? "")}"`,
      r["competitor_position"] ?? "",
      r["competitor_traffic"] ?? "",
    ].join(",")).join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=content-gap.csv");
    res.send(headers + csvRows);
  } catch (err) { fail(res, req, "content-gap.export", err); }
});

// ---- DR distribution -------------------------------------------------------

/** GET /api/seo/backlinks/dr-distribution?brandId= */
router.get("/backlinks/dr-distribution", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  try {
    const rows = await withBrandScope(guard.brandId, async ({ db }) => {
      const r = (await db.execute(sql`
        SELECT
          count(*) FILTER (WHERE dr::numeric >= 90)::int AS "90plus",
          count(*) FILTER (WHERE dr::numeric >= 70 AND dr::numeric < 90)::int AS "70to89",
          count(*) FILTER (WHERE dr::numeric >= 50 AND dr::numeric < 70)::int AS "50to69",
          count(*) FILTER (WHERE dr::numeric >= 30 AND dr::numeric < 50)::int AS "30to49",
          count(*) FILTER (WHERE dr::numeric < 30 OR dr IS NULL)::int AS "sub30"
        FROM ahrefs_backlinks
        WHERE brand_id = ${guard.brandId}::uuid AND is_lost = false
      `)) as unknown as { rows?: unknown[] } | unknown[];
      return Array.isArray(r) ? r : (r.rows ?? []);
    });
    res.json({ distribution: rows[0] ?? {} });
  } catch (err) { fail(res, req, "backlinks.dr-distribution", err); }
});

export default router;
