/**
 * Phase 5 Smoke Tests 1–8: Schema coverage for DataForSEO Labs Discovery Engine.
 *
 * Tests 1–3:  New discovery columns on `keywords` table
 * Tests 4–5:  `competitor_movements` table shape
 * Test  6:    `dataforseo_labs_usage` table shape
 * Tests 7–8:  `competitor_insights` curation columns
 *
 * Strategy: compile-time sentinel types + drizzle-zod runtime checks.
 * No live DB connection required.
 */
import { describe, it, expect } from "vitest";
import { createInsertSchema } from "drizzle-zod";
import {
  keywordsTable,
  competitorMovementsTable,
  dataforSEOLabsUsageTable,
  competitorInsightsTable,
} from "../src/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Compile-time sentinel helpers (same pattern as schema-smoke.test.ts)
// ─────────────────────────────────────────────────────────────────────────────
type RequiredKeys<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? never : K }[keyof T];
type AssertRequiredField<
  _Table extends { $inferInsert: object },
  K extends RequiredKeys<_Table["$inferInsert"]>,
> = K;
type OptionalCheck<T extends object, K extends keyof T> =
  {} extends Pick<T, K> ? true : false;

// ── Tests 1-3 compile-time assertions: discovery columns exist on keywords ──
type _KeywordIsDiscoveryCandidateKey = keyof typeof keywordsTable.$inferInsert;
// isDiscoveryCandidate has a default (false), so it is optional in $inferInsert:
type _KwDiscoveryCandidateOptional = OptionalCheck<
  typeof keywordsTable.$inferInsert,
  "isDiscoveryCandidate"
>;
// candidateReviewStatus is nullable → optional in $inferInsert:
type _KwCandidateReviewStatusOptional = OptionalCheck<
  typeof keywordsTable.$inferInsert,
  "candidateReviewStatus"
>;
// candidateReviewedBy is nullable → optional:
type _KwCandidateReviewedByOptional = OptionalCheck<
  typeof keywordsTable.$inferInsert,
  "candidateReviewedBy"
>;

// ── Tests 4-5 compile-time: competitor_movements required fields ─────────────
type _MovementBrandIdRequired = AssertRequiredField<
  typeof competitorMovementsTable,
  "brandId"
>;
type _MovementDomainRequired = AssertRequiredField<
  typeof competitorMovementsTable,
  "competitorDomain"
>;

// ── Test 6 compile-time: dataforseo_labs_usage required fields ───────────────
type _LabsUsageBrandIdRequired = AssertRequiredField<
  typeof dataforSEOLabsUsageTable,
  "brandId"
>;

// ─────────────────────────────────────────────────────────────────────────────
// Valid UUIDs for Zod tests
// ─────────────────────────────────────────────────────────────────────────────
const BRAND_UUID    = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const LOCATION_UUID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";

// ─────────────────────────────────────────────────────────────────────────────
// Runtime Zod smoke tests (Tests 1–8)
// ─────────────────────────────────────────────────────────────────────────────

describe("Smoke 1-3 — keywords discovery columns present and correctly typed", () => {
  const schema = createInsertSchema(keywordsTable);

  it("Test 1: isDiscoveryCandidate is optional (has DB default false)", () => {
    // Should parse fine without it — DB default covers it
    const result = schema.safeParse({
      brandId: BRAND_UUID,
      keywordText: "mobile app development",
      locationId: LOCATION_UUID,
    });
    expect(result.success).toBe(true);
  });

  it("Test 2: candidateReviewStatus is optional/nullable (non-candidate keywords omit it)", () => {
    const withStatus = schema.safeParse({
      brandId: BRAND_UUID,
      keywordText: "mobile app development",
      locationId: LOCATION_UUID,
      candidateReviewStatus: "pending",
    });
    expect(withStatus.success).toBe(true);

    const withoutStatus = schema.safeParse({
      brandId: BRAND_UUID,
      keywordText: "mobile app development",
      locationId: LOCATION_UUID,
    });
    expect(withoutStatus.success).toBe(true);
  });

  it("Test 3: candidateReviewedBy is optional/nullable (NULL until reviewed)", () => {
    const withReviewer = schema.safeParse({
      brandId: BRAND_UUID,
      keywordText: "mobile app development",
      locationId: LOCATION_UUID,
      candidateReviewedBy: "user_clerk_abc123",
    });
    expect(withReviewer.success).toBe(true);

    const nullReviewer = schema.safeParse({
      brandId: BRAND_UUID,
      keywordText: "mobile app development",
      locationId: LOCATION_UUID,
      candidateReviewedBy: null,
    });
    expect(nullReviewer.success).toBe(true);
  });
});

describe("Smoke 4-5 — competitor_movements table shape", () => {
  const schema = createInsertSchema(competitorMovementsTable);

  it("Test 4: brandId is required", () => {
    const result = schema.safeParse({
      competitorDomain: "appinventiv.com",
      snapshotWeek: "2026-30",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((e) => e.path.join("."))).toContain("brandId");
    }
  });

  it("Test 5: competitorDomain is required", () => {
    const result = schema.safeParse({
      brandId: BRAND_UUID,
      snapshotWeek: "2026-30",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((e) => e.path.join("."))).toContain("competitorDomain");
    }
  });
});

describe("Smoke 6 — dataforseo_labs_usage table shape", () => {
  const schema = createInsertSchema(dataforSEOLabsUsageTable);

  // Required non-defaulted fields: brandId, endpoint, paramsHash, responseStatus
  const minimalValidRow = {
    brandId: BRAND_UUID,
    endpoint: "/dataforseo_labs/google/related_keywords/live",
    paramsHash: "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
    responseStatus: "ok",
  };

  it("Test 6: brandId is required (Labs usage is always brand-attributed)", () => {
    // Without brandId → must fail on brandId
    const withoutBrand = schema.safeParse({
      endpoint: "/dataforseo_labs/google/related_keywords/live",
      paramsHash: "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
      responseStatus: "ok",
    });
    expect(withoutBrand.success).toBe(false);
    if (!withoutBrand.success) {
      expect(withoutBrand.error.issues.map((e) => e.path.join("."))).toContain("brandId");
    }

    // With all required fields → must succeed
    const withBrand = schema.safeParse(minimalValidRow);
    expect(withBrand.success).toBe(true);
  });
});

describe("Smoke 7-8 — competitor_insights curation columns present and nullable", () => {
  const schema = createInsertSchema(competitorInsightsTable);

  it("Test 7: exclusionReason is nullable/optional", () => {
    const withNull = schema.safeParse({
      brandId: BRAND_UUID,
      competitorDomain: "appinventiv.com",
      exclusionReason: null,
    });
    expect(withNull.success).toBe(true);

    const withValue = schema.safeParse({
      brandId: BRAND_UUID,
      competitorDomain: "appinventiv.com",
      exclusionReason: "Directory site - not service provider",
    });
    expect(withValue.success).toBe(true);
  });

  it("Test 8: lastReviewedAt is nullable/optional", () => {
    const withNull = schema.safeParse({
      brandId: BRAND_UUID,
      competitorDomain: "appinventiv.com",
      lastReviewedAt: null,
    });
    expect(withNull.success).toBe(true);

    // Without it — should also succeed (not a required field)
    const without = schema.safeParse({
      brandId: BRAND_UUID,
      competitorDomain: "appinventiv.com",
    });
    expect(without.success).toBe(true);
  });
});
