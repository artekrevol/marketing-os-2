/**
 * GSC (Google Search Console) data routes — SEO OS module.
 *
 *   GET  /connection           — connection status + last sync for a brand
 *   GET  /properties           — list verified GSC sites (calls Google API)
 *   POST /property             — save the selected GSC property URL
 *   GET  /search-performance   — aggregated clicks/impressions/position data
 *   POST /sync                 — trigger a manual GSC data sync
 *   GET  /sync-log             — last 10 sync records
 */
import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { guardedDb, withBrandScope } from "@workspace/db";
import { enqueue } from "@workspace/jobs";
import { requireAuth } from "../../middlewares/auth.js";
import { guardBrand, requireAdminOrLead } from "./_shared.js";
import { listGscSites } from "../google/google-client.js";
import {
  ensureFreshGoogleToken,
  loadGoogleConnection,
} from "../google/google-connection.js";

const router: IRouter = Router();
router.use(requireAuth);

/* ── helpers ──────────────────────────────────────────────────────────────── */

/* ─── GET /connection ────────────────────────────────────────────────────── */
router.get("/connection", async (req, res) => {
  const brandId = req.query["brandId"] as string | undefined;
  const guard = await guardBrand(req, brandId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  try {
    const conn = await loadGoogleConnection(guard.brandId);

    const lastSync = conn ? (await guardedDb.execute(sql`
      SELECT status, date_from, date_to, query_rows_upserted, page_rows_upserted,
             error_message, started_at, completed_at
      FROM gsc_sync_log
      WHERE brand_id = ${guard.brandId}::uuid
      ORDER BY started_at DESC LIMIT 1
    `)) : null;

    const syncRow = (() => {
      if (!lastSync) return null;
      const rows = Array.isArray(lastSync) ? lastSync : ((lastSync as { rows?: unknown[] }).rows ?? []);
      return rows[0] ?? null;
    })();

    const now = new Date();
    const nextRun = new Date(now);
    nextRun.setUTCHours(4, 0, 0, 0);
    if (nextRun <= now) nextRun.setUTCDate(nextRun.getUTCDate() + 1);

    res.json({
      connected: !!conn,
      email: conn?.["google_account_email"] ?? null,
      gscPropertyUrl: conn?.["gsc_property_url"] ?? null,
      ga4PropertyId: conn?.["ga4_property_id"] ?? null,
      businessProfileAccountName: conn?.["business_profile_account_name"] ?? null,
      businessProfileLocationNames: conn?.["business_profile_location_names"] ?? [],
      lastSync: syncRow,
      syncSchedule: {
        cadence: "daily",
        overlapDays: 7,
        nextRunAt: nextRun.toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to load connection", detail: String(err) });
  }
});

/* ─── GET /properties — list GSC sites ──────────────────────────────────── */
router.get("/properties", async (req, res) => {
  const brandId = req.query["brandId"] as string | undefined;
  const guard = await guardBrand(req, brandId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  try {
    const conn = await loadGoogleConnection(guard.brandId);
    if (!conn) { res.status(404).json({ error: "Google account not connected for this brand" }); return; }

    const accessToken = await ensureFreshGoogleToken(conn);
    const sites = await listGscSites(accessToken);
    res.json({ sites });
  } catch (err) {
    res.status(500).json({ error: "Failed to list GSC properties", detail: String(err) });
  }
});

/* ─── POST /property — save selected GSC property ────────────────────────── */
router.post("/property", async (req, res) => {
  if (!requireAdminOrLead(req, res)) return;
  const { brandId, gscPropertyUrl } = req.body as { brandId?: string; gscPropertyUrl?: string };
  const guard = await guardBrand(req, brandId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  if (!gscPropertyUrl) { res.status(400).json({ error: "gscPropertyUrl required" }); return; }

  try {
    await guardedDb.execute(sql`
      UPDATE google_brand_connections
      SET gsc_property_url = ${gscPropertyUrl}, updated_at = now()
      WHERE brand_id = ${guard.brandId}::uuid
    `);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to save property", detail: String(err) });
  }
});

/* ─── GET /search-performance — aggregated GSC data ─────────────────────── */
router.get("/search-performance", async (req, res) => {
  const brandId = req.query["brandId"] as string | undefined;
  const guard = await guardBrand(req, brandId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const dimension = (req.query["dimension"] as string | undefined) ?? "query"; // query | page | date
  const dateFrom = (req.query["dateFrom"] as string | undefined) ?? (() => {
    const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().slice(0, 10);
  })();
  const dateTo = (req.query["dateTo"] as string | undefined) ?? new Date().toISOString().slice(0, 10);
  const limit = Math.min(Number(req.query["limit"] ?? 100), 500);

  try {
    let rows: unknown[];

    if (dimension === "date") {
      // Aggregate by date across all queries/pages
      const r = await withBrandScope(guard.brandId, async ({ db }) => {
        return db.execute(sql`
          SELECT date::text,
                 SUM(clicks)::int       AS clicks,
                 SUM(impressions)::int  AS impressions,
                 ROUND(AVG(ctr)::numeric, 4)::float     AS ctr,
                 ROUND(AVG(position)::numeric, 2)::float AS position
          FROM gsc_page_rows
          WHERE brand_id = ${guard.brandId}::uuid
            AND date BETWEEN ${dateFrom}::date AND ${dateTo}::date
          GROUP BY date
          ORDER BY date ASC
        `);
      }) as unknown as { rows?: unknown[] } | unknown[];
      rows = Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? []);
    } else if (dimension === "page") {
      const r = await withBrandScope(guard.brandId, async ({ db }) => {
        return db.execute(sql`
          SELECT page,
                 SUM(clicks)::int       AS clicks,
                 SUM(impressions)::int  AS impressions,
                 ROUND(AVG(ctr)::numeric, 4)::float     AS ctr,
                 ROUND(AVG(position)::numeric, 2)::float AS position
          FROM gsc_page_rows
          WHERE brand_id = ${guard.brandId}::uuid
            AND date BETWEEN ${dateFrom}::date AND ${dateTo}::date
          GROUP BY page
          ORDER BY clicks DESC
          LIMIT ${limit}
        `);
      }) as unknown as { rows?: unknown[] } | unknown[];
      rows = Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? []);
    } else {
      // Default: query dimension
      const r = await withBrandScope(guard.brandId, async ({ db }) => {
        return db.execute(sql`
          SELECT query,
                 SUM(clicks)::int       AS clicks,
                 SUM(impressions)::int  AS impressions,
                 ROUND(AVG(ctr)::numeric, 4)::float     AS ctr,
                 ROUND(AVG(position)::numeric, 2)::float AS position
          FROM gsc_query_rows
          WHERE brand_id = ${guard.brandId}::uuid
            AND date BETWEEN ${dateFrom}::date AND ${dateTo}::date
          GROUP BY query
          ORDER BY clicks DESC
          LIMIT ${limit}
        `);
      }) as unknown as { rows?: unknown[] } | unknown[];
      rows = Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? []);
    }

    // Compute totals
    const typedRows = rows as Array<{ clicks: number; impressions: number; ctr: number; position: number }>;
    const totalClicks = typedRows.reduce((s, r) => s + (r.clicks ?? 0), 0);
    const totalImpressions = typedRows.reduce((s, r) => s + (r.impressions ?? 0), 0);
    const avgCtr = typedRows.length ? typedRows.reduce((s, r) => s + Number(r.ctr ?? 0), 0) / typedRows.length : 0;
    const avgPosition = typedRows.length ? typedRows.reduce((s, r) => s + Number(r.position ?? 0), 0) / typedRows.length : 0;

    res.json({
      rows,
      totals: {
        clicks: totalClicks,
        impressions: totalImpressions,
        avgCtr: Math.round(avgCtr * 10000) / 10000,
        avgPosition: Math.round(avgPosition * 100) / 100,
      },
      dateFrom,
      dateTo,
      dimension,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to load search performance", detail: String(err) });
  }
});

/* ─── POST /sync — trigger manual sync ───────────────────────────────────── */
router.post("/sync", async (req, res) => {
  if (!requireAdminOrLead(req, res)) return;
  const { brandId } = req.body as { brandId?: string };
  const guard = await guardBrand(req, brandId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  try {
    const conn = await loadGoogleConnection(guard.brandId);
    if (!conn) { res.status(404).json({ error: "Google account not connected" }); return; }
    if (!conn["gsc_property_url"]) { res.status(400).json({ error: "No GSC property selected" }); return; }

    const { jobId } = await enqueue("seo.sync-gsc-data", {
      idempotencyKey: `gsc-sync:${guard.brandId}-${new Date().toISOString().slice(0, 10)}`,
      brandId: guard.brandId,
    });
    res.json({ ok: true, jobId });
  } catch (err) {
    res.status(500).json({ error: "Failed to queue GSC sync", detail: String(err) });
  }
});

/* ─── GET /sync-log ───────────────────────────────────────────────────────── */
router.get("/sync-log", async (req, res) => {
  const brandId = req.query["brandId"] as string | undefined;
  const guard = await guardBrand(req, brandId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  try {
    const r = await withBrandScope(guard.brandId, async ({ db }) => {
      return db.execute(sql`
        SELECT id::text, status, date_from, date_to,
               query_rows_upserted, page_rows_upserted,
               error_message, started_at, completed_at
        FROM gsc_sync_log
        WHERE brand_id = ${guard.brandId}::uuid
        ORDER BY started_at DESC
        LIMIT 10
      `);
    }) as unknown as { rows?: unknown[] } | unknown[];
    const rows = Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? []);
    res.json({ logs: rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to load sync log", detail: String(err) });
  }
});

export default router;
