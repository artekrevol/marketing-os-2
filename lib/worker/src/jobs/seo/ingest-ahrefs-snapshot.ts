/**
 * seo.ingest-ahrefs-snapshot
 *
 * Reads every XLSX file stored in GCS for a given ahrefs_raw_snapshots row,
 * parses and upserts into the intelligence tables, then marks the snapshot done.
 *
 * Runs in the background via BullMQ so the browser never waits on DB writes
 * and a retry is possible without re-uploading files.
 */
import { sql } from "drizzle-orm";
import { withBrandScope } from "@workspace/db";
import type { JobData } from "@workspace/jobs";
import type { Logger } from "pino";
import {
  readXlsx,
  detectFileType,
  validateHeaders,
  REQUIRED_HEADERS,
  ingestBacklinks,
  ingestReferringDomains,
  ingestAnchors,
  ingestBestByLinks,
  ingestTopPages,
  ingestOrganicKeywords,
  ingestContentGap,
  type IngestCounts,
} from "./ahrefs-ingest-fns.js";

const SIDECAR = "http://127.0.0.1:1106";

type FileEntry = { name: string; objectName: string; size: number };

async function gcsGetSignedUrl(objectName: string): Promise<string> {
  const bucket = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
  if (!bucket) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
  const res = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucket,
      object_name: objectName,
      method: "GET",
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Sidecar GET sign failed (${res.status})`);
  const { signed_url } = (await res.json()) as { signed_url: string };
  return signed_url;
}

async function downloadBuffer(objectName: string): Promise<Buffer> {
  const url = await gcsGetSignedUrl(objectName);
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`GCS download failed (${res.status}): ${objectName}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

export async function handleSeoIngestAhrefsSnapshot(
  data: JobData<"seo.ingest-ahrefs-snapshot">,
  log: Logger,
): Promise<{ rowCounts: IngestCounts }> {
  const { brandId, snapshotId } = data;

  // ── 1. Load snapshot record ────────────────────────────────────────────
  const snap = await withBrandScope(brandId, async ({ db }) => {
    const r = (await db.execute(sql`
      SELECT id::text, snapshot_month, status, file_paths
      FROM ahrefs_raw_snapshots
      WHERE id = ${snapshotId}::uuid AND brand_id = ${brandId}::uuid
      LIMIT 1
    `)) as unknown as { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
    const rows = Array.isArray(r) ? r : (r.rows ?? []);
    return rows[0] ?? null;
  });

  if (!snap) throw new Error(`Snapshot ${snapshotId} not found for brand ${brandId}`);

  const filePaths = (snap["file_paths"] as FileEntry[]) ?? [];
  if (filePaths.length === 0) throw new Error("Snapshot has no files");
  const expectedPrefix = `ahrefs/${brandId}/${String(snap["snapshot_month"] ?? "")}/`;
  for (const entry of filePaths) {
    if (
      !entry ||
      typeof entry.objectName !== "string" ||
      !entry.objectName.startsWith(expectedPrefix) ||
      entry.objectName.includes("..")
    ) {
      throw new Error(`Snapshot contains an object outside the brand storage prefix`);
    }
  }

  // ── 2. Mark as ingesting ───────────────────────────────────────────────
  await withBrandScope(brandId, async ({ db }) => {
    await db.execute(sql`
      UPDATE ahrefs_raw_snapshots
      SET status = 'ingesting', ingest_started_at = now()
      WHERE id = ${snapshotId}::uuid AND brand_id = ${brandId}::uuid
    `);
  });

  log.info({ snapshotId, fileCount: filePaths.length }, "ahrefs-ingest: starting");

  try {
    // ── 3. Snapshot pre-import active-backlink count (for delta) ──────
    const prevActiveBacklinks = await withBrandScope(brandId, async ({ db }) => {
      const r = (await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM ahrefs_backlinks
        WHERE brand_id = ${brandId}::uuid AND is_lost = false
      `)) as unknown as { rows?: Array<{ n: number }> } | Array<{ n: number }>;
      const rows = Array.isArray(r) ? r : (r.rows ?? []);
      return Number((rows[0] as { n: number } | undefined)?.n ?? 0);
    });

    // ── 4. Create import batch ─────────────────────────────────────────
    const batchId = await withBrandScope(brandId, async ({ db }) => {
      const r = (await db.execute(sql`
        INSERT INTO ahrefs_import_batches (brand_id, file_count, imported_at, created_at)
        VALUES (${brandId}::uuid, ${filePaths.length}, now(), now())
        RETURNING id::text
      `)) as unknown as { rows?: Array<{ id: string }> } | Array<{ id: string }>;
      const rows = Array.isArray(r) ? r : (r.rows ?? []);
      return rows[0]?.id ?? null;
    });
    if (!batchId) throw new Error("Failed to create import batch");

    // ── 5. Download + parse + ingest each file ────────────────────────
    const counts: IngestCounts = {
      backlinks: 0, brokenBacklinks: 0, referringDomains: 0,
      anchors: 0, pagePerformance: 0, organicKeywords: 0,
      contentGap: 0, bestByLinks: 0,
    };

    for (const entry of filePaths) {
      const fileType = detectFileType(entry.name);
      if (!fileType || fileType === "linking_authors" || fileType === "referring_ips") {
        log.info({ name: entry.name, fileType }, "ahrefs-ingest: skipping (not ingested)");
        continue;
      }

      log.info({ name: entry.name, fileType }, "ahrefs-ingest: downloading");
      const buffer = await downloadBuffer(entry.objectName);
      const rows = readXlsx(buffer);
      if (rows.length === 0) {
        log.warn({ name: entry.name }, "ahrefs-ingest: empty file, skipping");
        continue;
      }

      const reqHeaders = REQUIRED_HEADERS[fileType];
      if (reqHeaders) {
        const headerErr = validateHeaders(rows, reqHeaders, entry.name);
        if (headerErr) {
          log.warn({ name: entry.name, headerErr }, "ahrefs-ingest: header validation failed");
          continue;
        }
      }

      await withBrandScope(brandId, async ({ db }) => {
        const exec = (q: ReturnType<typeof sql>) => db.execute(q) as Promise<unknown>;
        if (fileType === "backlinks")
          counts.backlinks += await ingestBacklinks(brandId, batchId, rows, false, exec);
        else if (fileType === "broken_backlinks")
          counts.brokenBacklinks += await ingestBacklinks(brandId, batchId, rows, true, exec);
        else if (fileType === "referring_domains")
          counts.referringDomains += await ingestReferringDomains(brandId, rows, exec);
        else if (fileType === "anchors")
          counts.anchors += await ingestAnchors(brandId, batchId, rows, exec);
        else if (fileType === "top_pages")
          counts.pagePerformance += await ingestTopPages(brandId, batchId, rows, exec);
        else if (fileType === "organic_keywords")
          counts.organicKeywords += await ingestOrganicKeywords(brandId, rows, exec);
        else if (fileType === "content_gap")
          counts.contentGap += await ingestContentGap(brandId, batchId, rows, exec);
        else if (fileType === "best_by_links")
          counts.bestByLinks += await ingestBestByLinks(brandId, rows, exec);
      });

      log.info({ name: entry.name, fileType }, "ahrefs-ingest: file done");
    }

    // ── 6. Compute delta ──────────────────────────────────────────────
    const delta = await withBrandScope(brandId, async ({ db }) => {
      const r = (await db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM ahrefs_backlinks WHERE brand_id = ${brandId}::uuid AND is_lost = false) AS curr_active,
          (SELECT count(*)::int FROM ahrefs_backlinks WHERE brand_id = ${brandId}::uuid AND is_lost = true AND import_batch_id = ${batchId}::uuid) AS lost_links,
          (SELECT count(*)::int FROM ahrefs_content_gap WHERE brand_id = ${brandId}::uuid AND import_batch_id = ${batchId}::uuid) AS gap_keywords,
          (SELECT count(*)::int FROM ahrefs_page_performance WHERE brand_id = ${brandId}::uuid AND import_batch_id = ${batchId}::uuid AND status = 'Active' AND prev_traffic IS NOT NULL AND curr_traffic > prev_traffic) AS pages_recovered,
          (SELECT count(*)::int FROM ahrefs_page_performance WHERE brand_id = ${brandId}::uuid AND import_batch_id = ${batchId}::uuid AND prev_traffic > 0 AND traffic_change < -(prev_traffic * 0.5)) AS pages_crashed
      `)) as unknown as { rows?: Array<Record<string, number>> } | Array<Record<string, number>>;
      const rows = Array.isArray(r) ? r : (r.rows ?? []);
      const row = rows[0] ?? {};
      return {
        newLinks: Math.max(0, Number(row["curr_active"] ?? 0) - prevActiveBacklinks),
        lostLinks: Number(row["lost_links"] ?? 0),
        newGapKeywords: Number(row["gap_keywords"] ?? 0),
        pagesRecovered: Number(row["pages_recovered"] ?? 0),
        pagesCrashed: Number(row["pages_crashed"] ?? 0),
      };
    });

    // ── 7. Update batch + snapshot ────────────────────────────────────
    await withBrandScope(brandId, async ({ db }) => {
      await db.execute(sql`
        UPDATE ahrefs_import_batches SET
          file_count              = ${filePaths.length},
          backlink_count          = ${counts.backlinks + counts.brokenBacklinks},
          referring_domain_count  = ${counts.referringDomains},
          anchor_count            = ${counts.anchors},
          page_count              = ${counts.pagePerformance},
          organic_keyword_count   = ${counts.organicKeywords},
          content_gap_count       = ${counts.contentGap},
          delta_new_links         = ${delta.newLinks},
          delta_lost_links        = ${delta.lostLinks},
          delta_new_gap_keywords  = ${delta.newGapKeywords},
          delta_pages_recovered   = ${delta.pagesRecovered},
          delta_pages_crashed     = ${delta.pagesCrashed}
        WHERE id = ${batchId}::uuid
          AND brand_id = ${brandId}::uuid
      `);
      await db.execute(sql`
        UPDATE ahrefs_raw_snapshots SET
          status               = 'done',
          batch_id             = ${batchId}::uuid,
          row_counts           = ${JSON.stringify(counts)}::jsonb,
          ingest_completed_at  = now()
        WHERE id = ${snapshotId}::uuid AND brand_id = ${brandId}::uuid
      `);
    });

    log.info({ snapshotId, counts, delta }, "ahrefs-ingest: completed");
    return { rowCounts: counts };
  } catch (err) {
    // ── Error path: record failure on snapshot ─────────────────────────
    const errMsg = String(err);
    await withBrandScope(brandId, async ({ db }) => {
      await db.execute(sql`
        UPDATE ahrefs_raw_snapshots SET
          status        = 'error',
          error_message = ${errMsg}
        WHERE id = ${snapshotId}::uuid AND brand_id = ${brandId}::uuid
      `);
    }).catch(() => {}); // don't double-throw
    throw err;
  }
}
