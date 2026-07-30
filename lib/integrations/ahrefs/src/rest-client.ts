/**
 * AhrefsRestClient — typed REST v3 client for Ahrefs bulk data pulls.
 *
 * Transport: HTTPS GET with query params
 * Base URL:  https://api.ahrefs.com/v3
 * Auth:      Authorization: Bearer $AHREFS_API_KEY
 *
 * Endpoints covered (matching Phase 3–7 of the Ahrefs bulk import dispatch):
 *   /site-explorer/organic-keywords  — Phase 3 (keywords corpus)
 *   /site-explorer/top-pages         — Phase 4 (link_targets traffic data)
 *   /site-explorer/competing-domains — Phase 5 (competitor_insights)
 *   /site-explorer/refdomains        — Phase 6 (referring_domains)
 *   /site-explorer/domain-rating     — Phase 7 (domain_authority_cache seed)
 *
 * Every call is logged to `ahrefs_rest_usage` via logRestUsage().
 * Pagination is handled automatically by getAllPages() using offset-based
 * stepping; each page's usage is logged individually.
 *
 * Rate limiting: token-bucket at 1 req/sec by default (conservative; raise
 * via opts.requestsPerSec on plans that allow higher throughput).
 */

import { createHash } from "node:crypto";
// Use raw db (not guardedDb) — bulk-import scripts run outside withBrandScope.
// Brand isolation is enforced by the mandatory brandId constructor param and the
// FK constraint on ahrefs_rest_usage.brand_id. guardedDb is for worker-tier code
// that runs inside withBrandScope; it would silently swallow every logRestUsage()
// call in a script context because the catch in logRestUsage() eats the error.
import { db } from "@workspace/db";
import { ahrefsRestUsageTable } from "@workspace/db/schema";
import { AhrefsRestError } from "./errors.js";

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

const BASE = "https://api.ahrefs.com/v3";
const DEFAULT_RPS = 1;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 600;
const DEFAULT_PAGE_LIMIT = 1000;

/* -------------------------------------------------------------------------- */
/* Response item types — match live Ahrefs v3 field names                     */
/* -------------------------------------------------------------------------- */

/**
 * One row from /site-explorer/organic-keywords.
 *
 * Field names confirmed via live API error response (2026-07-30):
 *   - `country` is NOT a valid column; use `keyword_country`
 *   - `traffic` is NOT valid; use `sum_traffic`
 *   - intent is NOT a single field; Ahrefs exposes per-intent booleans:
 *     is_commercial, is_navigational, is_transactional, is_informational, is_branded
 */
export interface AhrefsOrganicKeyword {
  keyword: string;
  /** Two-letter country code for this ranking row */
  keyword_country: string | null;
  volume: number | null;
  keyword_difficulty: number | null;
  /** CPC in Ahrefs native unit (typically USD cents) */
  cpc: number | null;
  /** Estimated monthly organic traffic from this keyword */
  sum_traffic: number | null;
  best_position: number | null;
  best_position_url: string | null;
  is_commercial: boolean | null;
  is_navigational: boolean | null;
  is_transactional: boolean | null;
  is_informational: boolean | null;
  /** Ahrefs-classified branded keyword flag — drives is_branded on insert */
  is_branded: boolean | null;
}

/** One row from /site-explorer/top-pages */
export interface AhrefsTopPage {
  /** Absolute URL of the page */
  url_to: string;
  /** Estimated monthly organic traffic */
  traffic: number | null;
  /** Traffic value in USD */
  value: number | null;
  /** Number of keywords the page ranks for */
  keywords: number | null;
  /** Keyword driving the most traffic */
  top_keyword: string | null;
  /** URL Rating (0–100) */
  ur: number | null;
  /** Referring domains count */
  referring_domains: number | null;
  /** Ahrefs page-type classification (used to derive funnel_stage) */
  page_type: string | null;
}

/** One row from /site-explorer/competing-domains */
export interface AhrefsCompetingDomain {
  /** Competitor root domain */
  domain: string;
  /** Keywords both target and competitor rank for */
  common_keywords: number | null;
  /** Total keywords the competitor ranks for */
  competitor_keywords: number | null;
  /** Domain Rating of competitor */
  domain_rating: number | null;
  /** Estimated monthly traffic */
  traffic: number | null;
  /** Competitor's share of common keywords (0–1) */
  common_keywords_share: number | null;
  /** Pages count (Ahrefs field name may vary by plan; falls back to null) */
  pages: number | null;
}

