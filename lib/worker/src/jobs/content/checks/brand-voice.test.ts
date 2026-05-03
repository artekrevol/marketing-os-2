/**
 * Unit tests for the brand-voice OpenAI client (Part 1.5).
 *
 * Targets `scoreVoiceWithOpenAI` directly so we don't have to stand up
 * a Postgres or load real env. Tests inject a fake `fetch` and shrink
 * `timeoutMs` / `retryBaseMs` so the suite is fast.
 */
import { describe, it, expect, beforeAll } from "vitest";
import pino from "pino";
import { scoreVoiceWithOpenAI, __test_only } from "./brand-voice";

const log = pino({ level: "silent" });

const ARGS = {
  voiceProfile: { tone: "friendly" },
  excerpt: "Hello world. ".repeat(40),
  brandName: "ClaimShield",
};

beforeAll(() => {
  // scoreVoiceWithOpenAI calls loadEnv() for the API key. Provide
  // every required env var so the singleton resolves cleanly.
  process.env.OPENAI_API_KEY ??= "test-key";
  process.env.DATABASE_URL ??= "postgres://test/test";
  process.env.REDIS_URL ??= "redis://test";
  process.env.DATAFORSEO_LOGIN ??= "test";
  process.env.DATAFORSEO_PASSWORD ??= "test";
  process.env.ORIGINALITY_AI_KEY ??= "test";
  process.env.SENTRY_DSN ??= "https://example@sentry.example/0";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test";
  process.env.NODE_ENV = "test";
});

/**
 * Build a fetch impl that never resolves until aborted, then rejects
 * with an AbortError — exactly what node's fetch does on signal abort.
 */
function makeHangingFetch(): typeof fetch {
  return ((_url: string, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      const sig = init?.signal;
      if (!sig) return; // hang forever — test harness will time out
      if (sig.aborted) {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
        return;
      }
      sig.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  }) as unknown as typeof fetch;
}

describe("scoreVoiceWithOpenAI: timeout + retry", () => {
  it("aborts each attempt at the configured timeout and surfaces OpenAITimeoutError after MAX_RETRIES", async () => {
    const start = Date.now();
    await expect(
      scoreVoiceWithOpenAI(ARGS, log, {
        fetchImpl: makeHangingFetch(),
        timeoutMs: 20,
        retryBaseMs: 0,
      }),
    ).rejects.toBeInstanceOf(__test_only.OpenAITimeoutError);
    const elapsed = Date.now() - start;
    // 3 attempts × 20ms timeout + ~0 backoff + jitter ≤ ~600ms with
    // generous slack for CI scheduler noise.
    expect(elapsed).toBeLessThan(2000);
  });

  it("OpenAITimeoutError carries attempts == MAX_RETRIES", async () => {
    try {
      await scoreVoiceWithOpenAI(ARGS, log, {
        fetchImpl: makeHangingFetch(),
        timeoutMs: 10,
        retryBaseMs: 0,
      });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(__test_only.OpenAITimeoutError);
      expect((e as { attempts: number }).attempts).toBe(__test_only.MAX_RETRIES);
    }
  });

  it("retries 5xx and eventually returns parsed score on success", async () => {
    let calls = 0;
    const fetchImpl = (async (_url: string, _init?: RequestInit) => {
      calls += 1;
      if (calls < 3) {
        return new Response("upstream error", { status: 503 });
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ score: 0.82, reasoning: "ok", flags: [] }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const out = await scoreVoiceWithOpenAI(ARGS, log, {
      fetchImpl,
      timeoutMs: 1000,
      retryBaseMs: 0,
    });
    expect(out.score).toBeCloseTo(0.82);
    expect(calls).toBe(3);
  });

  it("does NOT retry on 401 (non-retriable 4xx) — surfaces immediately", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("unauthorized", { status: 401 });
    }) as unknown as typeof fetch;

    await expect(
      scoreVoiceWithOpenAI(ARGS, log, {
        fetchImpl,
        timeoutMs: 1000,
        retryBaseMs: 0,
      }),
    ).rejects.toBeInstanceOf(__test_only.OpenAINonRetriableError);
    expect(calls).toBe(1);
  });

  it("retries 429 rate-limit responses and then surfaces RetriesExhaustedError if they keep coming", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("slow down", { status: 429 });
    }) as unknown as typeof fetch;

    await expect(
      scoreVoiceWithOpenAI(ARGS, log, {
        fetchImpl,
        timeoutMs: 1000,
        retryBaseMs: 0,
      }),
    ).rejects.toBeInstanceOf(__test_only.OpenAIRetriesExhaustedError);
    expect(calls).toBe(__test_only.MAX_RETRIES);
  });
});
