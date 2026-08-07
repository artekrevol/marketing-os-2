import { createHash } from "node:crypto";
import { guardedDb as db, integrationCallLogTable, dataforSEOLabsUsageTable } from "@workspace/db";
import { DataForSEOError } from "./errors";
import { TokenBucket } from "./rate-limit";
import { TtlCache } from "./cache";
import {
  SerpResponseSchema,
  SearchVolumeResponseSchema,
  KeywordIdeasResponseSchema,
  RankedKeywordsResponseSchema,
  OnPageResponseSchema,
  RelatedKeywordsResponseSchema,
  CompetitorsForDomainResponseSchema,
  BulkKeywordDifficultyResponseSchema,
  type SerpResponse,
  type SerpRequest,
  type SerpAdvancedRequest,
  type SearchVolumeResponse,
  type SearchVolumeRequest,
  type KeywordIdeasResponse,
  type KeywordIdeasRequest,
  type RankedKeywordsResponse,
  type RankedKeywordsRequest,
  type OnPageResponse,
  type OnPageInstantRequest,
  type RelatedKeywordsResponse,
  type RelatedKeywordsRequest,
  type CompetitorsForDomainResponse,
  type CompetitorsForDomainRequest,
  type BulkKeywordDifficultyResponse,
  type BulkKeywordDifficultyRequest,
} from "./types";
import type { z } from "zod";

const BASE = "https://api.dataforseo.com/v3";
const DEFAULT_RPS = 30;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;
const jitter = (n: number) => n + Math.floor(Math.random() * 200);

/**
 * Minimal shape needed to inspect task-level status codes.
 * DataForSEO wraps billing/auth errors in HTTP 200 envelopes where the
 * outer status_code is 20000 but individual tasks carry the real error code.
 * Without this check the caller sees empty `result: null` → `items ?? []`
 * and has no way to distinguish "no keywords" from "account balance zero".
 */
type DfsTaskCheckable = {
  tasks_error?: number;
  tasks?: Array<{ status_code: number; status_message: string }>;
};

/**
 * Throws a DataForSEOError when any task in the response carries a
 * non-20000 status code.  Called immediately after schema.parse() so the
 * error surfaces before callers interpret empty results as real data.
 *
 * Retry policy per task code:
 *   40200 Payment Required  → non-retriable (account-level; retrying wastes budget)
 *   40101 Unauthorized      → non-retriable (credentials wrong)
 *   5xxxx Server error      → retriable
 *   other 4xxxx             → non-retriable (bad request, plan limit, etc.)
 */
function assertTasksOk(endpoint: string, parsed: DfsTaskCheckable): void {
  if (!parsed.tasks_error || parsed.tasks_error === 0) return;
  const failed = parsed.tasks?.find((t) => t.status_code !== 20000);
  const code = failed?.status_code ?? 0;
  const msg = failed?.status_message ?? "unknown task error";
  const retriable = code >= 50000; // server-side errors only
  const hint =
    code === 40200
      ? " — account balance is insufficient; top up at app.dataforseo.com"
      : code === 40101
        ? " — check DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD credentials"
        : "";
  throw new DataForSEOError(
    `DataForSEO ${endpoint} task ${code}: ${msg}${hint}`,
    { endpoint, retriable, responseBody: { taskStatusCode: code } },
  );
}

export interface DataForSEOClientOpts {
  login?: string;
  password?: string;
  rateLimitPerSec?: number;
  fetch?: typeof fetch;
  brandId?: string | null;
  cache?: TtlCache;
}

export class DataForSEOClient {
  private readonly login: string;
  private readonly password: string;
  private readonly bucket: TokenBucket;
  private readonly fetchImpl: typeof fetch;
  private readonly brandId: string | null;
  private readonly cache: TtlCache;