/** One row from /site-explorer/refdomains — confirmed field names (2026-07-29) */
export interface AhrefsRefdomain {
  domain: string;
  domain_rating: number | null;
  dofollow_links: number | null;
  links_to_target: number | null;
  dofollow_refdomains: number | null;
  first_seen: string | null;
  last_seen: string | null;
  is_spam: boolean | null;
  is_root_domain: boolean | null;
  traffic_domain: number | null;
}

/** Response from /site-explorer/domain-rating */
export interface AhrefsDomainRatingResult {
  domain_rating: number;
  ahrefs_rank: number;
}

/* -------------------------------------------------------------------------- */
/* Internal execute result                                                     */
/* -------------------------------------------------------------------------- */

interface ExecuteResult<T> {
  rows: T[];
  unitsConsumed: number;
  rowsReturned: number;
}

/* -------------------------------------------------------------------------- */
/* Client options                                                              */
/* -------------------------------------------------------------------------- */

export interface AhrefsRestClientOpts {
  /** Defaults to process.env.AHREFS_API_KEY */
  apiKey?: string;
  /** Requests per second for the token-bucket rate limiter. Default: 1 */
  requestsPerSec?: number;
  /** Fetch implementation — injectable for tests */
  fetch?: typeof fetch;
  /** Brand ID for usage logging */
  brandId: string;
}

/* -------------------------------------------------------------------------- */
/* AhrefsRestClient                                                            */
/* -------------------------------------------------------------------------- */

export class AhrefsRestClient {
  private readonly apiKey: string;
  private readonly limiter: TokenBucket;
  private readonly fetchImpl: typeof fetch;
  private readonly brandId: string;

  constructor(opts: AhrefsRestClientOpts) {
    const apiKey = opts.apiKey ?? process.env["AHREFS_API_KEY"];
    if (!apiKey) {
      throw new AhrefsRestError("AHREFS_API_KEY must be set.", {
        endpoint: "<init>",
        retriable: false,
      });
    }
    this.apiKey = apiKey;
    this.limiter = new TokenBucket(opts.requestsPerSec ?? DEFAULT_RPS);
    this.fetchImpl = opts.fetch ?? fetch;
    this.brandId = opts.brandId;
  }

  /* -------------------------------------------------------------------------
   * Public endpoint methods
   * ---------------------------------------------------------------------- */

  /**
   * Fetch all organic keywords for `target` from Ahrefs Site Explorer.
   * Auto-paginates using offset until fewer rows than the page limit are
   * returned. Filters to `country` (default "us").
   *
   * select fields: keyword, country, volume, keyword_difficulty, cpc,
   *                traffic, best_position, best_position_url, intent
   */
  async getOrganicKeywords(
    target: string,
    opts: {
      country?: string;
      dispatchContext?: string;
    } = {},
  ): Promise<AhrefsOrganicKeyword[]> {
    const country = opts.country ?? "us";
    return this.getAllPages<AhrefsOrganicKeyword>(
      "/site-explorer/organic-keywords",
      {
        select: "keyword,keyword_country,volume,keyword_difficulty,cpc,sum_traffic,best_position,best_position_url,is_commercial,is_navigational,is_transactional,is_informational,is_branded",
        target,
        country,
        mode: "subdomains",
        date: todayISO(),
        order_by: "sum_traffic:desc",
      },
      "keywords",
      { dispatchContext: opts.dispatchContext },
    );
  }

  /**
   * Fetch top pages for `target` by traffic.
   * Auto-paginates. Filters to `country` (default "us").
   *
   * select fields: url_to, traffic, value, keywords, top_keyword,
   *                ur, referring_domains, page_type
   */
  async getTopPages(
    target: string,
    opts: {
      country?: string;
      dispatchContext?: string;
    } = {},
  ): Promise<AhrefsTopPage[]> {
    const country = opts.country ?? "us";
    return this.getAllPages<AhrefsTopPage>(
      "/site-explorer/top-pages",
      {
        select: "url_to,traffic,value,keywords,top_keyword,ur,referring_domains,page_type",
        target,
        country,
        mode: "subdomains",
        date: todayISO(),
        order_by: "traffic:desc",
      },
      "pages",
      { dispatchContext: opts.dispatchContext },
    );
  }

