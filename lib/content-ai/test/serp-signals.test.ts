import { describe, it, expect } from "vitest";
import { computeSerpSignals, computeLsiCoverage } from "../src/serp-signals.js";

describe("computeSerpSignals (3.1)", () => {
  it("sets requires_cost_table from a cost keyword", () => {
    const s = computeSerpSignals({ primaryKeyword: "mobile app development cost" });
    expect(s.requires_cost_table).toBe(true);
  });

  it("sets requires_cost_table from >=3 pricing results", () => {
    const s = computeSerpSignals({
      primaryKeyword: "build a mobile app",
      topResults: [{ hasPricing: true }, { hasPricing: true }, { hasPricing: true }],
    });
    expect(s.requires_cost_table).toBe(true);
  });

  it("detects timeline and team-model signals in cost clusters", () => {
    const s = computeSerpSignals({
      primaryKeyword: "app development cost",
      topResults: [
        { headings: ["How long does it take", "Phases"] },
        { description: "Compare in-house vs agency vs freelancer rates" },
      ],
    });
    expect(s.requires_timeline_table).toBe(true);
    expect(s.requires_team_model_comparison).toBe(true);
  });

  it("requires competitor teardown with >=2 named competitors", () => {
    expect(computeSerpSignals({ primaryKeyword: "x", competitorNames: ["A", "B"] }).requires_competitor_teardown).toBe(true);
    expect(computeSerpSignals({ primaryKeyword: "x", competitorNames: ["A"] }).requires_competitor_teardown).toBe(false);
  });

  it("requires local context when keyword names a city", () => {
    expect(computeSerpSignals({ primaryKeyword: "app developers in Austin" }).requires_local_context).toBe(true);
    expect(computeSerpSignals({ primaryKeyword: "app developers" }).requires_local_context).toBe(false);
  });
});

describe("computeLsiCoverage (3.2)", () => {
  it("computes the used subset and ratio", () => {
    const r = computeLsiCoverage(["react native", "swift", "kotlin", "flutter"], "We use React Native and Swift here.");
    expect(r.usedCount).toBe(2);
    expect(r.retrievedCount).toBe(4);
    expect(r.ratio).toBe(0.5);
  });

  it("returns ratio 0 when nothing retrieved", () => {
    expect(computeLsiCoverage([], "anything").ratio).toBe(0);
  });
});