  constructor(opts: DataForSEOClientOpts = {}) {
    // Credentials come from DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD only.
    // SEO-main also probed DATAFORSEO_API_LOGIN / DATAFORSEO_API_PASSWORD
    // aliases; those were intentionally NOT adopted here — this repo's
    // single secret pair is the source of truth. Do not reintroduce the
    // aliases without updating the deployment secrets contract.
    const login = opts.login ?? process.env["DATAFORSEO_LOGIN"];
    const password = opts.password ?? process.env["DATAFORSEO_PASSWORD"];
    if (!login || !password) {
      throw new DataForSEOError(
        "DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set.",
        { endpoint: "<init>", retriable: false },
      );
    }
    this.login = login;
    this.password = password;
    this.bucket = new TokenBucket(opts.rateLimitPerSec ?? DEFAULT_RPS, opts.rateLimitPerSec ?? DEFAULT_RPS);
    this.fetchImpl = opts.fetch ?? fetch;
    this.brandId = opts.brandId ?? null;
    this.cache = opts.cache ?? new TtlCache();
  }

  private authHeader(): string {
    const enc = Buffer.from(`${this.login}:${this.password}`).toString("base64");
    return `Basic ${enc}`;
  }

  private async logCall(args: {
    endpoint: string;
    status: "ok" | "error" | "rate_limited" | "timeout";
    httpStatus?: number;
    durationMs: number;
    costEstimate?: number;
    requestMeta?: Record<string, unknown>;
    errorMessage?: string;
  }): Promise<void> {
    try {
      await db.insert(integrationCallLogTable).values({
        vendor: "dataforseo",
        endpoint: args.endpoint,
        status: args.status,
        httpStatus: args.httpStatus,
        durationMs: args.durationMs,
        costEstimateUsd: args.costEstimate?.toString(),
        brandId: this.brandId,
        requestMeta: args.requestMeta ?? {},
        errorMessage: args.errorMessage,
      });
    } catch {
      // never let logging failures cascade into the caller
    }
  }