  /**
   * Fetch competing domains for `target`.
   * Auto-paginates. Returns at most `limit` competitors (default: 500).
   *
   * select fields: domain, common_keywords, competitor_keywords,
   *                domain_rating, traffic, common_keywords_share, pages
   */
  async getCompetingDomains(
    target: string,
    opts: {
      country?: string;
      limit?: number;
      dispatchContext?: string;
    } = {},
  ): Promise<AhrefsCompetingDomain[]> {
    const country = opts.country ?? "us";
    const maxRows = opts.limit ?? 500;
    const rows = await this.getAllPages<AhrefsCompetingDomain>(
      "/site-explorer/competing-domains",
      {
        select: "domain,common_keywords,competitor_keywords,domain_rating,traffic,common_keywords_share,pages",
        target,
        country,
        mode: "subdomains",
        date: todayISO(),
        order_by: "common_keywords:desc",
      },
      "domains",
      { dispatchContext: opts.dispatchContext },
    );
    return rows.slice(0, maxRows);
  }

  /**
   * Fetch referring domains for `target`.
   * Auto-paginates until all refdomains are retrieved.
   *
   * Confirmed field names (2026-07-29 session):
   *   domain, domain_rating, dofollow_links, links_to_target,
   *   dofollow_refdomains, first_seen, last_seen, is_spam,
   *   is_root_domain, traffic_domain
   */
  async getRefdomains(
    target: string,
    opts: {
      dispatchContext?: string;
    } = {},
  ): Promise<AhrefsRefdomain[]> {
    return this.getAllPages<AhrefsRefdomain>(
      "/site-explorer/refdomains",
      {
        select: "domain,domain_rating,dofollow_links,links_to_target,dofollow_refdomains,first_seen,last_seen,is_spam,is_root_domain,traffic_domain",
        target,
        mode: "subdomains",
        date: todayISO(),
        order_by: "domain_rating:desc",
      },
      "refdomains",
      { dispatchContext: opts.dispatchContext },
    );
  }

  /**
   * Fetch Domain Rating and Ahrefs Rank for a single domain.
   * Returns null if the response is empty or the domain is unrecognised.
   * Single-call (no pagination needed).
   */
  async getDomainRating(
    target: string,
    opts: { dispatchContext?: string } = {},
  ): Promise<AhrefsDomainRatingResult | null> {
    const endpoint = "/site-explorer/domain-rating";
    const params: Record<string, string | number> = {
      select: "domain_rating,ahrefs_rank",
      target,
      date: todayISO(),
    };

    const { rows } = await this.execute<AhrefsDomainRatingResult>(
      endpoint,
      params,
      "domain_rating",
      { dispatchContext: opts.dispatchContext },
    );

    // Domain rating endpoint returns a single-item array or an object;
    // normalise to the first item regardless.
    return rows[0] ?? null;
  }

  /* -------------------------------------------------------------------------
   * Pagination helper
   * ---------------------------------------------------------------------- */

  /**
   * Auto-paginate an endpoint using offset-based stepping.
   * Stops when a page returns fewer rows than the page limit.
   * Each page call is independently retried and logged.
   */
  private async getAllPages<T>(
    endpoint: string,
    baseParams: Record<string, string | number>,
    itemKey: string,
    opts: { dispatchContext?: string } = {},
  ): Promise<T[]> {
    const all: T[] = [];
    let offset = 0;

    while (true) {
      const { rows } = await this.execute<T>(
        endpoint,
        { ...baseParams, limit: DEFAULT_PAGE_LIMIT, offset },
        itemKey,
        { dispatchContext: opts.dispatchContext },
      );
      all.push(...rows);
      if (rows.length < DEFAULT_PAGE_LIMIT) break; // last page reached
      offset += rows.length;
    }

    return all;
  }

  /* -------------------------------------------------------------------------
   * Core execute — rate-limit, retry, log
   * ---------------------------------------------------------------------- */

