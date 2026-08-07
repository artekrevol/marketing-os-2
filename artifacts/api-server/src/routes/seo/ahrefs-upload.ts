import { Router, type IRouter } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { sql } from "drizzle-orm";
import { withBrandScope } from "@workspace/db";
import { requireAuth } from "../../middlewares/auth.js";
import { guardBrand, requireAdminOrLead, fail } from "./_shared.js";

const router: IRouter = Router();
router.use(requireAuth);

/** In-memory storage — files are parsed and discarded immediately. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 12 },
});

// ---- helpers ---------------------------------------------------------------

function safeStr(v: unknown): string | null {
  if (v == null || v === "" || v === "null") return null;
  return String(v).trim() || null;
}

function safeInt(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function safeNum(v: unknown): string | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : null;
}

function safeBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true" || v === "1";
  return Boolean(v);
}

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

function readXlsx(buf: Buffer): Record<string, unknown>[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]!];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: null }) as Record<string, unknown>[];
}

/** Detect which Ahrefs export a file is by its name */
function detectFileType(filename: string): string | null {
  const n = filename.toLowerCase();
  if (n.includes("backlinks") && n.includes("brokenbacklinks")) return "broken_backlinks";
  if (n.includes("brokenbacklinks")) return "broken_backlinks";
  if (n.includes("referringdomains")) return "referring_domains";
  if (n.includes("anchors")) return "anchors";
  if (n.includes("backlinks")) return "backlinks";
  if (n.includes("organickeywords")) return "organic_keywords";
  if (n.includes("toppages")) return "top_pages";
  if (n.includes("bestbylinks")) return "best_by_links";
  if (n.includes("contentgap")) return "content_gap";
  if (n.includes("linkingauthors")) return "linking_authors"; // ignored
  if (n.includes("referringips")) return "referring_ips"; // ignored
  return null;
}

// ---- ingestion helpers (return row count) ----------------------------------

async function ingestBacklinks(
  brandId: string,
  batchId: string,
  rows: Record<string, unknown>[],
  brokenOnly: boolean,
  dbExec: (q: ReturnType<typeof sql>) => Promise<unknown>,
): Promise<number> {
  let count = 0;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    for (const row of chunk) {
      const isLost = brokenOnly
        ? false // broken backlinks aren't "lost" — they point to dead pages on our side
        : safeBool(row["Lost"]);
      const lostAt = isLost ? parseDate(row["Last seen"]) : null;

      await dbExec(sql`
        INSERT INTO ahrefs_backlinks
          (brand_id, import_batch_id, referring_page_url, referring_page_title,
           language, platform, referring_page_http_code, dr, ur, domain_traffic,
           page_traffic, target_url, anchor, left_context, right_context,
           link_type, is_nofollow, is_spam, is_ugc, is_sponsored,
           is_lost, drop_reason, first_seen, last_seen, lost_at, page_type, author,
           created_at, updated_at)
        VALUES (
          ${brandId}::uuid, ${batchId}::uuid,
          ${safeStr(row["Referring page URL"])},
          ${safeStr(row["Referring page title"])},
          ${safeStr(row["Language"])},
          ${safeStr(row["Platform"])},
          ${safeInt(row["Referring page HTTP code"])},
          ${safeNum(row["Domain rating"])},
          ${safeNum(row["UR"])},
          ${safeInt(row["Domain traffic"])},
          ${safeInt(row["Page traffic"])},
          ${safeStr(row["Target URL"])},
          ${safeStr(row["Anchor"])},
          ${safeStr(row["Left context"])},
          ${safeStr(row["Right context"])},
          ${safeStr(row["Type"])},
          ${safeBool(row["Nofollow"])},
          ${safeBool(row["Is spam"])},
          ${safeBool(row["UGC"])},
          ${safeBool(row["Sponsored"])},
          ${isLost},
          ${safeStr(row["Drop reason"])},
          ${parseDate(row["First seen"])},
          ${parseDate(row["Last seen"])},
          ${lostAt},
          ${safeStr(row["Page type"])},
          ${safeStr(row["Author"])},
          now(), now()
        )
        ON CONFLICT (brand_id, referring_page_url)
        DO UPDATE SET
          import_batch_id   = EXCLUDED.import_batch_id,
          referring_page_title = EXCLUDED.referring_page_title,
          dr                = EXCLUDED.dr,
          ur                = EXCLUDED.ur,
          domain_traffic    = EXCLUDED.domain_traffic,
          page_traffic      = EXCLUDED.page_traffic,
          target_url        = EXCLUDED.target_url,
          anchor            = EXCLUDED.anchor,
          is_nofollow       = EXCLUDED.is_nofollow,
          is_spam           = EXCLUDED.is_spam,
          is_lost           = EXCLUDED.is_lost,
          drop_reason       = EXCLUDED.drop_reason,
          first_seen        = COALESCE(ahrefs_backlinks.first_seen, EXCLUDED.first_seen),
          last_seen         = EXCLUDED.last_seen,
          lost_at           = EXCLUDED.lost_at,
          updated_at        = now()
      `);
      count++;
    }
  }
  return count;
}