  /** Live SERP — Google Organic Standard. Synchronous live endpoint. */
  async serpGoogleOrganicLive(req: SerpRequest): Promise<SerpResponse> {
    const endpoint = "/serp/google/organic/live/regular";
    const body = [
      {
        keyword: req.keyword,
        location_code: req.locationCode ?? 2840,
        language_code: req.languageCode ?? "en",
        depth: req.depth ?? 10,
      },
    ];

    const start = Date.now();
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      await this.bucket.take();
      try {
        const res = await this.fetchImpl(`${BASE}${endpoint}`, {
          method: "POST",
          headers: {
            Authorization: this.authHeader(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (res.status === 429 || res.status >= 500) {
          lastErr = new DataForSEOError(
            `DataForSEO ${endpoint} returned ${res.status}`,
            { httpStatus: res.status, endpoint, retriable: true },
          );
          // Classify so the integration_call_log row clearly shows
          // why the call was retried.
          await this.logCall({
            endpoint,
            status: res.status === 429 ? "rate_limited" : "error",
            httpStatus: res.status,
            durationMs: Date.now() - start,
            requestMeta: { keyword: req.keyword, attempt },
            errorMessage: `HTTP ${res.status} (retry ${attempt + 1}/${MAX_RETRIES})`,
          });
          await sleep(jitter(RETRY_BASE_MS * 2 ** attempt));
          continue;
        }

        const json = (await res.json()) as unknown;
        if (!res.ok) {
          const hint =
            res.status === 402
              ? " — account balance is insufficient; top up at app.dataforseo.com"
              : "";
          await this.logCall({
            endpoint,
            status: "error",
            httpStatus: res.status,
            durationMs: Date.now() - start,
            requestMeta: { keyword: req.keyword },
            errorMessage: `HTTP ${res.status}${hint}`,
          });
          throw new DataForSEOError(
            `DataForSEO ${endpoint} failed: ${res.status}${hint}`,
            { httpStatus: res.status, endpoint, retriable: false, responseBody: json },
          );
        }

        const parsed = SerpResponseSchema.parse(json);
        assertTasksOk(endpoint, parsed);
        await this.logCall({
          endpoint,
          status: "ok",
          httpStatus: res.status,
          durationMs: Date.now() - start,
          costEstimate: parsed.cost,
          requestMeta: { keyword: req.keyword, items: parsed.tasks[0]?.result?.[0]?.items?.length ?? 0 },
        });
        return parsed;
      } catch (e) {
        lastErr = e as Error;
        if (e instanceof DataForSEOError && !e.retriable) throw e;
        // Network-level failure (fetch threw): timeout, DNS, TLS, etc.
        // Classify as "timeout" so observability dashboards can split
        // these out from upstream HTTP errors.
        const msg = (e as Error).message ?? "";
        const looksLikeTimeout = /timeout|timed out|aborted|ETIMEDOUT/i.test(msg);
        await this.logCall({
          endpoint,
          status: looksLikeTimeout ? "timeout" : "error",
          durationMs: Date.now() - start,
          requestMeta: { keyword: req.keyword, attempt },
          errorMessage: `${msg || "fetch failed"} (retry ${attempt + 1}/${MAX_RETRIES})`,
        });
        await sleep(jitter(RETRY_BASE_MS * 2 ** attempt));
      }
    }

    await this.logCall({
      endpoint,
      status: "error",
      durationMs: Date.now() - start,
      requestMeta: { keyword: req.keyword },
      errorMessage: lastErr?.message ?? "exhausted retries",
    });
    throw lastErr ?? new DataForSEOError("DataForSEO retries exhausted", {
      endpoint,
      retriable: false,
    });
  }

  /**
   * Generic POST executor for DataForSEO v3 endpoints: enforces the
   * rate-limit token bucket, retries on 429/5xx with jittered backoff,
   * classifies + logs every attempt to integration_call_log, validates
   * the response with the supplied Zod schema, and optionally caches
   * the parsed result. Mirrors the error handling of
   * serpGoogleOrganicLive so behaviour stays consistent across calls.
   */
  private async execute<T extends { cost: number }>(opts: {
    endpoint: string;
    body: unknown;
    schema: z.ZodType<T, z.ZodTypeDef, unknown>;
    requestMeta?: Record<string, unknown>;
    cacheKey?: string;
    cacheTtlMs?: number;
  }): Promise<T> {
    const { endpoint, body, schema } = opts;
    const requestMeta = opts.requestMeta ?? {};

    if (opts.cacheKey) {
      const hit = this.cache.get<T>(opts.cacheKey);
      if (hit !== undefined) return hit;
    }

    const start = Date.now();
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      await this.bucket.take();
      try {
        const res = await this.fetchImpl(`${BASE}${endpoint}`, {
          method: "POST",
          headers: {
            Authorization: this.authHeader(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (res.status === 429 || res.status >= 500) {
          lastErr = new DataForSEOError(
            `DataForSEO ${endpoint} returned ${res.status}`,
            { httpStatus: res.status, endpoint, retriable: true },
          );
          await this.logCall({
            endpoint,
            status: res.status === 429 ? "rate_limited" : "error",
            httpStatus: res.status,
            durationMs: Date.now() - start,
            requestMeta: { ...requestMeta, attempt },
            errorMessage: `HTTP ${res.status} (retry ${attempt + 1}/${MAX_RETRIES})`,
          });
          await sleep(jitter(RETRY_BASE_MS * 2 ** attempt));
          continue;
        }

        const json = (await res.json()) as unknown;
        if (!res.ok) {
          const hint402 =
            res.status === 402
              ? " — account balance is insufficient; top up at app.dataforseo.com"
              : "";
          await this.logCall({
            endpoint,
            status: "error",
            httpStatus: res.status,
            durationMs: Date.now() - start,
            requestMeta,
            errorMessage: `HTTP ${res.status}${hint402}`,
          });
          throw new DataForSEOError(
            `DataForSEO ${endpoint} failed: ${res.status}${hint402}`,
            { httpStatus: res.status, endpoint, retriable: false, responseBody: json },
          );
        }

        const parsed = schema.parse(json);
        assertTasksOk(endpoint, parsed as DfsTaskCheckable);
        await this.logCall({
          endpoint,
          status: "ok",
          httpStatus: res.status,
          durationMs: Date.now() - start,
          costEstimate: parsed.cost,
          requestMeta,
        });
        if (opts.cacheKey) this.cache.set(opts.cacheKey, parsed, opts.cacheTtlMs);
        return parsed;
      } catch (e) {
        lastErr = e as Error;
        if (e instanceof DataForSEOError && !e.retriable) throw e;
        const msg = (e as Error).message ?? "";
        const looksLikeTimeout = /timeout|timed out|aborted|ETIMEDOUT/i.test(msg);
        await this.logCall({
          endpoint,
          status: looksLikeTimeout ? "timeout" : "error",
          durationMs: Date.now() - start,
          requestMeta: { ...requestMeta, attempt },
          errorMessage: `${msg || "fetch failed"} (retry ${attempt + 1}/${MAX_RETRIES})`,
        });
        await sleep(jitter(RETRY_BASE_MS * 2 ** attempt));
      }
    }

    await this.logCall({
      endpoint,
      status: "error",
      durationMs: Date.now() - start,
      requestMeta,
      errorMessage: lastErr?.message ?? "exhausted retries",
    });
    throw lastErr ?? new DataForSEOError("DataForSEO retries exhausted", {
      endpoint,
      retriable: false,
    });
  }

  /**
   * Live SERP — Google Organic Advanced. Returns the full SERP item
   * list (organic + ads + local pack); true-organic position math is
   * the caller's responsibility (worker handlers). Not cached: rank
   * tracking snapshots must reflect current rankings.
   */
  async serpGoogleOrganicLiveAdvanced(
    req: SerpAdvancedRequest,
  ): Promise<SerpResponse> {
    const body = [
      {
        keyword: req.keyword,
        location_code: req.locationCode ?? 2840,
        language_code: req.languageCode ?? "en",
        depth: req.depth ?? 100,
        device: req.device ?? "desktop",
        os: req.os ?? "windows",
        calculate_rectangles: false,
      },
    ];
    return this.execute({
      endpoint: "/serp/google/organic/live/advanced",
      body,
      schema: SerpResponseSchema,
      requestMeta: { keyword: req.keyword },
    });
  }

  /**
   * Search Volume — Google Ads. Cached (7-day TTL): search-volume data
   * is slow-moving and identical queries are common.
   */
  async keywordSearchVolume(
    req: SearchVolumeRequest,
  ): Promise<SearchVolumeResponse> {
    const locationCode = req.locationCode ?? 2840;
    const languageCode = req.languageCode ?? "en";
    const body = [
      { keywords: req.keywords, location_code: locationCode, language_code: languageCode },
    ];
    const cacheKey = TtlCache.fingerprint("/keywords_data/google_ads/search_volume/live", {
      keywords: [...req.keywords].sort(),
      locationCode,
      languageCode,
    });
    return this.execute({
      endpoint: "/keywords_data/google_ads/search_volume/live",
      body,
      schema: SearchVolumeResponseSchema,
      requestMeta: { count: req.keywords.length },
      cacheKey,
    });
  }

  /**
   * Keyword Ideas — Google Ads keywords-for-keywords (LSI expansion).
   * Cached (7-day TTL).
   */
  async keywordIdeas(req: KeywordIdeasRequest): Promise<KeywordIdeasResponse> {
    const locationCode = req.locationCode ?? 2840;
    const languageCode = req.languageCode ?? "en";
    const limit = req.limit ?? 100;
    const body = [
      {
        keywords: req.keywords,
        location_code: locationCode,
        language_code: languageCode,
        limit,
      },
    ];
    const cacheKey = TtlCache.fingerprint(
      "/keywords_data/google_ads/keywords_for_keywords/live",
      { keywords: [...req.keywords].sort(), locationCode, languageCode, limit },
    );
    return this.execute({
      endpoint: "/keywords_data/google_ads/keywords_for_keywords/live",
      body,
      schema: KeywordIdeasResponseSchema,
      requestMeta: { count: req.keywords.length, limit },
      cacheKey,
    });
  }

  /**
   * Ranked Keywords — DataForSEO Labs. Returns the keywords a target
   * domain ranks for; feeds competitor insight computation. Cached
   * (7-day TTL).
   */
  async rankedKeywords(
    req: RankedKeywordsRequest,
  ): Promise<RankedKeywordsResponse> {
    const locationCode = req.locationCode ?? 2840;
    const languageCode = req.languageCode ?? "en";
    const limit = req.limit ?? 100;
    const body = [
      {
        target: req.target,
        location_code: locationCode,
        language_code: languageCode,
        limit,
      },
    ];
    const cacheKey = TtlCache.fingerprint(
      "/dataforseo_labs/google/ranked_keywords/live",
      { target: req.target, locationCode, languageCode, limit },
    );
    return this.execute({
      endpoint: "/dataforseo_labs/google/ranked_keywords/live",
      body,
      schema: RankedKeywordsResponseSchema,
      requestMeta: { target: req.target, limit },
      cacheKey,
    });
  }

  /**
   * OnPage Instant Pages — fetch + parse a single URL on demand. Used
   * for external citation grounding. Not cached: callers want a fresh
   * fetch of the page each time.
   */
  async onPageInstantPages(req: OnPageInstantRequest): Promise<OnPageResponse> {
    const body = [
      { url: req.url, enable_javascript: req.enableJavascript ?? false },
    ];
    return this.execute({
      endpoint: "/on_page/instant_pages",
      body,
      schema: OnPageResponseSchema,
      requestMeta: { url: req.url },
    });
  }

  // ---- DataForSEO Labs — Discovery Engine endpoints ------------------

  /**
   * Write one row to dataforseo_labs_usage for cost attribution and
   * weekly dispatch tracking. Never throws — logging failures must not
   * cascade into the caller.
   */
  private async logLabsUsage(args: {
    endpoint: string;
    paramsHash: string;
    responseStatus: string;
    costUsd: number;
    itemsReturned?: number;
    dispatchContext?: string;
    errorMessage?: string;
  }): Promise<void> {
    if (!this.brandId) return; // brand-scoped table; skip if no brand context
    try {
      await db.insert(dataforSEOLabsUsageTable).values({
        brandId: this.brandId,
        endpoint: args.endpoint,
        paramsHash: args.paramsHash,
        responseStatus: args.responseStatus,
        costUsd: args.costUsd.toString(),
        itemsReturned: args.itemsReturned,
        dispatchContext: args.dispatchContext
          ? args.dispatchContext.slice(0, 120)
          : null,
        errorMessage: args.errorMessage ?? null,
        metadata: {},
      });
    } catch {
      // never let logging failures cascade
    }
  }

  /**
   * Stable sha256-based params hash for dataforseo_labs_usage.params_hash.
   * Deterministic for identical queries; used for dedup and cost auditing.
   */
  private static paramsHash(endpoint: string, params: unknown): string {
    const raw = TtlCache.fingerprint(endpoint, params);
    return createHash("sha256").update(raw).digest("hex");
  }

  /**
   * Related Keywords — DataForSEO Labs.
   * /dataforseo_labs/google/related_keywords/live
   *
   * Returns semantically related keywords for a seed term. The core
   * expansion step in Discovery Engine Phase 3 Step A. Cached (7-day
   * TTL) — related-keyword sets are slow-moving relative to live SERP.
   * Writes one row to dataforseo_labs_usage per call for cost tracking.
   */
  async relatedKeywords(
    req: RelatedKeywordsRequest,
  ): Promise<RelatedKeywordsResponse> {
    const endpoint = "/dataforseo_labs/google/related_keywords/live";
    const locationCode = req.locationCode ?? 2840;
    const languageCode = req.languageCode ?? "en";
    const limit = req.limit ?? 500;
    const depth = req.depth ?? 1;

    const body = [
      {
        keyword: req.keyword,
        location_code: locationCode,
        language_code: languageCode,
        limit,
        depth,
      },
    ];

    const cacheKey = TtlCache.fingerprint(endpoint, {
      keyword: req.keyword,
      locationCode,
      languageCode,
      limit,
      depth,
    });
    const pHash = DataForSEOClient.paramsHash(endpoint, {
      keyword: req.keyword,
      locationCode,
      languageCode,
      limit,
      depth,
    });

    let result: RelatedKeywordsResponse;
    try {
      result = await this.execute({
        endpoint,
        body,
        schema: RelatedKeywordsResponseSchema,
        requestMeta: { keyword: req.keyword, limit, depth },
        cacheKey,
      });
    } catch (e) {
      await this.logLabsUsage({
        endpoint,
        paramsHash: pHash,
        responseStatus: "error",
        costUsd: 0,
        dispatchContext: req.dispatchContext,
        errorMessage: (e as Error).message,
      });
      throw e;
    }

    const items = result.tasks[0]?.result?.[0]?.items?.length ?? 0;
    await this.logLabsUsage({
      endpoint,
      paramsHash: pHash,
      responseStatus: "ok",
      costUsd: result.cost,
      itemsReturned: items,
      dispatchContext: req.dispatchContext,
    });
    return result;
  }

  /**
   * Competitors for Domain — DataForSEO Labs.
   * /dataforseo_labs/google/competitors_for_domain/live
   *
   * Returns the top competing domains by shared keyword count. Used in
   * Discovery Engine Phase 3 Step D to seed competitor-keyword mining.
   * Cached (7-day TTL). Writes to dataforseo_labs_usage per call.
   */
  async competitorsForDomain(
    req: CompetitorsForDomainRequest,
  ): Promise<CompetitorsForDomainResponse> {
    const endpoint = "/dataforseo_labs/google/competitors_for_domain/live";
    const locationCode = req.locationCode ?? 2840;
    const languageCode = req.languageCode ?? "en";
    const limit = req.limit ?? 100;

    const body = [
      {
        target: req.target,
        location_code: locationCode,
        language_code: languageCode,
        limit,
        exclude_top_domains: false,
      },
    ];

    const cacheKey = TtlCache.fingerprint(endpoint, {
      target: req.target,
      locationCode,
      languageCode,
      limit,
    });
    const pHash = DataForSEOClient.paramsHash(endpoint, {
      target: req.target,
      locationCode,
      languageCode,
      limit,
    });

    let result: CompetitorsForDomainResponse;
    try {
      result = await this.execute({
        endpoint,
        body,
        schema: CompetitorsForDomainResponseSchema,
        requestMeta: { target: req.target, limit },
        cacheKey,
      });
    } catch (e) {
      await this.logLabsUsage({
        endpoint,
        paramsHash: pHash,
        responseStatus: "error",
        costUsd: 0,
        dispatchContext: req.dispatchContext,
        errorMessage: (e as Error).message,
      });
      throw e;
    }

    const items = result.tasks[0]?.result?.[0]?.items?.length ?? 0;
    await this.logLabsUsage({
      endpoint,
      paramsHash: pHash,
      responseStatus: "ok",
      costUsd: result.cost,
      itemsReturned: items,
      dispatchContext: req.dispatchContext,
    });
    return result;
  }

  /**
   * Bulk Keyword Difficulty — DataForSEO Labs.
   * /dataforseo_labs/google/bulk_keyword_difficulty/live
   *
   * Batch KD scores for up to 1000 keywords per call. Used in
   * Discovery Engine Phase 3 Step B to filter high-difficulty
   * candidates before DB insert. Cached (7-day TTL). Writes to
   * dataforseo_labs_usage per call.
   */
  async bulkKeywordDifficulty(
    req: BulkKeywordDifficultyRequest,
  ): Promise<BulkKeywordDifficultyResponse> {
    const endpoint = "/dataforseo_labs/google/bulk_keyword_difficulty/live";
    const locationCode = req.locationCode ?? 2840;
    const languageCode = req.languageCode ?? "en";
    const sortedKeywords = [...req.keywords].sort();

    const body = [
      {
        keywords: sortedKeywords,
        location_code: locationCode,
        language_code: languageCode,
      },
    ];

    const cacheKey = TtlCache.fingerprint(endpoint, {
      keywords: sortedKeywords,
      locationCode,
      languageCode,
    });
    const pHash = DataForSEOClient.paramsHash(endpoint, {
      keywords: sortedKeywords,
      locationCode,
      languageCode,
    });

    let result: BulkKeywordDifficultyResponse;
    try {
      result = await this.execute({
        endpoint,
        body,
        schema: BulkKeywordDifficultyResponseSchema,
        requestMeta: { count: req.keywords.length },
        cacheKey,
      });
    } catch (e) {
      await this.logLabsUsage({
        endpoint,
        paramsHash: pHash,
        responseStatus: "error",
        costUsd: 0,
        dispatchContext: req.dispatchContext,
        errorMessage: (e as Error).message,
      });
      throw e;
    }

    const items = result.tasks[0]?.result?.[0]?.items?.length ?? 0;
    await this.logLabsUsage({
      endpoint,
      paramsHash: pHash,
      responseStatus: "ok",
      costUsd: result.cost,
      itemsReturned: items,
      dispatchContext: req.dispatchContext,
    });
    return result;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