  /**
   * Execute a single GET request against the Ahrefs v3 API.
   * Enforces rate limiting, retries on 429/5xx with jittered exponential
   * backoff, and logs every attempt to `ahrefs_rest_usage`.
   *
   * @param endpoint  Path under BASE, e.g. "/site-explorer/organic-keywords"
   * @param params    Query parameters (all values coerced to strings)
   * @param itemKey   JSON key in the response body that holds the row array
   * @param opts      dispatchContext tag for the usage log
   */
  private async execute<T>(
    endpoint: string,
    params: Record<string, string | number>,
    itemKey: string,
    opts: { dispatchContext?: string } = {},
  ): Promise<ExecuteResult<T>> {
    const url = buildUrl(`${BASE}${endpoint}`, params);
    const paramsHash = sha256(`${endpoint}:${JSON.stringify(params)}`);
    const start = Date.now();
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      await this.limiter.take();
      try {
        const res = await this.fetchImpl(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: "application/json",
          },
        });

        const durationMs = Date.now() - start;

        if (res.status === 429 || res.status >= 500) {
          lastErr = new AhrefsRestError(
            `Ahrefs REST ${endpoint} returned ${res.status}`,
            { httpStatus: res.status, endpoint, retriable: true },
          );
          await this.logRestUsage({
            endpoint,
            paramsHash,
            unitsConsumed: 0,
            responseStatus: res.status === 429 ? "rate_limited" : "error",
            errorMessage: `HTTP ${res.status} (retry ${attempt + 1}/${MAX_RETRIES})`,
            dispatchContext: opts.dispatchContext,
            metadata: { attempt },
          });
          await sleep(jitter(RETRY_BASE_MS * 2 ** attempt));
          continue;
        }

        const json = (await res.json()) as Record<string, unknown>;

        if (!res.ok) {
          const errMsg = extractApiError(json) ?? `HTTP ${res.status}`;
          await this.logRestUsage({
            endpoint,
            paramsHash,
            unitsConsumed: 0,
            responseStatus: "error",
            errorMessage: errMsg,
            dispatchContext: opts.dispatchContext,
            metadata: { attempt },
          });
          throw new AhrefsRestError(`Ahrefs REST ${endpoint} failed: ${errMsg}`, {
            httpStatus: res.status,
            endpoint,
            retriable: false,
            responseBody: json,
          });
        }

        const rows = extractRows<T>(json, itemKey);
        const unitsConsumed = extractUnits(json);

        await this.logRestUsage({
          endpoint,
          paramsHash,
          unitsConsumed,
          responseStatus: "ok",
          rowsReturned: rows.length,
          dispatchContext: opts.dispatchContext,
          metadata: {
            params: sanitiseParams(params),
            itemKey,
            offset: typeof params["offset"] === "number" ? params["offset"] : 0,
          },
        });