async function ingestReferringDomains(
  brandId: string,
  rows: Record<string, unknown>[],
  dbExec: (q: ReturnType<typeof sql>) => Promise<unknown>,
): Promise<number> {
  let count = 0;
  for (const row of rows) {
    const domain = safeStr(row["Domain"]);
    if (!domain) continue;
    const isLost = safeStr(row["Lost"]) != null;
    await dbExec(sql`
      INSERT INTO referring_domains
        (brand_id, domain, dr, backlinks_count, linked_domains, dofollow_links,
         is_lost, is_spam, traffic_domain, first_seen, last_seen,
         source_provider, source_metadata, ahrefs_last_updated, created_at, updated_at)
      VALUES (
        ${brandId}::uuid, ${domain},
        ${safeNum(row["DR"])},
        ${safeInt(row["Links to target"])},
        ${safeInt(row["Dofollow linked domains"])},
        ${safeInt(row["Dofollow links"])},
        ${isLost},
        ${safeBool(row["Is spam"])},
        ${safeInt(row["Traffic "] ?? row["Traffic"])},
        ${parseDate(row["First seen"])},
        ${isLost ? parseDate(row["Lost"]) : null},
        'ahrefs_bulk_import', '{}', now(), now(), now()
      )
      ON CONFLICT (brand_id, domain)
      DO UPDATE SET
        dr                 = EXCLUDED.dr,
        backlinks_count    = EXCLUDED.backlinks_count,
        linked_domains     = EXCLUDED.linked_domains,
        dofollow_links     = EXCLUDED.dofollow_links,
        is_lost            = EXCLUDED.is_lost,
        is_spam            = EXCLUDED.is_spam,
        traffic_domain     = EXCLUDED.traffic_domain,
        first_seen         = COALESCE(referring_domains.first_seen, EXCLUDED.first_seen),
        last_seen          = EXCLUDED.last_seen,
        ahrefs_last_updated = now(),
        updated_at         = now()
    `);
    count++;
  }
  return count;
}

async function ingestAnchors(
  brandId: string,
  batchId: string,
  rows: Record<string, unknown>[],
  dbExec: (q: ReturnType<typeof sql>) => Promise<unknown>,
): Promise<number> {
  let count = 0;
  for (const row of rows) {
    const anchorText = safeStr(row["Anchor text"]);
    if (anchorText == null) continue;
    await dbExec(sql`
      INSERT INTO ahrefs_anchors
        (brand_id, import_batch_id, anchor_text, ref_domains_count, top_dr,
         ref_pages_count, links_to_target, new_links, lost_links, dofollow_links,
         first_seen, is_lost, created_at, updated_at)
      VALUES (
        ${brandId}::uuid, ${batchId}::uuid,
        ${anchorText},
        ${safeInt(row["Ref. domains"])},
        ${safeInt(row["Top DR"])},
        ${safeInt(row["Ref. pages"])},
        ${safeInt(row["Links to target"])},
        ${safeInt(row["New links"])},
        ${safeInt(row["Lost links"])},
        ${safeInt(row["Dofollow links"])},
        ${parseDate(row["First seen"])},
        ${safeStr(row["Lost"]) != null},
        now(), now()
      )
      ON CONFLICT (brand_id, anchor_text)
      DO UPDATE SET
        import_batch_id  = EXCLUDED.import_batch_id,
        ref_domains_count = EXCLUDED.ref_domains_count,
        top_dr           = EXCLUDED.top_dr,
        ref_pages_count  = EXCLUDED.ref_pages_count,
        links_to_target  = EXCLUDED.links_to_target,
        new_links        = EXCLUDED.new_links,
        lost_links       = EXCLUDED.lost_links,
        dofollow_links   = EXCLUDED.dofollow_links,
        is_lost          = EXCLUDED.is_lost,
        updated_at       = now()
    `);
    count++;
  }
  return count;
}

