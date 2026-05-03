import { z } from "zod";
import { db, integrationCallLogTable } from "@workspace/db";
import { OriginalityAIError } from "./errors";

const BASE = "https://api.originality.ai/api/v1";
const DEFAULT_RPS = 10;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;
const jitter = (n: number) => n + Math.floor(Math.random() * 200);

const ScanResponseSchema = z.object({
  success: z.boolean().optional(),
  // Originality returns a `score` object with `ai` and `original` floats
  // in [0,1]. We surface aiScore and a derived plagiarismScore. Field
  // shapes vary slightly by plan; keep them permissive.
  score: z
    .object({
      ai: z.number().nullable().optional(),
      original: z.number().nullable().optional(),
    })
    .optional(),
  scan_id: z.string().or(z.number()).optional(),
  public_link: z.string().optional(),
  credits_used: z.number().optional(),
  plagiarism: z
    .object({
      score: z.number().nullable().optional(),
    })
    .optional(),
});

export interface OriginalityAIClientOpts {
  apiKey?: string;
  rateLimitPerSec?: number;
  fetch?: typeof fetch;
  brandId?: string | null;
}

export interface ScanResult {
  aiScore: number | null;
  plagiarismScore: number | null;
  scanId: string | null;
  creditsUsed: number;
  publicLink: string | null;
}

export class OriginalityAIClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly brandId: string | null;
  private nextSlotMs = 0;
  private readonly minIntervalMs: number;

  constructor(opts: OriginalityAIClientOpts = {}) {
    const apiKey = opts.apiKey ?? process.env["ORIGINALITY_AI_KEY"];
    if (!apiKey) {
      throw new OriginalityAIError("ORIGINALITY_AI_KEY must be set.", {
        endpoint: "<init>",
        retriable: false,
      });
    }
    this.apiKey = apiKey;
    this.fetchImpl = opts.fetch ?? fetch;
    this.brandId = opts.brandId ?? null;
    const rps = opts.rateLimitPerSec ?? DEFAULT_RPS;
    this.minIntervalMs = Math.max(1, Math.ceil(1000 / rps));
  }

  private async waitForSlot(): Promise<void> {
    const now = Date.now();
    if (now < this.nextSlotMs) {
      await new Promise((r) => setTimeout(r, this.nextSlotMs - now));
    }
    this.nextSlotMs = Math.max(now, this.nextSlotMs) + this.minIntervalMs;
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
        vendor: "originality-ai",
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
      // swallow telemetry errors
    }
  }

  /** Scan API + Plagiarism. Returns aiScore, plagiarismScore, scanId. */
  async scanText(text: string): Promise<ScanResult> {
    const endpoint = "/scan/ai";
    const start = Date.now();
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      await this.waitForSlot();
      try {
        const res = await this.fetchImpl(`${BASE}${endpoint}`, {
          method: "POST",
          headers: {
            "X-OAI-API-KEY": this.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content: text,
            title: "SEO OS heartbeat scan",
            aiModelVersion: "1",
            storeScan: false,
          }),
        });

        if (res.status === 429 || res.status >= 500) {
          lastErr = new OriginalityAIError(
            `Originality.ai ${endpoint} returned ${res.status}`,
            { httpStatus: res.status, endpoint, retriable: true },
          );
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
            errorMessage: `HTTP ${res.status}`,
          });
          throw new OriginalityAIError(
            `Originality.ai ${endpoint} failed: ${res.status}`,
            { httpStatus: res.status, endpoint, retriable: false, responseBody: json },
          );
        }

        const parsed = ScanResponseSchema.parse(json);
        const aiScore = parsed.score?.ai ?? null;
        const plagiarismScore = parsed.plagiarism?.score ?? null;
        const scanIdRaw = parsed.scan_id;
        const scanId = scanIdRaw !== undefined ? String(scanIdRaw) : null;
        const creditsUsed = parsed.credits_used ?? 0;

        await this.logCall({
          endpoint,
          status: "ok",
          httpStatus: res.status,
          durationMs: Date.now() - start,
          costEstimate: creditsUsed * 0.01, // ~$0.01/credit, rough estimate
          requestMeta: { aiScore, plagiarismScore, scanId },
        });

        return {
          aiScore,
          plagiarismScore,
          scanId,
          creditsUsed,
          publicLink: parsed.public_link ?? null,
        };
      } catch (e) {
        lastErr = e as Error;
        if (e instanceof OriginalityAIError && !e.retriable) throw e;
        await sleep(RETRY_BASE_MS * 2 ** attempt);
      }
    }

    await this.logCall({
      endpoint,
      status: "error",
      durationMs: Date.now() - start,
      errorMessage: lastErr?.message ?? "exhausted retries",
    });
    throw lastErr ?? new OriginalityAIError("Originality.ai retries exhausted", {
      endpoint,
      retriable: false,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
