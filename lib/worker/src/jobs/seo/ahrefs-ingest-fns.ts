/**
 * Ahrefs XLSX parse + DB upsert functions — used by the background ingest worker.
 * Extracted from the HTTP upload route so ingestion can run without a request timeout.
 */
import * as XLSX from "xlsx";
import { sql } from "drizzle-orm";

export type DbExec = (q: ReturnType<typeof sql>) => Promise<unknown>;

export type IngestCounts = {
  backlinks: number;
  brokenBacklinks: number;
  referringDomains: number;
  anchors: number;
  pagePerformance: number;
  organicKeywords: number;
  contentGap: number;
  bestByLinks: number;
};

/* ─── Type coercion helpers ─────────────────────────────────────────────── */

export function safeStr(v: unknown): string | null {
  if (v == null || v === "" || v === "null") return null;
  return String(v).trim() || null;
}
export function safeInt(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
export function safeNum(v: unknown): string | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : null;
}
export function safeBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true" || v === "1";
  return Boolean(v);
}
export function parseDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

/* ─── XLSX helpers ─────────────────────────────────────────────────────── */

export function readXlsx(buf: Buffer): Record<string, unknown>[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]!];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: null }) as Record<string, unknown>[];
}

export const REQUIRED_HEADERS: Record<string, string[]> = {
  backlinks:        ["Referring page URL", "Domain rating", "Target URL"],
  broken_backlinks: ["Referring page URL", "Domain rating", "Target URL", "Target page HTTP code"],
  anchors:          ["Anchor text", "Ref. domains", "Ref. pages"],
  top_pages:        ["URL", "Current traffic"],
  content_gap:      ["Keyword", "Volume", "KD"],
  organic_keywords: ["Keyword"],
};

export function detectFileType(filename: string): string | null {
  const n = filename.toLowerCase();
  if (n.includes("brokenbacklinks")) return "broken_backlinks";
  if (n.includes("referringdomains")) return "referring_domains";
  if (n.includes("anchors")) return "anchors";
  if (n.includes("backlinks")) return "backlinks";
  if (n.includes("organickeywords")) return "organic_keywords";
  if (n.includes("toppages")) return "top_pages";
  if (n.includes("bestbylinks")) return "best_by_links";
  if (n.includes("contentgap")) return "content_gap";
  if (n.includes("linkingauthors")) return "linking_authors";
  if (n.includes("referringips")) return "referring_ips";
  return null;
}

export function validateHeaders(
  rows: Record<string, unknown>[],
  required: string[],
  label: string,
): string | null {
  if (rows.length === 0) return `${label}: file is empty`;
  const present = new Set(Object.keys(rows[0]!));
  const missing = required.filter((h) => !present.has(h));
  return missing.length ? `${label}: missing columns: ${missing.join(", ")}` : null;
}

/* ─── Ingest functions ──────────────────────────────────────────────────── */

