/**
 * Regression test for the BullMQ custom-jobId constraint.
 *
 * BullMQ (>=5) rejects a custom id containing `:` unless it splits into
 * exactly three parts. `enqueue()` prefixes every id with `${name}:`,
 * so each job's `idempotencyKey` must contain exactly one colon. A
 * `:${Date.now()}` suffix (two colons in the key) used to throw
 * "Custom Id cannot contain :" for the SEO competitor routes; this test
 * guards the rule via `buildJobId`.
 */
import { describe, it, expect } from "vitest";
import { buildJobId } from "@workspace/jobs";

const BRAND_ID = "2d10bb54-ba9a-4444-8a18-a262bca9b2bc";
const TS = 1782177522145;

describe("buildJobId — BullMQ custom-id constraint", () => {
  it("accepts the SEO idempotencyKey shapes (exactly one colon)", () => {
    const cases: Array<[string, string]> = [
      ["seo.crawl.run", `seo-crawl:${BRAND_ID}`],
      ["seo.competitor.discover", `seo-competitor-discover:${BRAND_ID}-${TS}`],
      [
        "seo.competitor-insights.compute",
        `seo-competitor-insights:${BRAND_ID}-${TS}`,
      ],
    ];
    for (const [name, key] of cases) {
      const jobId = buildJobId(name, key);
      expect(jobId.split(":").length).toBe(3);
    }
  });

  it("rejects a key with an extra colon (the original bug)", () => {
    expect(() =>
      buildJobId(
        "seo.competitor.discover",
        `seo-competitor-discover:${BRAND_ID}:${TS}`,
      ),
    ).toThrow(/exactly one ":"/);
  });

  it("rejects a colon-free key (yields a 2-part id BullMQ also refuses)", () => {
    expect(() => buildJobId("maintenance.cleanup", "no-colons-here")).toThrow(
      /exactly one ":"/,
    );
  });
});
