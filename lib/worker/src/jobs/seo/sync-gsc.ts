/**
 * seo.sync-gsc-data    — pull GSC search analytics for one brand and upsert into DB.
 * seo.sync-gsc.nightly — fan-out: enqueue seo.sync-gsc-data for every connected brand.
 *
 * GSC data has a ~2-3 day lag, so we always re-fetch the last 7 days
 * on top of any new dates to capture late-arriving clicks.
 * The unique indexes on gsc_query_rows / gsc_page_rows make this safe.
 */
import { sql } from "drizzle-orm";
import { guardedDb, withBrandScope } from "@workspace/db";
import { enqueue, type JobData } from "@workspace/jobs";
import type { Logger } from "pino";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GSC_ANALYTICS_BASE = "https://searchconsole.googleapis.com/webmasters/v3/sites";

/* ── token refresh (inline to avoid cross-package dep) ────────────────────── */

function getGoogleCreds() {
  const clientId = process.env["GOOGLE_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set");
  return { clientId, clientSecret };
}

async function refreshToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const { clientId, clientSecret } = getGoogleCreds();
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Token refresh failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

interface ConnectionRow {
  id: string;
  access_token: string;
  refresh_token: string;
  token_expiry: string;
  gsc_property_url: string | null;
}

async function loadAndRefreshConnection(brandId: string): Promise<{ token: string; propertyUrl: string } | null> {
  const r = (await guardedDb.execute(sql`
    SELECT id::text, access_token, refresh_token, token_expiry, gsc_property_url
    FROM google_brand_connections
    WHERE brand_id = ${brandId}::uuid
    LIMIT 1
  `)) as unknown as { rows?: ConnectionRow[] } | ConnectionRow[];
  const rows = Array.isArray(r) ? r : ((r as { rows?: ConnectionRow[] }).rows ?? []);
  const conn = rows[0];
  if (!conn) return null;
  if (!conn.gsc_property_url) return null; // not configured

  // Refresh token if expiring within 5 min
  let token = conn.access_token;
  const expiry = new Date(conn.token_expiry);
  if (expiry <= new Date(Date.now() + 5 * 60 * 1000)) {
    const fresh = await refreshToken(conn.refresh_token);
    token = fresh.access_token;
    const newExpiry = new Date(Date.now() + fresh.expires_in * 1000);
    await guardedDb.execute(sql`
      UPDATE google_brand_connections
      SET access_token = ${token}, token_expiry = ${newExpiry.toISOString()}, updated_at = now()
      WHERE id = ${conn.id}::uuid
    `);
  }
  return { token, propertyUrl: conn.gsc_property_url };
}

/* ── GSC search analytics fetch ───────────────────────────────────────────── */

interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