        return { rows, unitsConsumed, rowsReturned: rows.length };
      } catch (e) {
        lastErr = e as Error;
        if (e instanceof AhrefsRestError && !e.retriable) throw e;
        const msg = (e as Error).message ?? "";
        const isTimeout = /timeout|timed out|aborted|ETIMEDOUT/i.test(msg);
        await this.logRestUsage({
          endpoint,
          paramsHash,
          unitsConsumed: 0,
          responseStatus: isTimeout ? "timeout" : "error",
          errorMessage: `${msg || "fetch failed"} (retry ${attempt + 1}/${MAX_RETRIES})`,
          dispatchContext: opts.dispatchContext,
          metadata: { attempt },
        });
        await sleep(jitter(RETRY_BASE_MS * 2 ** attempt));
      }
    }

    // All retries exhausted — final error log
    await this.logRestUsage({
      endpoint,
      paramsHash,
      unitsConsumed: 0,
      responseStatus: "error",
      errorMessage: lastErr?.message ?? "exhausted retries",
      dispatchContext: opts.dispatchContext,
      metadata: { retries_exhausted: true },
    });

    throw lastErr ?? new AhrefsRestError("Ahrefs REST retries exhausted", {
      endpoint,
      retriable: false,
    });
  }

  /* -------------------------------------------------------------------------
   * Usage logger
   * ---------------------------------------------------------------------- */

  /**
   * Write a row to ahrefs_rest_usage. Never throws — logging failures must
   * not cascade into callers.
   */
  private async logRestUsage(args: {
    endpoint: string;
    paramsHash: string;
    unitsConsumed: number;
    responseStatus: string;
    rowsReturned?: number;
    errorMessage?: string;
    dispatchContext?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await db.insert(ahrefsRestUsageTable).values({
        brandId: this.brandId,
        endpoint: args.endpoint,
        paramsHash: args.paramsHash,
        unitsConsumed: args.unitsConsumed,
        responseStatus: args.responseStatus,
        rowsReturned: args.rowsReturned ?? null,
        errorMessage: args.errorMessage ?? null,
        dispatchContext: args.dispatchContext ?? null,
        metadata: args.metadata ?? {},
      });
    } catch {
      // intentionally silent — logging must never break callers
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Singleton factory                                                           */
/* -------------------------------------------------------------------------- */

const _instances = new Map<string, AhrefsRestClient>();

/**
 * Return a brand-scoped AhrefsRestClient singleton.
 * One instance per brandId — safe for concurrent bulk-import dispatches
 * across multiple brands.
 */
export function getAhrefsRestClient(brandId: string): AhrefsRestClient {
  if (!_instances.has(brandId)) {
    _instances.set(brandId, new AhrefsRestClient({ brandId }));
  }
  return _instances.get(brandId)!;
}

/* -------------------------------------------------------------------------- */
/* Token-bucket rate limiter                                                   */
/* -------------------------------------------------------------------------- */

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly rps: number;

  constructor(rps: number) {
    this.rps = rps;
    this.tokens = rps;
    this.lastRefill = Date.now();
  }

  async take(): Promise<void> {
    while (true) {
      const now = Date.now();
      const elapsedSec = (now - this.lastRefill) / 1000;
      this.tokens = Math.min(this.rps, this.tokens + elapsedSec * this.rps);
      this.lastRefill = now;

      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }

      // Wait until 1 token is available
      const waitMs = Math.ceil(((1 - this.tokens) / this.rps) * 1000);
      await sleep(waitMs);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Utilities                                                                   */
/* -------------------------------------------------------------------------- */

function buildUrl(
  base: string,
  params: Record<string, string | number>,
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    qs.set(k, String(v));
  }
  return `${base}?${qs.toString()}`;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function jitter(ms: number): number {
  return ms + Math.floor(Math.random() * 300);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Today's date as YYYY-MM-DD (UTC). Required by some Ahrefs endpoints. */
function todayISO(): string {
  return new Date().toISOString().split("T")[0]!;
}

/**
 * Extract the row array from a v3 response object.
 * Ahrefs v3 wraps results under a key matching the resource name
 * (e.g. `organic_keywords`, `pages`, `domains`, `refdomains`, `domain_rating`).
 * Falls back gracefully to an empty array on unexpected shapes.
 */
function extractRows<T>(json: Record<string, unknown>, itemKey: string): T[] {
  const value = json[itemKey];

  // Some endpoints (domain-rating) return an object rather than an array.
  // Normalise: wrap a single object result into a one-element array.
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") return [value as T];
  return [];
}

/**
 * Read unit consumption from the Ahrefs v3 response body.
 * v3 reports under `metadata.units_used`; falls back to other common
 * field paths and then 0 if absent.
 */
function extractUnits(json: Record<string, unknown>): number {
  const meta = json["metadata"] as Record<string, unknown> | undefined;
  if (meta) {
    const u = meta["units_used"] ?? meta["api_units"] ?? meta["units_consumed"];
    if (typeof u === "number") return u;
    if (typeof u === "string") {
      const n = Number(u);
      if (!isNaN(n)) return n;
    }
  }
  // Top-level fallbacks
  const top = json["units_used"] ?? json["units_consumed"] ?? json["api_units"];
  if (typeof top === "number") return top;
  return 0;
}

/**
 * Extract a human-readable error message from a non-2xx Ahrefs response body.
 * v3 uses `{ "error": { "message": "..." } }` or `{ "message": "..." }`.
 */
function extractApiError(json: Record<string, unknown>): string | null {
  const err = json["error"];
  if (err && typeof err === "object") {
    const inner = err as Record<string, unknown>;
    if (typeof inner["message"] === "string") return inner["message"];
  }
  if (typeof json["message"] === "string") return json["message"];
  return null;
}

/**
 * Strip the API key from params before storing in the metadata column.
 * (apiKey is never passed as a query param in this client, but defensively
 * scrub anything that looks like a credential.)
 */
function sanitiseParams(
  params: Record<string, string | number>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (/key|token|secret|password/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}
