/**
 * Unit tests for the brand-voice OpenAI client (Part 1.5).
 *
 * Targets `scoreVoiceWithOpenAI` directly so we don't have to stand up
 * a Postgres or load real env. Tests inject a fake `fetch` and shrink
 * `timeoutMs` / `retryBaseMs` so the suite is fast.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import pino from "pino";
import { scoreVoiceWithOpenAI, __test_only } from "./brand-voice";

// Mock the DB module so runBrandVoiceCheck doesn't try to connect to
// Postgres. withBrandScope is the only export this check uses.
vi.mock("@workspace/db", () => {
  const fakeBrand = {
    id: "brand-1",
    name: "ClaimShield",
    voiceProfile: { tone: "friendly" },
  };
  return {
    withBrandScope: async (
      _brandId: string,
      fn: (ctx: {
        db: {
          select: () => {
            from: () => {
              where: () => { limit: () => Promise<Array<typeof fakeBrand>> };
            };
          };
        };
      }) => unknown,
    ) =>
      fn({
        db: {
          select: () => ({
            from: () => ({ where: () => ({ limit: async () => [fakeBrand] }) }),
          }),
        },
      }),
    brandsTable: { id: "id" },
  };
});

// Mock loadEnv so the OpenAI key check inside scoreVoiceWithOpenAI
// doesn't blow up; we never actually hit the network.
vi.mock("../../../env", () => ({
  loadEnv: () => ({ OPENAI_API_KEY: "test-key" }),
}));

// Mock Sentry so captureException is a noop in tests.
vi.mock("../../../sentry", () => ({
  Sentry: {
    withScope: (fn: (scope: {
      setTags: () => void;
      setContext: () => void;
    }) => void) => fn({ setTags: () => {}, setContext: () => {} }),
    captureException: () => {},
  },
}));

// Imported AFTER the mocks so it picks them up.
const { runBrandVoiceCheck } = await import("./brand-voice");

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

/**
 * Integration-shape test: drive runBrandVoiceCheck end-to-end (with DB
 * + env mocked at module scope above) and assert the CheckRunResult
 * shape that qa-run-checks consumes.
 *
 * runBrandVoiceCheck does not accept a fetch seam, so this exercises
 * the timeout path indirectly: we install a hanging fetch on
 * globalThis for the duration of the test. The check's per-attempt
 * timeout is 30s in production — too long for a unit test — so we
 * also stub setTimeout to fire immediately, making the AbortController
 * abort on the next microtask.
 */
describe("runBrandVoiceCheck: terminal mapping for timeouts", () => {
  it("maps an OpenAI timeout to outcome='error' with details.attempts=MAX_RETRIES and errorClass='OpenAITimeoutError'", async () => {
    const realFetch = globalThis.fetch;
    const realSetTimeout = globalThis.setTimeout;
    // Hang until aborted.
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const sig = init?.signal;
        if (!sig) return;
        if (sig.aborted) {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
          return;
        }
        sig.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      })) as unknown as typeof fetch;
    // Make every setTimeout fire on next tick so the 30s per-attempt
    // timer + 500ms backoff don't actually slow the test down.
    globalThis.setTimeout = ((cb: () => void) =>
      realSetTimeout(cb, 0)) as unknown as typeof setTimeout;

    try {
      const bodyMd = "Hello world. ".repeat(40);
      const result = await runBrandVoiceCheck(
        {
          brandId: "brand-1",
          contentObjectId: "co-1",
          bodyMd,
          wordCount: (bodyMd.match(/\b[\w'-]+\b/g) ?? []).length,
          threshold: 0.7,
          config: {},
        },
        log,
      );
      expect(result.outcome).toBe("error");
      expect(result.score).toBeNull();
      expect(result.summary).toMatch(/timed out/i);
      const details = result.details as Record<string, unknown>;
      expect(details.error).toBe("timeout");
      expect(details.attempts).toBe(__test_only.MAX_RETRIES);
      expect(details.errorClass).toBe("OpenAITimeoutError");
    } finally {
      globalThis.fetch = realFetch;
      globalThis.setTimeout = realSetTimeout;
    }
  });
});