async function fetchSearchAnalytics(
  token: string,
  propertyUrl: string,
  dimensions: string[],
  dateFrom: string,
  dateTo: string,
  startRow = 0,
): Promise<GscRow[]> {
  const encodedUrl = encodeURIComponent(propertyUrl);
  const res = await fetch(`${GSC_ANALYTICS_BASE}/${encodedUrl}/searchAnalytics/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startDate: dateFrom,
      endDate: dateTo,
      dimensions,
      rowLimit: 25000,
      startRow,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GSC search analytics failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { rows?: GscRow[] };
  return data.rows ?? [];
}

/* ── upsert helpers ───────────────────────────────────────────────────────── */

type DbClient = Parameters<Parameters<typeof withBrandScope>[1]>[0]["db"];

async function upsertQueryRows(db: DbClient, brandId: string, rows: GscRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  let count = 0;
  // Batch in chunks of 500 to avoid huge parameter lists
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const values = chunk.map((r) => {
      const [date = "", query = "", page = "", country = "", device = ""] = r.keys;
      return sql`(${brandId}::uuid, ${date}::date, ${query}, ${page}, ${country}, ${device},
                  ${r.clicks}, ${r.impressions}, ${r.ctr}::numeric, ${r.position}::numeric, now())`;
    });
    await db.execute(sql`
      INSERT INTO gsc_query_rows
        (brand_id, date, query, page, country, device, clicks, impressions, ctr, position, synced_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT ON CONSTRAINT gsc_query_rows_uq
      DO UPDATE SET
        clicks      = EXCLUDED.clicks,
        impressions = EXCLUDED.impressions,
        ctr         = EXCLUDED.ctr,
        position    = EXCLUDED.position,
        synced_at   = EXCLUDED.synced_at
    `);
    count += chunk.length;
  }
  return count;
}

async function upsertPageRows(db: DbClient, brandId: string, rows: GscRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  let count = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const values = chunk.map((r) => {
      const [date = "", page = "", country = "", device = ""] = r.keys;
      return sql`(${brandId}::uuid, ${date}::date, ${page}, ${country}, ${device},
                  ${r.clicks}, ${r.impressions}, ${r.ctr}::numeric, ${r.position}::numeric, now())`;
    });
    await db.execute(sql`
      INSERT INTO gsc_page_rows
        (brand_id, date, page, country, device, clicks, impressions, ctr, position, synced_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT ON CONSTRAINT gsc_page_rows_uq
      DO UPDATE SET
        clicks      = EXCLUDED.clicks,
        impressions = EXCLUDED.impressions,
        ctr         = EXCLUDED.ctr,
        position    = EXCLUDED.position,
        synced_at   = EXCLUDED.synced_at
    `);
    count += chunk.length;
  }
  return count;
}

/* ── job handlers ─────────────────────────────────────────────────────────── */

export async function handleSeoSyncGscData(
  data: JobData<"seo.sync-gsc-data">,
  log: Logger,
): Promise<{ queryRowsUpserted: number; pageRowsUpserted: number }> {
  const { brandId } = data;

  // Calculate date range: last 90 days, always re-fetch last 7 for GSC data lag
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 90);
  const dateFrom = data.dateFrom ?? fromDate.toISOString().slice(0, 10);
  const dateTo = data.dateTo ?? toDate.toISOString().slice(0, 10);

  // Load + refresh connection
  const conn = await loadAndRefreshConnection(brandId);
  if (!conn) {
    log.warn({ brandId }, "gsc-sync: no connection or no property set — skipping");
    return { queryRowsUpserted: 0, pageRowsUpserted: 0 };
  }

  // Create sync log row
  const logRes = (await guardedDb.execute(sql`
    INSERT INTO gsc_sync_log (brand_id, status, date_from, date_to)
    VALUES (${brandId}::uuid, 'running', ${dateFrom}::date, ${dateTo}::date)
    RETURNING id::text
  `)) as unknown as { rows?: Array<{ id: string }> } | Array<{ id: string }>;
  const logRows = Array.isArray(logRes) ? logRes : ((logRes as { rows?: Array<{ id: string }> }).rows ?? []);
  const syncLogId = logRows[0]?.id ?? null;

  try {
    log.info({ brandId, dateFrom, dateTo, property: conn.propertyUrl }, "gsc-sync: fetching query rows");

    // Fetch query-level rows (date + query + page + country + device)
    const queryRows1 = await fetchSearchAnalytics(
      conn.token, conn.propertyUrl,
      ["date", "query", "page", "country", "device"],
      dateFrom, dateTo, 0,
    );
    // Paginate if we hit the 25k row limit
    let allQueryRows = queryRows1;
    if (queryRows1.length === 25000) {
      const queryRows2 = await fetchSearchAnalytics(
        conn.token, conn.propertyUrl,
        ["date", "query", "page", "country", "device"],
        dateFrom, dateTo, 25000,
      );
      allQueryRows = [...queryRows1, ...queryRows2];
    }

    log.info({ brandId, count: allQueryRows.length }, "gsc-sync: fetching page rows");

    // Fetch page-level rows (date + page + country + device)
    const pageRows1 = await fetchSearchAnalytics(
      conn.token, conn.propertyUrl,
      ["date", "page", "country", "device"],
      dateFrom, dateTo, 0,
    );
    let allPageRows = pageRows1;
    if (pageRows1.length === 25000) {
      const pageRows2 = await fetchSearchAnalytics(
        conn.token, conn.propertyUrl,
        ["date", "page", "country", "device"],
        dateFrom, dateTo, 25000,
      );
      allPageRows = [...pageRows1, ...pageRows2];
    }

    // Upsert into DB inside brand scope
    let queryRowsUpserted = 0;
    let pageRowsUpserted = 0;

    await withBrandScope(brandId, async ({ db }) => {
      queryRowsUpserted = await upsertQueryRows(db, brandId, allQueryRows);
      pageRowsUpserted = await upsertPageRows(db, brandId, allPageRows);
    });

    // Update sync log → done
    if (syncLogId) {
      await guardedDb.execute(sql`
        UPDATE gsc_sync_log
        SET status = 'done',
            query_rows_upserted = ${queryRowsUpserted},
            page_rows_upserted = ${pageRowsUpserted},
            completed_at = now()
        WHERE id = ${syncLogId}::uuid
      `);
    }

    log.info({ brandId, queryRowsUpserted, pageRowsUpserted }, "gsc-sync: complete");
    return { queryRowsUpserted, pageRowsUpserted };
  } catch (err) {
    if (syncLogId) {
      await guardedDb.execute(sql`
        UPDATE gsc_sync_log
        SET status = 'error', error_message = ${String(err)}, completed_at = now()
        WHERE id = ${syncLogId}::uuid
      `).catch(() => {/* ignore */});
    }
    throw err;
  }
}

export async function handleSeoSyncGscNightly(
  _data: JobData<"seo.sync-gsc.nightly">,
  log: Logger,
): Promise<{ enqueued: number }> {
  // Find all brands with an active Google connection AND a GSC property set
  const r = (await guardedDb.execute(sql`
    SELECT brand_id::text FROM google_brand_connections
    WHERE gsc_property_url IS NOT NULL
  `)) as unknown as { rows?: Array<{ brand_id: string }> } | Array<{ brand_id: string }>;
  const rows = Array.isArray(r) ? r : ((r as { rows?: Array<{ brand_id: string }> }).rows ?? []);

  let enqueued = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const { brand_id } of rows) {
    try {
      await enqueue("seo.sync-gsc-data", {
        idempotencyKey: `gsc-sync:${brand_id}:${today}`,
        brandId: brand_id,
      });
      enqueued++;
    } catch (err) {
      log.error({ err, brandId: brand_id }, "gsc-nightly: failed to enqueue brand sync");
    }
  }

  log.info({ enqueued }, "gsc-nightly: fan-out complete");
  return { enqueued };
}
