import { guardedDb as db, integrationCallLogTable } from "@workspace/db";
import { DataForSEOError } from "./errors";
import { TokenBucket } from "./rate-limit";
import {
  SerpResponseSchema,
  type SerpResponse,
  type SerpRequest,
} from "./types";

const BASE = "https://api.dataforseo.com/v3";
const DEFAULT_RPS = 30;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;
const jitter = (n: number) => n + Math.floor(Math.random() * 200);

export interface DataForSEOClientOpts {
  login?: string;
  password?: string;
  rateLimitPerSec?: number;
  fetch?: typeof fetch;
  brandId?: string | null;
}

export class DataForSEOClient {
  private readonly login: string;
  private readonly password: string;
  private readonly bucket: TokenBucket;
  private readonly fetchImpl: typeof fetch;
  private readonly brandId: string | null;

  constructor(opts: DataForSEOClientOpts = {}) {
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
          await this.logCall({
            endpoint,
            status: "error",
            httpStatus: res.status,
            durationMs: Date.now() - start,
            requestMeta: { keyword: req.keyword },
            errorMessage: `HTTP ${res.status}`,
          });
          throw new DataForSEOError(
            `DataForSEO ${endpoint} failed: ${res.status}`,
            { httpStatus: res.status, endpoint, retriable: false, responseBody: json },
          );
        }

        const parsed = SerpResponseSchema.parse(json);
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
   * OnPage stub — full Sprint 5 work. For now just verifies credentials
   * and returns the API key info endpoint shape.
   */
  async onPageInstantPagesStub(_url: string): Promise<{ stub: true }> {
    return { stub: true };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
