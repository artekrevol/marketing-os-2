/**
 * One-shot ingestion script for the July 2026 Ahrefs exports.
 * Run: pnpm --filter @workspace/api-server exec tsx scripts/ingest-ahrefs-2026-07.ts
 *
 * Ports the exact same SQL as ahrefs-upload.ts so behaviour is identical.
 * Safe to re-run — all inserts are ON CONFLICT DO UPDATE (upserts).
 */
import * as XLSX from "xlsx";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BRAND_ID = "2d10bb54-ba9a-4444-8a18-a262bca9b2bc"; // TekRevol
const FILES_DIR = resolve(process.cwd(), "../../attached_assets");
const FILES: Record<string, string> = {
  backlinks:        "1_AuthorityBacklinkHealth_Backlinks_1786410142955.xlsx",
  broken_backlinks: "1_AuthorityBacklinkHealth_BrokenBacklinks_1786410142955.xlsx",
  anchors:          "1_AuthorityBacklinkHealth_Anchors_1786410142955.xlsx",
  referring_domains:"1_AuthorityBacklinkHealth_ReferringDomains_1786410142955.xlsx",
  top_pages:        "3_ContentPagePerformance_TopPages_1786410142955.xlsx",
  best_by_links:    "3_ContentPagePerformance_BestByLinks_1786410142955.xlsx",
  content_gap:      "5_CompetitiveBenchmarking_ContentGap_1786410142955.xlsx",
  organic_keywords: "2_OrganicSearchPerformance_OrganicKeywords_1786410142955.xlsx",
};

// ---- helpers ----------------------------------------------------------------

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
function readXlsx(filename: string): Record<string, unknown>[] {
  const buf = readFileSync(resolve(FILES_DIR, filename));
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]!];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: null }) as Record<string, unknown>[];
}

// ---- create batch -----------------------------------------------------------

async function createBatch(): Promise<string> {
  const r = await db.execute(sql`
    INSERT INTO ahrefs_import_batches (brand_id, file_count, imported_at, created_at)
    VALUES (${BRAND_ID}::uuid, ${Object.keys(FILES).length}, now(), now())
    RETURNING id::text
  `) as unknown as { rows: Array<{ id: string }> };
  const id = r.rows[0]?.id;
  if (!id) throw new Error("Failed to create import batch");
  return id;
}

// ---- ingest functions -------------------------------------------------------

async function ingestBacklinks(batchId: string, rows: Record<string, unknown>[], brokenOnly: boolean): Promise<number> {
  let count = 0;
  for (const row of rows) {
    const isLost = brokenOnly ? false : row["Lost"] != null;
    const lostAt = isLost ? parseDate(row["Lost"]) : null;
    const targetHttpCode = brokenOnly ? safeInt(row["Target page HTTP code"]) : null;
    await db.execute(sql`
      INSERT INTO ahrefs_backlinks
        (brand_id, import_batch_id, referring_page_url, referring_page_title,
         language, platform, referring_page_http_code, dr, ur, domain_traffic,
         page_traffic, target_url, target_http_code, anchor, left_context, right_context,
         link_type, is_nofollow, is_spam, is_ugc, is_sponsored,
         is_lost, drop_reason, first_seen, last_seen, lost_at, page_type, author,
         created_at, updated_at)
      VALUES (
        ${BRAND_ID}::uuid, ${batchId}::uuid,
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
        ${targetHttpCode},
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
        import_batch_id      = EXCLUDED.import_batch_id,
        referring_page_title = EXCLUDED.referring_page_title,
        dr                   = EXCLUDED.dr,
        ur                   = EXCLUDED.ur,
        domain_traffic       = EXCLUDED.domain_traffic,
        page_traffic         = EXCLUDED.page_traffic,
        target_url           = EXCLUDED.target_url,
        target_http_code     = COALESCE(EXCLUDED.target_http_code, ahrefs_backlinks.target_http_code),
        anchor               = EXCLUDED.anchor,
        is_nofollow          = EXCLUDED.is_nofollow,
        is_spam              = EXCLUDED.is_spam,
        is_lost              = EXCLUDED.is_lost,
        drop_reason          = EXCLUDED.drop_reason,
        first_seen           = COALESCE(ahrefs_backlinks.first_seen, EXCLUDED.first_seen),
        last_seen            = EXCLUDED.last_seen,
        lost_at              = EXCLUDED.lost_at,
        updated_at           = now()
    `);
    count++;
  }
  return count;
}