async function ingestTopPages(
  brandId: string,
  batchId: string,
  rows: Record<string, unknown>[],
  dbExec: (q: ReturnType<typeof sql>) => Promise<unknown>,
): Promise<number> {
  let count = 0;
  for (const row of rows) {
    const url = safeStr(row["URL"]);
    if (!url) continue;
    const prevTraffic = safeInt(row["Previous traffic"]);
    const currTraffic = safeInt(row["Current traffic"]);
    const trafficChange =
      prevTraffic != null && currTraffic != null
        ? currTraffic - prevTraffic
        : safeInt(row["Traffic change"]);
    await dbExec(sql`
      INSERT INTO ahrefs_page_performance
        (brand_id, import_batch_id, url, status, ur, prev_traffic, curr_traffic,
         traffic_change, prev_traffic_value, curr_traffic_value, curr_ref_domains,
         prev_keywords, curr_keywords, page_type, prev_top_keyword, curr_top_keyword,
         created_at, updated_at)
      VALUES (
        ${brandId}::uuid, ${batchId}::uuid,
        ${url},
        ${safeStr(row["Status"])},
        ${safeNum(row["UR"])},
        ${prevTraffic},
        ${currTraffic},
        ${trafficChange},
        ${safeNum(row["Previous traffic value"])},
        ${safeNum(row["Current traffic value"])},
        ${safeInt(row["Current referring domains"])},
        ${safeInt(row["Previous # of keywords"])},
        ${safeInt(row["Current # of keywords"])},
        ${safeStr(row["Page type"])},
        ${safeStr(row["Previous top keyword"])},
        ${safeStr(row["Current top keyword"])},
        now(), now()
      )
      ON CONFLICT (brand_id, url)
      DO UPDATE SET
        import_batch_id    = EXCLUDED.import_batch_id,
        status             = EXCLUDED.status,
        ur                 = EXCLUDED.ur,
        prev_traffic       = EXCLUDED.prev_traffic,
        curr_traffic       = EXCLUDED.curr_traffic,
        traffic_change     = EXCLUDED.traffic_change,
        prev_traffic_value = EXCLUDED.prev_traffic_value,
        curr_traffic_value = EXCLUDED.curr_traffic_value,
        curr_ref_domains   = EXCLUDED.curr_ref_domains,
        prev_keywords      = EXCLUDED.prev_keywords,
        curr_keywords      = EXCLUDED.curr_keywords,
        page_type          = EXCLUDED.page_type,
        curr_top_keyword   = EXCLUDED.curr_top_keyword,
        updated_at         = now()
    `);
    count++;
  }
  return count;
}