export async function ingestBacklinks(
  brandId: string,
  batchId: string,
  rows: Record<string, unknown>[],
  brokenOnly: boolean,
  exec: DbExec,
): Promise<number> {
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk.map((row) => {
      const isLost = brokenOnly ? false : row["Lost"] != null;
      const lostAt = isLost ? parseDate(row["Lost"]) : null;
      const targetHttpCode = brokenOnly ? safeInt(row["Target page HTTP code"]) : null;
      return sql`(
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
      )`;
    });
    await exec(sql`
      INSERT INTO ahrefs_backlinks
        (brand_id, import_batch_id, referring_page_url, referring_page_title,
         language, platform, referring_page_http_code, dr, ur, domain_traffic,
         page_traffic, target_url, target_http_code, anchor, left_context, right_context,
         link_type, is_nofollow, is_spam, is_ugc, is_sponsored,
         is_lost, drop_reason, first_seen, last_seen, lost_at, page_type, author,
         created_at, updated_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (brand_id, referring_page_url) DO UPDATE SET
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
  }
  return rows.length;
}

export async function ingestReferringDomains(
  brandId: string,
  rows: Record<string, unknown>[],
  exec: DbExec,
): Promise<number> {
  const valid = rows.filter((r) => safeStr(r["Domain"]) != null);
  const CHUNK = 300;
  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK);
    const values = chunk.map((row) => {
      const isLost = safeStr(row["Lost"]) != null;
      return sql`(
        ${brandId}::uuid, ${safeStr(row["Domain"])},
        ${safeNum(row["DR"])},
        ${safeInt(row["Links to target"])},
        ${safeInt(row["Dofollow linked domains"])},
        ${safeInt(row["Dofollow links"])},
        ${isLost},
        ${safeBool(row["Is spam"])},
        ${safeInt((row["Traffic "] ?? row["Traffic"]) as unknown)},
        ${parseDate(row["First seen"])},
        ${isLost ? parseDate(row["Lost"]) : null},
        ${"ahrefs_bulk_import"}, ${"{}"}::jsonb, now(), now(), now()
      )`;
    });
    await exec(sql`
      INSERT INTO referring_domains
        (brand_id, domain, dr, backlinks_count, linked_domains, dofollow_links,
         is_lost, is_spam, traffic_domain, first_seen, last_seen,
         source_provider, source_metadata, ahrefs_last_updated, created_at, updated_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (brand_id, domain) DO UPDATE SET
        dr                  = EXCLUDED.dr,
        backlinks_count     = EXCLUDED.backlinks_count,
        linked_domains      = EXCLUDED.linked_domains,
        dofollow_links      = EXCLUDED.dofollow_links,
        is_lost             = EXCLUDED.is_lost,
        is_spam             = EXCLUDED.is_spam,
        traffic_domain      = EXCLUDED.traffic_domain,
        first_seen          = COALESCE(referring_domains.first_seen, EXCLUDED.first_seen),
        last_seen           = EXCLUDED.last_seen,
        ahrefs_last_updated = now(),
        updated_at          = now()
    `);
  }
  return valid.length;
}

export async function ingestAnchors(
  brandId: string,
  batchId: string,
  rows: Record<string, unknown>[],
  exec: DbExec,
): Promise<number> {
  const valid = rows.filter((r) => safeStr(r["Anchor text"]) != null);
  const CHUNK = 300;
  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK);
    const values = chunk.map((row) => sql`(
      ${brandId}::uuid, ${batchId}::uuid,
      ${safeStr(row["Anchor text"])},
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
    )`);
    await exec(sql`
      INSERT INTO ahrefs_anchors
        (brand_id, import_batch_id, anchor_text, ref_domains_count, top_dr,
         ref_pages_count, links_to_target, new_links, lost_links, dofollow_links,
         first_seen, is_lost, created_at, updated_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (brand_id, anchor_text) DO UPDATE SET
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
  }
  return valid.length;
}

export async function ingestBestByLinks(
  brandId: string,
  rows: Record<string, unknown>[],
  exec: DbExec,
): Promise<number> {
  const valid = rows.filter((r) => safeStr(r["Page URL"]) != null);
  const CHUNK = 200;
  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK);
    const values = chunk.map((row) => sql`(
      ${brandId}::uuid,
      ${safeStr(row["Page URL"])},
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
    )`);
    await exec(sql`
      INSERT INTO ahrefs_best_by_links
        (brand_id, page_url, page_title, language, platform, ur,
         ref_domains, top_dr, links_to_target, new_links, lost_links,
         dofollow_links, nofollow_links, redirect_links, page_http_code,
         first_seen, last_seen, created_at, updated_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (brand_id, page_url) DO UPDATE SET
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
  }
  return valid.length;
}

export async function ingestTopPages(
  brandId: string,
  batchId: string,
  rows: Record<string, unknown>[],
  exec: DbExec,
): Promise<number> {
  const valid = rows.filter((r) => safeStr(r["URL"]) != null);
  const CHUNK = 200;
  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK);
    const values = chunk.map((row) => {
      const prev = safeInt(row["Previous traffic"]);
      const curr = safeInt(row["Current traffic"]);
      const change = prev != null && curr != null ? curr - prev : safeInt(row["Traffic change"]);
      return sql`(
        ${brandId}::uuid, ${batchId}::uuid,
        ${safeStr(row["URL"])},
        ${safeStr(row["Status"])},
        ${safeNum(row["UR"])},
        ${prev}, ${curr}, ${change},
        ${safeNum(row["Previous traffic value"])},
        ${safeNum(row["Current traffic value"])},
        ${safeInt(row["Current referring domains"])},
        ${safeInt(row["Previous # of keywords"])},
        ${safeInt(row["Current # of keywords"])},
        ${safeStr(row["Page type"])},
        ${safeStr(row["Previous top keyword"])},
        ${safeStr(row["Current top keyword"])},
        now(), now()
      )`;
    });
    await exec(sql`
      INSERT INTO ahrefs_page_performance
        (brand_id, import_batch_id, url, status, ur, prev_traffic, curr_traffic,
         traffic_change, prev_traffic_value, curr_traffic_value, curr_ref_domains,
         prev_keywords, curr_keywords, page_type, prev_top_keyword, curr_top_keyword,
         created_at, updated_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (brand_id, url) DO UPDATE SET
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
  }
  return valid.length;
}

export async function ingestOrganicKeywords(
  brandId: string,
  rows: Record<string, unknown>[],
  exec: DbExec,
): Promise<number> {
  let count = 0;
  for (const row of rows) {
    const keyword = safeStr(row["Keyword"]);
    if (!keyword) continue;
    const intentFlags = JSON.stringify({
      informational: safeBool(row["Informational"]),
      commercial:    safeBool(row["Commercial"]),
      transactional: safeBool(row["Transactional"]),
      navigational:  safeBool(row["Navigational"]),
      branded:       safeBool(row["Branded"]),
    });
    await exec(sql`
      UPDATE keywords SET
        ahrefs_best_position      = ${safeInt(row["Current position"])},
        ahrefs_best_position_url  = ${safeStr(row["Current URL"])},
        ahrefs_keyword_difficulty = ${safeNum(row["KD"])},
        ahrefs_sum_traffic        = ${safeInt(row["Current organic traffic"])},
        ahrefs_intent_flags       = ${intentFlags}::jsonb,
        ahrefs_cpc                = ${safeNum(row["CPC"])},
        is_branded                = ${safeBool(row["Branded"])},
        ahrefs_last_updated       = now(),
        updated_at                = now()
      WHERE brand_id = ${brandId}::uuid
        AND lower(keyword_text) = lower(${keyword})
    `);
    count++;
  }
  return count;
}

export async function ingestContentGap(
  brandId: string,
  batchId: string,
  rows: Record<string, unknown>[],
  exec: DbExec,
): Promise<number> {
  if (rows.length === 0) return 0;

  const sampleKeys = Object.keys(rows[0]!);
  const competitorDomains = [
    ...new Set(
      sampleKeys
        .filter((k) => k.includes(": URL") && !k.startsWith("www.tekrevol"))
        .map((k) => k.split(":")[0]!.trim()),
    ),
  ];

  type GapEntry = {
    keyword: string; intentsPg: string | null;
    volume: number | null; kd: number | null; cpc: string | null;
    ourUrl: string | null; ourPosition: number | null; ourTraffic: number | null;
    comp: string; compUrl: string | null; compPos: number; compTraffic: number | null;
    priorityScore: number | null;
  };

  const entries: GapEntry[] = [];
  for (const row of rows) {
    const keyword = safeStr(row["Keyword"]);
    if (!keyword) continue;
    const intentsRaw = safeStr(row["Intents"]);
    const intents = intentsRaw
      ? intentsRaw.split(",").map((s) => s.trim().replace(/^"|"$/g, "").trim()).filter(Boolean)
      : [];
    const intentsPg = intents.length
      ? `{${intents.map((s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`
      : null;
    const volume = safeInt(row["Volume"]);
    const kd = safeInt(row["KD"]);
    for (const comp of competitorDomains) {
      const compPos = safeInt(row[`${comp}: Organic Position`]);
      if (!compPos) continue;
      entries.push({
        keyword, intentsPg, volume, kd,
        cpc: safeNum(row["CPC"]),
        ourUrl: safeStr(row["www.tekrevol.com/: URL"]),
        ourPosition: safeInt(row["www.tekrevol.com/: Organic Position"]),
        ourTraffic: safeInt(row["www.tekrevol.com/: Organic Traffic"]),
        comp,
        compUrl: safeStr(row[`${comp}: URL`]),
        compPos,
        compTraffic: safeInt(row[`${comp}: Organic Traffic`]),
        priorityScore: volume != null && kd != null ? Math.round(volume * (1 - kd / 100)) : null,
      });
    }
  }

  const CHUNK = 150;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK);
    const values = chunk.map((e) => sql`(
      ${brandId}::uuid, ${batchId}::uuid,
      ${e.keyword}, ${e.intentsPg}::text[],
      ${e.volume}, ${e.kd}, ${e.cpc},
      ${e.ourUrl}, ${e.ourPosition}, ${e.ourTraffic},
      ${e.comp}, ${e.compUrl}, ${e.compPos}, ${e.compTraffic},
      ${e.priorityScore}, now(), now()
    )`);
    await exec(sql`
      INSERT INTO ahrefs_content_gap
        (brand_id, import_batch_id, keyword, intents, volume, kd, cpc,
         our_url, our_position, our_traffic,
         competitor_domain, competitor_url, competitor_position, competitor_traffic,
         priority_score, created_at, updated_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (brand_id, keyword, competitor_domain) DO UPDATE SET
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
  }
  return entries.length;
}