async function ingestReferringDomains(rows: Record<string, unknown>[]): Promise<number> {
  let count = 0;
  for (const row of rows) {
    const domain = safeStr(row["Domain"]);
    if (!domain) continue;
    const isLost = safeStr(row["Lost"]) != null;
    await db.execute(sql`
      INSERT INTO referring_domains
        (brand_id, domain, dr, backlinks_count, linked_domains, dofollow_links,
         is_lost, is_spam, traffic_domain, first_seen, last_seen,
         source_provider, source_metadata, ahrefs_last_updated, created_at, updated_at)
      VALUES (
        ${BRAND_ID}::uuid, ${domain},
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
        dr                   = EXCLUDED.dr,
        backlinks_count      = EXCLUDED.backlinks_count,
        linked_domains       = EXCLUDED.linked_domains,
        dofollow_links       = EXCLUDED.dofollow_links,
        is_lost              = EXCLUDED.is_lost,
        is_spam              = EXCLUDED.is_spam,
        traffic_domain       = EXCLUDED.traffic_domain,
        first_seen           = COALESCE(referring_domains.first_seen, EXCLUDED.first_seen),
        last_seen            = EXCLUDED.last_seen,
        ahrefs_last_updated  = now(),
        updated_at           = now()
    `);
    count++;
  }
  return count;
}

async function ingestAnchors(batchId: string, rows: Record<string, unknown>[]): Promise<number> {
  let count = 0;
  for (const row of rows) {
    const anchorText = safeStr(row["Anchor text"]);
    if (anchorText == null) continue;
    await db.execute(sql`
      INSERT INTO ahrefs_anchors
        (brand_id, import_batch_id, anchor_text, ref_domains_count, top_dr,
         ref_pages_count, links_to_target, new_links, lost_links, dofollow_links,
         first_seen, is_lost, created_at, updated_at)
      VALUES (
        ${BRAND_ID}::uuid, ${batchId}::uuid,
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
        import_batch_id   = EXCLUDED.import_batch_id,
        ref_domains_count = EXCLUDED.ref_domains_count,
        top_dr            = EXCLUDED.top_dr,
        ref_pages_count   = EXCLUDED.ref_pages_count,
        links_to_target   = EXCLUDED.links_to_target,
        new_links         = EXCLUDED.new_links,
        lost_links        = EXCLUDED.lost_links,
        dofollow_links    = EXCLUDED.dofollow_links,
        is_lost           = EXCLUDED.is_lost,
        updated_at        = now()
    `);
    count++;
  }
  return count;
}