async function ingestOrganicKeywords(
  brandId: string,
  rows: Record<string, unknown>[],
  dbExec: (q: ReturnType<typeof sql>) => Promise<unknown>,
): Promise<number> {
  let count = 0;
  for (const row of rows) {
    const keyword = safeStr(row["Keyword"]);
    if (!keyword) continue;

    const intentFlags = JSON.stringify({
      informational: safeBool(row["Informational"]),
      commercial: safeBool(row["Commercial"]),
      transactional: safeBool(row["Transactional"]),
      navigational: safeBool(row["Navigational"]),
      branded: safeBool(row["Branded"]),
    });
    const isBranded = safeBool(row["Branded"]);
    const currPos = safeInt(row["Current position"]);
    const currUrl = safeStr(row["Current URL"]);
    const kd = safeNum(row["KD"]);
    const sumTraffic = safeInt(row["Current organic traffic"]);
    const cpc = safeNum(row["CPC"]);

    // Upsert into the existing keywords table matching on (brand_id, keyword_text).
    // We need to pick ANY matching location — use the first available location for this brand.
    // If no keyword exists, we skip (keywords must be manually added per location).
    // If a match exists (any location), we update the Ahrefs columns.
    await dbExec(sql`
      UPDATE keywords
      SET
        ahrefs_best_position     = ${currPos},
        ahrefs_best_position_url = ${currUrl},
        ahrefs_keyword_difficulty = ${kd},
        ahrefs_sum_traffic       = ${sumTraffic},
        ahrefs_intent_flags      = ${intentFlags}::jsonb,
        ahrefs_cpc               = ${cpc},
        is_branded               = ${isBranded},
        ahrefs_last_updated      = now(),
        updated_at               = now()
      WHERE brand_id = ${brandId}::uuid
        AND lower(keyword_text) = lower(${keyword})
    `);
    count++;
  }
  return count;
}

