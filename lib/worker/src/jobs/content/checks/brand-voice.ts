import { eq } from "drizzle-orm";
import { withBrandScope, brandsTable, type Brand } from "@workspace/db";
import type { Logger } from "pino";
import type { CheckRunInput, CheckRunResult } from "../qa-run-checks";
import { loadEnv } from "../../../env";
import { Sentry } from "../../../sentry";

/**
 * Warn-level check: brand-voice match confidence.
 *
 * Implementation: read the brand's `voice_profile` (jsonb) from
 * `public.brands`, send it to OpenAI alongside an excerpt of the body,
 * and parse a 0–1 score from a JSON-mode response. The model is
 * pinned to `gpt-4o-mini` for cost; the response_format is
 * `json_object` so we don't have to do free-text parsing. On any
 * upstream error we surface `outcome="error"` with the error message
 * in `details.error` rather than masking it as a pass.
 *
 * Reliability (Part 1.5): the OpenAI fetch is wrapped in a 30s
 * AbortController and retried up to 3x with exponential backoff and
 * jitter — same shape as the DataForSEO and Originality.ai clients.
 * A hung OpenAI call therefore caps brand-voice's total wall-clock at
 * ~90s + backoff (worst case), preserving the 90s qa_run budget on a
 * happy-path run with three other parallel checks. Terminal failures
 * are tagged with `errorClass` so `qa.check_errored` events can be
 * grouped by failure mode in observability dashboards.
 */

const MODEL = "gpt-4o-mini";
const EXCERPT_CHARS = 6000;
// Sprint 1 #5: chunked scoring so the brand-voice signal covers the
// whole article instead of just the first ~1,500 words. We split the
// body into chunks of EXCERPT_CHARS, score each, then average. Capped
// at MAX_CHUNKS to bound worst-case cost (4 chunks × 3 retries × 30s).
// At ~24,000 chars (~4,500 words) coverage saturates for typical blog
// posts; longer pieces sample first/middle/last/end via stride.
const MAX_CHUNKS = 4;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;
const REQUEST_TIMEOUT_MS = 30_000;
const jitter = (n: number): number => n + Math.floor(Math.random() * 200);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

class OpenAIRetriableError extends Error {
  readonly retriable = true as const;
  readonly httpStatus?: number;
  constructor(message: string, opts: { httpStatus?: number } = {}) {
    super(message);
    this.name = "OpenAIRetriableError";
    this.httpStatus = opts.httpStatus;
  }
}

class OpenAINonRetriableError extends Error {
  readonly retriable = false as const;
  readonly httpStatus?: number;
  constructor(message: string, opts: { httpStatus?: number } = {}) {
    super(message);
    this.name = "OpenAINonRetriableError";
    this.httpStatus = opts.httpStatus;
  }
}

class OpenAITimeoutError extends Error {
  readonly attempts: number;
  constructor(attempts: number, message?: string) {
    super(message ?? `OpenAI request timed out after ${attempts} attempts`);
    this.name = "OpenAITimeoutError";
    this.attempts = attempts;
  }
}

class OpenAIRetriesExhaustedError extends Error {
  readonly attempts: number;
  constructor(attempts: number, lastMessage: string) {
    super(`OpenAI retries exhausted after ${attempts} attempts: ${lastMessage}`);
    this.name = "OpenAIRetriesExhaustedError";
    this.attempts = attempts;
  }
}