async function ingestTopPages(batchId: string, rows: Record<string, unknown>[]): Promise<number> {
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
    await db.execute(sql`
      INSERT INTO ahrefs_page_performance
        (brand_id, import_batch_id, url, status, ur, prev_traffic, curr_traffic,
         traffic_change, prev_traffic_value, curr_traffic_value, curr_ref_domains,
         prev_keywords, curr_keywords, page_type, prev_top_keyword, curr_top_keyword,
         created_at, updated_at)
      VALUES (
        ${BRAND_ID}::uuid, ${batchId}::uuid,
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

async function ingestBestByLinks(rows: Record<string, unknown>[]): Promise<number> {
  let count = 0;
  for (const row of rows) {
    const pageUrl = safeStr(row["Page URL"]);
    if (!pageUrl) continue;
    await db.execute(sql`
      INSERT INTO ahrefs_best_by_links
        (brand_id, page_url, page_title, language, platform, ur,
         ref_domains, top_dr, links_to_target, new_links, lost_links,
         dofollow_links, nofollow_links, redirect_links, page_http_code,
         first_seen, last_seen, created_at, updated_at)
      VALUES (
        ${BRAND_ID}::uuid,
        ${pageUrl},
        ${safeStr(row["Page title"])},
        ${safeStr(row["Language"])},
        ${safeStr(row["Platform"])},
        ${safeNum(row["UR"])},
        ${safeInt(row["Referring domains"])},
        ${safeInt(row["Top DR"])},
        ${safeInt(row["Links to target"])},
        ${safeInt(row["New Links"])},
        ${safeInt(row["Lost Links"])},
        ${safeInt(row["Dofollow"])},
        ${safeInt(row["Nofollow"])},
        ${safeInt(row["Redirects"])},
        ${safeInt(row["Page HTTP code"])},
        ${parseDate(row["First seen"])},
        ${parseDate(row["Last seen"])},
        now(), now()
      )
      ON CONFLICT (brand_id, page_url)
      DO UPDATE SET
        page_title      = EXCLUDED.page_title,
        ur              = EXCLUDED.ur,
        ref_domains     = EXCLUDED.ref_domains,
        top_dr          = EXCLUDED.top_dr,
        links_to_target = EXCLUDED.links_to_target,
        new_links       = EXCLUDED.new_links,
        lost_links      = EXCLUDED.lost_links,
        dofollow_links  = EXCLUDED.dofollow_links,
        nofollow_links  = EXCLUDED.nofollow_links,
        redirect_links  = EXCLUDED.redirect_links,
        page_http_code  = EXCLUDED.page_http_code,
        last_seen       = EXCLUDED.last_seen,
        updated_at      = now()
    `);
    count++;
  }
  return count;
}

async function ingestContentGap(batchId: string, rows: Record<string, unknown>[]): Promise<number> {
  if (rows.length === 0) return 0;
  let count = 0;
  const sampleKeys = Object.keys(rows[0]!);
  const competitorDomains = [
    ...new Set(
      sampleKeys
        .filter((k) => k.includes(": URL") && !k.startsWith("www.tekrevol"))
        .map((k) => k.split(":")[0]!.trim()),
    ),
  ];
  console.log("  Content gap competitor domains detected:", competitorDomains.join(", "));

  for (const row of rows) {
    const keyword = safeStr(row["Keyword"]);
    if (!keyword) continue;
    const intentsRaw = safeStr(row["Intents"]);
    const intents = intentsRaw
      ? intentsRaw.split(",").map((s) => s.trim().replace(/^"|"$/g, "").trim()).filter(Boolean)
      : [];
    const intentsPg = intents.length > 0
      ? `{${intents.map((s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`
      : null;
    const volume = safeInt(row["Volume"]);
    const kd = safeInt(row["KD"]);
    const cpc = safeNum(row["CPC"]);
    const ourUrl = safeStr(row["www.tekrevol.com/: URL"]);
    const ourPosition = safeInt(row["www.tekrevol.com/: Organic Position"]);
    const ourTraffic = safeInt(row["www.tekrevol.com/: Organic Traffic"]);
    const priorityScore = volume != null && kd != null ? Math.round(volume * (1 - kd / 100)) : null;

    for (const comp of competitorDomains) {
      const compUrl = safeStr(row[`${comp}: URL`]);
      const compPos = safeInt(row[`${comp}: Organic Position`]);
      const compTraffic = safeInt(row[`${comp}: Organic Traffic`]);
      if (!compPos) continue;
      await db.execute(sql`
        INSERT INTO ahrefs_content_gap
          (brand_id, import_batch_id, keyword, intents, volume, kd, cpc,
           our_url, our_position, our_traffic,
           competitor_domain, competitor_url, competitor_position, competitor_traffic,
           priority_score, created_at, updated_at)
        VALUES (
          ${BRAND_ID}::uuid, ${batchId}::uuid,
          ${keyword}, ${intentsPg}::text[],
          ${volume}, ${kd}, ${cpc},
          ${ourUrl}, ${ourPosition}, ${ourTraffic},
          ${comp}, ${compUrl}, ${compPos}, ${compTraffic},
          ${priorityScore}, now(), now()
        )
        ON CONFLICT (brand_id, keyword, competitor_domain)
        DO UPDATE SET
          import_batch_id     = EXCLUDED.import_batch_id,
          intents             = EXCLUDED.intents,
          volume              = EXCLUDED.volume,
          kd                  = EXCLUDED.kd,
          cpc                 = EXCLUDED.cpc,
          our_url             = EXCLUDED.our_url,
          our_position        = EXCLUDED.our_position,
          our_traffic         = EXCLUDED.our_traffic,
          competitor_url      = EXCLUDED.competitor_url,
          competitor_position = EXCLUDED.competitor_position,
          competitor_traffic  = EXCLUDED.competitor_traffic,
          priority_score      = EXCLUDED.priority_score,
          updated_at          = now()
      `);
      count++;
    }
  }
  return count;
}

async function ingestOrganicKeywords(rows: Record<string, unknown>[]): Promise<number> {
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
    await db.execute(sql`
      UPDATE keywords
      SET
        ahrefs_best_position      = ${safeInt(row["Current position"])},
        ahrefs_best_position_url  = ${safeStr(row["Current URL"])},
        ahrefs_keyword_difficulty = ${safeNum(row["KD"])},
        ahrefs_sum_traffic        = ${safeInt(row["Current organic traffic"])},
        ahrefs_intent_flags       = ${intentFlags}::jsonb,
        ahrefs_cpc                = ${safeNum(row["CPC"])},
        is_branded                = ${safeBool(row["Branded"])},
        ahrefs_last_updated       = now(),
        updated_at                = now()
      WHERE brand_id = ${BRAND_ID}::uuid
        AND lower(keyword_text) = lower(${keyword})
    `);
    count++;
  }
  return count;
}

// ---- main -------------------------------------------------------------------

async function main() {
  console.log("=== Ahrefs July 2026 ingestion ===\n");

  const batchId = await createBatch();
  console.log("Batch ID:", batchId);

  const counts: Record<string, number> = {};

  // Backlinks
  console.log("\n[1/8] Backlinks…");
  const blRows = readXlsx(FILES.backlinks!);
  console.log(`  ${blRows.length} rows`);
  counts.backlinks = await ingestBacklinks(batchId, blRows, false);
  console.log(`  ✓ ${counts.backlinks} upserted`);

  // Broken backlinks (updates target_http_code on existing rows)
  console.log("\n[2/8] Broken backlinks…");
  const bbRows = readXlsx(FILES.broken_backlinks!);
  console.log(`  ${bbRows.length} rows`);
  counts.broken_backlinks = await ingestBacklinks(batchId, bbRows, true);
  console.log(`  ✓ ${counts.broken_backlinks} upserted`);

  // Anchors
  console.log("\n[3/8] Anchors…");
  const anRows = readXlsx(FILES.anchors!);
  console.log(`  ${anRows.length} rows`);
  counts.anchors = await ingestAnchors(batchId, anRows);
  console.log(`  ✓ ${counts.anchors} upserted`);

  // Referring domains
  console.log("\n[4/8] Referring domains…");
  const rdRows = readXlsx(FILES.referring_domains!);
  console.log(`  ${rdRows.length} rows`);
  counts.referring_domains = await ingestReferringDomains(rdRows);
  console.log(`  ✓ ${counts.referring_domains} upserted`);

  // Top pages
  console.log("\n[5/8] Top pages (page performance)…");
  const tpRows = readXlsx(FILES.top_pages!);
  console.log(`  ${tpRows.length} rows`);
  counts.top_pages = await ingestTopPages(batchId, tpRows);
  console.log(`  ✓ ${counts.top_pages} upserted`);

  // Best by links
  console.log("\n[6/8] Best by links…");
  const bblRows = readXlsx(FILES.best_by_links!);
  console.log(`  ${bblRows.length} rows`);
  counts.best_by_links = await ingestBestByLinks(bblRows);
  console.log(`  ✓ ${counts.best_by_links} upserted`);

  // Content gap
  console.log("\n[7/8] Content gap…");
  const cgRows = readXlsx(FILES.content_gap!);
  console.log(`  ${cgRows.length} rows`);
  counts.content_gap = await ingestContentGap(batchId, cgRows);
  console.log(`  ✓ ${counts.content_gap} upserted`);

  // Organic keywords (enriches existing keyword rows)
  console.log("\n[8/8] Organic keywords (enriching keyword rows)…");
  const okRows = readXlsx(FILES.organic_keywords!);
  console.log(`  ${okRows.length} rows`);
  counts.organic_keywords = await ingestOrganicKeywords(okRows);
  console.log(`  ✓ ${counts.organic_keywords} keywords attempted`);

  // Update batch with final counts
  await db.execute(sql`
    UPDATE ahrefs_import_batches SET
      file_count             = 8,
      backlink_count         = ${(counts.backlinks ?? 0) + (counts.broken_backlinks ?? 0)},
      referring_domain_count = ${counts.referring_domains ?? 0},
      anchor_count           = ${counts.anchors ?? 0},
      page_count             = ${counts.top_pages ?? 0},
      organic_keyword_count  = ${counts.organic_keywords ?? 0},
      content_gap_count      = ${counts.content_gap ?? 0}
    WHERE id = ${batchId}::uuid
  `);

  console.log("\n=== Done ===");
  console.log(counts);
  process.exit(0);
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
