/**
 * Phase 5 Smoke Tests 9–24: Pure-logic coverage for the Discovery Engine.
 *
 * Tests  9–12: Labs endpoint Zod schemas (structural validation)
 * Tests 13–15: isoWeekLabel() — ISO 8601 week formatting
 * Tests 16–20: kdPassesThroughFilter() — KD filter predicate
 * Tests 21–22: computeDropRatePct() — drop-rate formula
 * Tests 23–24: resolveKdThreshold() — env-var override logic
 *
 * No DB, no HTTP — pure unit coverage.
 */
import { describe, it, expect } from "vitest";
import {
  RelatedKeywordsResponseSchema,
  CompetitorsForDomainResponseSchema,
  BulkKeywordDifficultyResponseSchema,
} from "@workspace/integrations-dataforseo";
import {
  isoWeekLabel,
  kdPassesThroughFilter,
  computeDropRatePct,
  resolveKdThreshold,
  DISCOVERY_KEYWORD_INSERT_OPTIONS,
} from "./discovery-weekly";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: minimal valid DataForSEO response envelopes
// ─────────────────────────────────────────────────────────────────────────────
function dfsEnvelope(result: unknown[] = []) {
  return {
    version: "0.1.20221214",
    status_code: 20000,
    status_message: "Ok.",
    time: "0.1234 sec.",
    cost: 0.001,
    tasks_count: 1,
    tasks_error: 0,
    tasks: [
      {
        id: "task-001",
        status_code: 20000,
        status_message: "Ok.",
        time: "0.1 sec.",
        cost: 0.001,
        result_count: result.length,
        path: [],
        data: {},
        result,
      },
    ],
  };
}

describe("Discovery candidate persistence", () => {
  it("keeps overlapping related and competitor candidates conflict-tolerant", () => {
    const related = new Set(["shared keyword", "related only"]);
    const competitor = new Set(["shared keyword", "competitor only"]);
    expect([...related].filter((keyword) => competitor.has(keyword))).toEqual([
      "shared keyword",
    ]);
    expect(DISCOVERY_KEYWORD_INSERT_OPTIONS).toEqual({
      onConflict: "doNothing",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 9-12: Labs Zod schema structural validation
// ─────────────────────────────────────────────────────────────────────────────

describe("Smoke 9-12 — Labs Zod schemas validate correct response shapes", () => {
  it("Test 9: RelatedKeywordsResponseSchema accepts a minimal valid envelope", () => {
    const payload = dfsEnvelope([
      {
        seed_keyword: "mobile app development",
        location_code: 2840,
        language_code: "en",
        total_count: 1,
        items_count: 1,
        items: [
          {
            keyword_data: {
              keyword: "custom mobile app development",
              keyword_info: { search_volume: 2400, cpc: 12.5, competition: 0.8, keyword_difficulty: 45 },
            },
            depth: 1,
            related_keywords: [],
          },
        ],
      },
    ]);
    const result = RelatedKeywordsResponseSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("Test 10: RelatedKeywordsResponseSchema rejects missing status_code at envelope level", () => {
    const bad = { tasks: [{ result: [] }] }; // missing required status_code
    const result = RelatedKeywordsResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((e) => e.path.join("."));
      expect(paths.some((p) => p.includes("status_code"))).toBe(true);
    }
  });

  it("Test 11: CompetitorsForDomainResponseSchema accepts a minimal valid envelope", () => {
    const payload = dfsEnvelope([
      {
        se_type: "google",
        target: "buildfire.com",
        location_code: 2840,
        language_code: "en",
        total_count: 1,
        items_count: 1,
        items: [
          {
            domain: "appinventiv.com",
            avg_position: 8.5,
            sum_position: 850,
            intersections: 100,
            full_domain_metrics: null,
          },
        ],
      },
    ]);
    const result = CompetitorsForDomainResponseSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("Test 12: BulkKeywordDifficultyResponseSchema accepts a minimal valid envelope", () => {
    const payload = dfsEnvelope([
      {
        location_code: 2840,
        language_code: "en",
        total_count: 2,
        items_count: 2,
        items: [
          { keyword: "mobile app development", keyword_difficulty: 55 },
          { keyword: "app development company", keyword_difficulty: 68 },
        ],
      },
    ]);
    const result = BulkKeywordDifficultyResponseSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 13-15: isoWeekLabel()
// ─────────────────────────────────────────────────────────────────────────────

describe("Smoke 13-15 — isoWeekLabel() ISO 8601 week formatting", () => {
  it("Test 13: output format is YYYY-WW (two-digit week)", () => {
    const label = isoWeekLabel(new Date("2026-08-07T00:00:00Z"));
    expect(label).toMatch(/^\d{4}-\d{2}$/);
  });

  it("Test 14: Aug 7, 2026 is in week 32 of 2026", () => {
    // ISO week 32 of 2026 spans Aug 3–9, 2026
    expect(isoWeekLabel(new Date("2026-08-07T00:00:00Z"))).toBe("2026-32");
  });

  it("Test 15: Dec 30, 2019 belongs to ISO week 2020-01 (year-boundary rollover)", () => {
    // Dec 30, 2019 is a Monday; that week's Thursday is Jan 2, 2020 → week 1 of 2020
    expect(isoWeekLabel(new Date("2019-12-30T00:00:00Z"))).toBe("2020-01");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 16-20: kdPassesThroughFilter()
// ─────────────────────────────────────────────────────────────────────────────

describe("Smoke 16-20 — kdPassesThroughFilter() predicate", () => {
  const THRESHOLD = 70;

  it("Test 16: null KD passes through (unknown difficulty — reviewer decides)", () => {
    expect(kdPassesThroughFilter(null, THRESHOLD)).toBe(true);
  });

  it("Test 17: undefined KD passes through (keyword not in KD map)", () => {
    expect(kdPassesThroughFilter(undefined, THRESHOLD)).toBe(true);
  });

  it("Test 18: KD strictly below threshold passes", () => {
    expect(kdPassesThroughFilter(69, THRESHOLD)).toBe(true);
    expect(kdPassesThroughFilter(0, THRESHOLD)).toBe(true);
  });

  it("Test 19: KD exactly at threshold drops (exclusive upper bound)", () => {
    expect(kdPassesThroughFilter(70, THRESHOLD)).toBe(false);
  });

  it("Test 20: KD above threshold drops", () => {
    expect(kdPassesThroughFilter(71, THRESHOLD)).toBe(false);
    expect(kdPassesThroughFilter(100, THRESHOLD)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 21-22: computeDropRatePct()
// ─────────────────────────────────────────────────────────────────────────────

describe("Smoke 21-22 — computeDropRatePct() formula", () => {
  it("Test 21: 100 before, 50 after → 50% drop rate", () => {
    expect(computeDropRatePct(100, 50)).toBe(50);
  });

  it("Test 22: 0 before → 0% (no divide-by-zero)", () => {
    expect(computeDropRatePct(0, 0)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 23-24: resolveKdThreshold()
// ─────────────────────────────────────────────────────────────────────────────

describe("Smoke 23-24 — resolveKdThreshold() env-var override", () => {
  it("Test 23: valid integer env var overrides payload", () => {
    expect(resolveKdThreshold("60", 70)).toBe(60);
  });

  it("Test 24: non-integer env var falls back to payload", () => {
    expect(resolveKdThreshold("abc", 70)).toBe(70);
    expect(resolveKdThreshold("", 70)).toBe(70);
    expect(resolveKdThreshold("70.5", 70)).toBe(70); // decimal rejected
  });
});