export async function runBrandVoiceCheck(
  input: CheckRunInput,
  log: Logger,
): Promise<CheckRunResult> {
  const threshold = input.threshold ?? 0.7;

  const words = (input.bodyMd.match(/\b[\w'-]+\b/g) ?? []).length;
  if (words < 80) {
    return {
      outcome: "fail",
      score: null,
      threshold,
      summary: "Brand voice: body too short (<80 words) for confident scoring.",
      details: { reason: "too_short", wordCount: words },
    };
  }

  const brand = await withBrandScope(input.brandId, async ({ db }) => {
    const rows = (await db
      .select()
      .from(brandsTable)
      .where(eq(brandsTable.id, input.brandId))
      .limit(1)) as Brand[];
    return rows[0] ?? null;
  });
  if (!brand) {
    return {
      outcome: "error",
      score: null,
      threshold,
      summary: `Brand voice: brand ${input.brandId} not found.`,
      details: { error: "brand_not_found", errorClass: "BrandNotFoundError" },
    };
  }

  const voiceProfile = (brand.voiceProfile ?? {}) as Record<string, unknown>;
  const chunks = chunkBody(input.bodyMd, EXCERPT_CHARS, MAX_CHUNKS);
  const totalChars = chunks.reduce((n, c) => n + c.length, 0);

  let parsed: { score?: number; reasoning?: string; flags?: string[] } | null = null;
  try {
    // Sequential, not parallel — keeps per-call rate-limit blast radius
    // small and lets a single chunk's retries cost the wall-clock that
    // the existing 90s qa_run budget already accounts for.
    const results: Array<{ score: number; reasoning?: string; flags?: string[] }> = [];
    for (const chunk of chunks) {
      results.push(
        await scoreVoiceWithOpenAI(
          { voiceProfile, excerpt: chunk, brandName: brand.name },
          log,
        ),
      );
    }
    // Length-weighted average so a trailing short chunk doesn't get
    // equal pull with a full 6000-char chunk. Flag union dedupes across
    // chunks so the same banned phrase flagged in two places shows once.
    const weighted = results.reduce(
      (acc, r, i) => acc + r.score * chunks[i]!.length,
      0,
    );
    const avgScore = totalChars > 0 ? weighted / totalChars : results[0]?.score ?? 0;
    const allFlags = Array.from(
      new Set(results.flatMap((r) => r.flags ?? [])),
    );
    const reasoning = results
      .map((r, i) => (results.length > 1 ? `[chunk ${i + 1}] ${r.reasoning ?? ""}` : r.reasoning ?? ""))
      .filter(Boolean)
      .join(" · ");
    parsed = { score: avgScore, reasoning, flags: allFlags };
  } catch (err) {
    log.error({ err }, "brand-voice: OpenAI call failed");
    Sentry.withScope((scope) => {
      scope.setTags({
        check: "brand-voice.confidence",
        brandId: input.brandId,
        errorClass: (err as Error).name,
      });
      scope.setContext("brandVoice", {
        contentObjectId: input.contentObjectId,
        attempts: (err as { attempts?: number }).attempts ?? null,
      });
      Sentry.captureException(err);
    });

    if (err instanceof OpenAITimeoutError) {
      return {
        outcome: "error",
        score: null,
        threshold,
        summary: `Brand voice: OpenAI call timed out after ${err.attempts} attempts.`,
        details: {
          error: "timeout",
          attempts: err.attempts,
          errorClass: "OpenAITimeoutError",
        },
      };
    }
    if (err instanceof OpenAIRetriesExhaustedError) {
      return {
        outcome: "error",
        score: null,
        threshold,
        summary: `Brand voice: OpenAI retries exhausted — ${err.message}`,
        details: {
          error: "retries_exhausted",
          attempts: err.attempts,
          errorClass: "OpenAIRetriesExhaustedError",
        },
      };
    }
    return {
      outcome: "error",
      score: null,
      threshold,
      summary: `Brand voice: OpenAI call failed — ${(err as Error).message}`,
      details: {
        error: (err as Error).message,
        errorClass: (err as Error).name || "Error",
      },
    };
  }

  const rawScore = typeof parsed?.score === "number" ? parsed.score : NaN;
  if (!Number.isFinite(rawScore)) {
    return {
      outcome: "error",
      score: null,
      threshold,
      summary: "Brand voice: OpenAI response missing numeric score.",
      details: { error: "no_score", errorClass: "NoScoreError", parsed },
    };
  }
  const score = Math.max(0, Math.min(1, rawScore));
  const passed = score >= threshold;
  return {
    outcome: passed ? "pass" : "fail",
    score: Math.round(score * 1000) / 1000,
    threshold,
    summary: passed
      ? `Voice confidence ${(score * 100).toFixed(1)}% ≥ ${(threshold * 100).toFixed(0)}%.`
      : `Voice confidence ${(score * 100).toFixed(1)}% below ${(threshold * 100).toFixed(0)}% — review tone.`,
    details: {
      model: MODEL,
      reasoning: parsed.reasoning ?? null,
      flags: parsed.flags ?? [],
      voiceProfileKeys: Object.keys(voiceProfile),
      excerptChars: totalChars,
      chunkCount: chunks.length,
      bodyChars: input.bodyMd.length,
    },
  };
}

/**
 * Split bodyMd into up to `maxChunks` slices of `chunkSize` chars.
 *
 * Coverage guarantees:
 * - ≤ chunkSize: returns the whole body as a single chunk (preserves
 *   the pre-Sprint-1 single-call behavior for short pieces).
 * - ≤ maxChunks * chunkSize: contiguous slices covering the FULL body
 *   with no gaps. This is the common case for typical blog posts up to
 *   ~24,000 chars / ~4,500 words at the current constants.
 * - longer: SAMPLES maxChunks evenly-spaced windows. The head and tail
 *   are always pinned; the middle is sampled. Coverage gaps exist by
 *   design — the alternative is unbounded cost. Callers should treat
 *   the resulting score as representative rather than exhaustive.
 */
export function chunkBody(body: string, chunkSize: number, maxChunks: number): string[] {
  if (!body) return [""];
  if (body.length <= chunkSize) return [body];
  if (maxChunks <= 1) return [body.slice(0, chunkSize)];
  const naturalChunks = Math.ceil(body.length / chunkSize);
  if (naturalChunks <= maxChunks) {
    const out: string[] = [];
    for (let i = 0; i < naturalChunks; i++) {
      out.push(body.slice(i * chunkSize, (i + 1) * chunkSize));
    }
    return out;
  }
  // Sample maxChunks windows at evenly-spaced offsets. The first window
  // is the head; the last window pins to the end so we score the
  // conclusion. Middle windows are interpolated.
  const out: string[] = [];
  const span = body.length - chunkSize;
  for (let i = 0; i < maxChunks; i++) {
    const start = Math.floor((span * i) / (maxChunks - 1));
    out.push(body.slice(start, start + chunkSize));
  }
  return out;
}

/**
 * Test seam: tests inject a fetch implementation to simulate hangs,
 * 5xx, etc. without touching the network. Production uses the global
 * `fetch`.
 */
export interface ScoreVoiceDeps {
  fetchImpl?: typeof fetch;
  /** Per-attempt timeout (ms). Tests override to keep runs fast. */
  timeoutMs?: number;
  /** Backoff base (ms). Tests override to 0 to skip waits. */
  retryBaseMs?: number;
}

export async function scoreVoiceWithOpenAI(
  args: {
    voiceProfile: Record<string, unknown>;
    excerpt: string;
    brandName: string;
  },
  log: Logger,
  deps: ScoreVoiceDeps = {},
): Promise<{ score: number; reasoning?: string; flags?: string[] }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const retryBaseMs = deps.retryBaseMs ?? RETRY_BASE_MS;

  const system =
    "You are a brand voice auditor. Given a brand's voice_profile JSON " +
    "and a draft excerpt, return a JSON object: " +
    `{"score": <0..1 float>, "reasoning": "<one short sentence>", "flags": ["<violation tag>", ...]}. ` +
    "score=1 means the excerpt matches the voice profile perfectly; " +
    "score=0 means it ignores or contradicts it. Be strict but fair.";

  const user = JSON.stringify({
    brand: args.brandName,
    voice_profile: args.voiceProfile,
    excerpt: args.excerpt,
  });

  const body = JSON.stringify({
    model: MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  let timeoutCount = 0;
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${loadEnv().OPENAI_API_KEY || (() => { throw new Error("OPENAI_API_KEY is not set — brand-voice check cannot run"); })()}`,
        },
        body,
        signal: ac.signal,
      });

      // Retriable HTTP statuses: 408 timeout, 429 rate limit, 5xx server error.
      if (res.status === 408 || res.status === 429 || res.status >= 500) {
        const text = await res.text().catch(() => "");
        lastErr = new OpenAIRetriableError(
          `openai ${res.status}: ${text.slice(0, 200)}`,
          { httpStatus: res.status },
        );
        log.warn(
          { httpStatus: res.status, attempt: attempt + 1, maxRetries: MAX_RETRIES },
          "brand-voice: retriable openai error",
        );
        if (attempt < MAX_RETRIES - 1) {
          await sleep(jitter(retryBaseMs * 2 ** attempt));
        }
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        // 4xx other than 408/429: do not retry.
        throw new OpenAINonRetriableError(
          `openai ${res.status}: ${text.slice(0, 200)}`,
          { httpStatus: res.status },
        );
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json.choices?.[0]?.message?.content;
      if (!content) {
        throw new OpenAINonRetriableError("openai: empty response content");
      }
      const parsed = JSON.parse(content) as {
        score?: number;
        reasoning?: string;
        flags?: string[];
      };
      if (typeof parsed.score !== "number") {
        throw new OpenAINonRetriableError("openai: no score in response");
      }
      return parsed as { score: number; reasoning?: string; flags?: string[] };
    } catch (e) {
      const err = e as Error;
      // AbortError → per-attempt timeout. Always retriable.
      const looksLikeTimeout =
        err.name === "AbortError" ||
        /abort|timeout|timed out|ETIMEDOUT/i.test(err.message ?? "");
      if (looksLikeTimeout) {
        timeoutCount += 1;
        lastErr = err;
        log.warn(
          { attempt: attempt + 1, maxRetries: MAX_RETRIES },
          "brand-voice: openai call timed out",
        );
        // Skip backoff after the final attempt — we're about to throw.
        if (attempt < MAX_RETRIES - 1) {
          await sleep(jitter(retryBaseMs * 2 ** attempt));
        }
        continue;
      }
      if (err instanceof OpenAINonRetriableError) throw err;
      // Network-level failure: DNS, TLS reset, etc. → retriable.
      lastErr = err;
      log.warn(
        { err: err.message, attempt: attempt + 1, maxRetries: MAX_RETRIES },
        "brand-voice: openai network error",
      );
      if (attempt < MAX_RETRIES - 1) {
        await sleep(jitter(retryBaseMs * 2 ** attempt));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // Exhausted retries. If every attempt timed out, surface as a
  // dedicated TimeoutError so the qa_check_result + qa.check_errored
  // event clearly flag it. Otherwise it's a mixed retries-exhausted
  // failure (e.g. 5xx → 5xx → 429).
  if (timeoutCount === MAX_RETRIES) {
    throw new OpenAITimeoutError(MAX_RETRIES);
  }
  throw new OpenAIRetriesExhaustedError(MAX_RETRIES, lastErr?.message ?? "unknown");
}

// Exported for tests.
export const __test_only = {
  OpenAITimeoutError,
  OpenAIRetriesExhaustedError,
  OpenAIRetriableError,
  OpenAINonRetriableError,
  MAX_RETRIES,
  REQUEST_TIMEOUT_MS,
};