async function ingestContentGap(
  brandId: string,
  batchId: string,
  rows: Record<string, unknown>[],
  dbExec: (q: ReturnType<typeof sql>) => Promise<unknown>,
): Promise<number> {
  let count = 0;
  if (rows.length === 0) return 0;

  // Detect competitor domains from the column headers
  const sampleKeys = Object.keys(rows[0]!);
  // Columns look like "appinventiv.com/: URL", "appinventiv.com/: Organic Position"
  const competitorDomains = [
    ...new Set(
      sampleKeys
        .filter((k) => k.includes(": URL") && !k.startsWith("www.tekrevol"))
        .map((k) => k.split(":")[0]!.trim()),
    ),
  ];

  for (const row of rows) {
    const keyword = safeStr(row["Keyword"]);
    if (!keyword) continue;

    const intentsRaw = safeStr(row["Intents"]);
    const intents = intentsRaw
      ? intentsRaw
          .replace(/^"|"$/g, "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const volume = safeInt(row["Volume"]);
    const kd = safeInt(row["KD"]);
    const cpc = safeNum(row["CPC"]);

    // Our data (might be null if we don't rank)
    const ourUrl = safeStr(row["www.tekrevol.com/: URL"]);
    const ourPosition = safeInt(row["www.tekrevol.com/: Organic Position"]);
    const ourTraffic = safeInt(row["www.tekrevol.com/: Organic Traffic"]);

    const priorityScore =
      volume != null && kd != null ? Math.round(volume * (1 - kd / 100)) : null;

    for (const comp of competitorDomains) {
      const compUrl = safeStr(row[`${comp}: URL`]);
      const compPos = safeInt(row[`${comp}: Organic Position`]);
      const compTraffic = safeInt(row[`${comp}: Organic Traffic`]);

      if (!compPos) continue; // competitor doesn't rank for this keyword either

      await dbExec(sql`
        INSERT INTO ahrefs_content_gap
          (brand_id, import_batch_id, keyword, intents, volume, kd, cpc,
           our_url, our_position, our_traffic,
           competitor_domain, competitor_url, competitor_position, competitor_traffic,
           priority_score, created_at, updated_at)
        VALUES (
          ${brandId}::uuid, ${batchId}::uuid,
          ${keyword},
          ${intents.length > 0 ? intents : null}::text[],
          ${volume}, ${kd}, ${cpc},
          ${ourUrl}, ${ourPosition}, ${ourTraffic},
          ${comp}, ${compUrl}, ${compPos}, ${compTraffic},
          ${priorityScore}, now(), now()
        )
        ON CONFLICT (brand_id, keyword, competitor_domain)
        DO UPDATE SET
          import_batch_id      = EXCLUDED.import_batch_id,
          intents              = EXCLUDED.intents,
          volume               = EXCLUDED.volume,
          kd                   = EXCLUDED.kd,
          cpc                  = EXCLUDED.cpc,
          our_url              = EXCLUDED.our_url,
          our_position         = EXCLUDED.our_position,
          our_traffic          = EXCLUDED.our_traffic,
          competitor_url       = EXCLUDED.competitor_url,
          competitor_position  = EXCLUDED.competitor_position,
          competitor_traffic   = EXCLUDED.competitor_traffic,
          priority_score       = EXCLUDED.priority_score,
          updated_at           = now()
      `);
      count++;
    }
  }
  return count;
}

// ---- upload route ----------------------------------------------------------

/**
 * POST /api/seo/ahrefs/upload
 *
 * Accepts up to 12 Ahrefs XLSX export files via multipart/form-data.
 * Detects file type from filename, parses rows, upserts into the
 * appropriate tables, and returns a diff summary.
 */
router.post("/upload", upload.array("files", 12), async (req, res) => {
  if (!requireAdminOrLead(req, res)) return;

  const brandId = (req.body as Record<string, string>)["brandId"];
  const guard = await guardBrand(req, brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }

  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    res.status(400).json({ error: "No files provided" });
    return;
  }

  try {
    const counts = {
      backlinks: 0,
      brokenBacklinks: 0,
      referringDomains: 0,
      anchors: 0,
      pagePerformance: 0,
      organicKeywords: 0,
      contentGap: 0,
      fileCount: 0,
    };

    // Create the batch row first so we can attach rows to it
    const batchResult = await withBrandScope(guard.brandId, async ({ db }) => {
      const r = (await db.execute(sql`
        INSERT INTO ahrefs_import_batches (brand_id, file_count, imported_at, created_at)
        VALUES (${guard.brandId}::uuid, ${files.length}, now(), now())
        RETURNING id::text
      `)) as unknown as { rows?: Array<{ id: string }> } | Array<{ id: string }>;
      const rows = Array.isArray(r) ? r : (r.rows ?? []);
      return rows[0]?.id ?? null;
    });

    if (!batchResult) throw new Error("Failed to create import batch");
    const batchId = batchResult;

    // Snapshot active-backlink count BEFORE upserting so we can compute a true net-new delta.
    // (After upsert every row gets import_batch_id = current batch, so we can't distinguish
    //  old vs new rows by batch alone. The diff of active counts before/after is the net gain.)
    const prevActiveBacklinks = await withBrandScope(guard.brandId, async ({ db }) => {
      const r = (await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM ahrefs_backlinks
        WHERE brand_id = ${guard.brandId}::uuid AND is_lost = false
      `)) as unknown as { rows?: Array<{ n: number }> } | Array<{ n: number }>;
      const rows = Array.isArray(r) ? r : (r.rows ?? []);
      return Number((rows[0] as { n: number } | undefined)?.n ?? 0);
    });

    // Process each file
    for (const file of files) {
      const fileType = detectFileType(file.originalname);
      if (!fileType) continue;
      counts.fileCount++;

      const rows = readXlsx(file.buffer);
      if (rows.length === 0) continue;

      await withBrandScope(guard.brandId, async ({ db }) => {
        const exec = (q: ReturnType<typeof sql>) =>
          db.execute(q) as Promise<unknown>;

        if (fileType === "backlinks") {
          counts.backlinks += await ingestBacklinks(guard.brandId, batchId, rows, false, exec);
        } else if (fileType === "broken_backlinks") {
          counts.brokenBacklinks += await ingestBacklinks(guard.brandId, batchId, rows, true, exec);
        } else if (fileType === "referring_domains") {
          counts.referringDomains += await ingestReferringDomains(guard.brandId, rows, exec);
        } else if (fileType === "anchors") {
          counts.anchors += await ingestAnchors(guard.brandId, batchId, rows, exec);
        } else if (fileType === "top_pages") {
          counts.pagePerformance += await ingestTopPages(guard.brandId, batchId, rows, exec);
        } else if (fileType === "organic_keywords") {
          counts.organicKeywords += await ingestOrganicKeywords(guard.brandId, rows, exec);
        } else if (fileType === "content_gap") {
          counts.contentGap += await ingestContentGap(guard.brandId, batchId, rows, exec);
        }
      });
    }

    // Compute delta vs previous batch.
    // new_links  = net gain in active (non-lost) backlinks since before this upload.
    //              Computed as (current active count) − (pre-upload snapshot) so that
    //              upserts don't report the entire snapshot as "new".
    // lost_links = backlinks Ahrefs has explicitly flagged as lost in this import
    //              (is_lost = true in the export).  Ahrefs computes this diff for us.
    const delta = await withBrandScope(guard.brandId, async ({ db }) => {
      const r = (await db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM ahrefs_backlinks WHERE brand_id = ${guard.brandId}::uuid AND is_lost = false) AS curr_active,
          (SELECT count(*)::int FROM ahrefs_backlinks WHERE brand_id = ${guard.brandId}::uuid AND is_lost = true  AND import_batch_id = ${batchId}::uuid) AS lost_links,
          (SELECT count(*)::int FROM ahrefs_content_gap WHERE brand_id = ${guard.brandId}::uuid AND import_batch_id = ${batchId}::uuid) AS gap_keywords,
          (SELECT count(*)::int FROM ahrefs_page_performance WHERE brand_id = ${guard.brandId}::uuid AND import_batch_id = ${batchId}::uuid AND status = 'Active' AND prev_traffic IS NOT NULL AND curr_traffic > prev_traffic) AS pages_recovered,
          (SELECT count(*)::int FROM ahrefs_page_performance WHERE brand_id = ${guard.brandId}::uuid AND import_batch_id = ${batchId}::uuid AND prev_traffic > 0 AND traffic_change < -(prev_traffic * 0.5)) AS pages_crashed
      `)) as unknown as { rows?: Array<Record<string, number>> } | Array<Record<string, number>>;
      const rows = Array.isArray(r) ? r : (r.rows ?? []);
      const row = rows[0] ?? {};
      return {
        new_links: Math.max(0, Number(row["curr_active"] ?? 0) - prevActiveBacklinks),
        lost_links: Number(row["lost_links"] ?? 0),
        gap_keywords: Number(row["gap_keywords"] ?? 0),
        pages_recovered: Number(row["pages_recovered"] ?? 0),
        pages_crashed: Number(row["pages_crashed"] ?? 0),
      };
    });

    // Update batch with counts + delta
    await withBrandScope(guard.brandId, async ({ db }) => {
      await db.execute(sql`
        UPDATE ahrefs_import_batches SET
          file_count             = ${counts.fileCount},
          backlink_count         = ${counts.backlinks + counts.brokenBacklinks},
          referring_domain_count = ${counts.referringDomains},
          anchor_count           = ${counts.anchors},
          page_count             = ${counts.pagePerformance},
          organic_keyword_count  = ${counts.organicKeywords},
          content_gap_count      = ${counts.contentGap},
          delta_new_links        = ${delta["new_links"] ?? 0},
          delta_lost_links       = ${delta["lost_links"] ?? 0},
          delta_new_gap_keywords = ${delta["gap_keywords"] ?? 0},
          delta_pages_recovered  = ${delta["pages_recovered"] ?? 0},
          delta_pages_crashed    = ${delta["pages_crashed"] ?? 0}
        WHERE id = ${batchId}::uuid
      `);
    });

    res.json({
      batchId,
      imported: {
        backlinks: counts.backlinks,
        brokenBacklinks: counts.brokenBacklinks,
        referringDomains: counts.referringDomains,
        anchors: counts.anchors,
        pagePerformance: counts.pagePerformance,
        organicKeywords: counts.organicKeywords,
        contentGap: counts.contentGap,
      },
      delta: {
        newLinks: delta["new_links"] ?? 0,
        lostLinks: delta["lost_links"] ?? 0,
        newGapKeywords: delta["gap_keywords"] ?? 0,
        pagesRecovered: delta["pages_recovered"] ?? 0,
        pagesCrashed: delta["pages_crashed"] ?? 0,
      },
    });
  } catch (err) {
    fail(res, req, "ahrefs.upload", err);
  }
});

export default router;
