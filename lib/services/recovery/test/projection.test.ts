import { describe, expect, it } from "vitest";
import {
  computeProjection,
  MIN_POINTS_FOR_PROJECTION,
} from "../src/lib/projection";

const DAY = 24 * 60 * 60 * 1000;

/** Build a series of points, one per day, starting at `start`. */
function series(
  start: Date,
  values: ReadonlyArray<number | null>,
): { snapshotDate: Date; gapToBaselineTop10Pct: number | null }[] {
  return values.map((v, i) => ({
    snapshotDate: new Date(start.getTime() + i * DAY),
    gapToBaselineTop10Pct: v,
  }));
}

const T0 = new Date("2025-10-01T00:00:00Z");

describe("computeProjection", () => {
  it("closing fast: steep positive slope projects a near-term recovery date", () => {
    // gap goes from -60 to -10 over 30 days → +50 pp / 30 d.
    // To reach 0 from -10 needs ~6 more days.
    const pts = series(
      T0,
      Array.from({ length: 30 }, (_, i) => -60 + i * (50 / 29)),
    );
    const r = computeProjection(pts);
    expect(r.status).toBe("projecting");
    if (r.status !== "projecting") return;
    expect(r.slope).toBeGreaterThan(0);
    expect(r.latestGapPct).toBeLessThan(0);
    const last = pts[pts.length - 1]!.snapshotDate.getTime();
    const days = (r.projectedRecoveryDate.getTime() - last) / DAY;
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThan(15);
  });

  it("closing slow: small positive slope projects a far-future date", () => {
    // gap moves from -50 to -45 over 30 days → +5 pp / 30 d.
    // Needs ~270 more days from -45 to reach 0.
    const pts = series(
      T0,
      Array.from({ length: 30 }, (_, i) => -50 + i * (5 / 29)),
    );
    const r = computeProjection(pts);
    expect(r.status).toBe("projecting");
    if (r.status !== "projecting") return;
    expect(r.slope).toBeGreaterThan(0);
    const last = pts[pts.length - 1]!.snapshotDate.getTime();
    const days = (r.projectedRecoveryDate.getTime() - last) / DAY;
    expect(days).toBeGreaterThan(120);
  });

  it("flat: zero slope below baseline returns gap_widening", () => {
    const pts = series(T0, Array.from({ length: 30 }, () => -25));
    const r = computeProjection(pts);
    expect(r.status).toBe("gap_widening");
    if (r.status !== "gap_widening") return;
    expect(Math.abs(r.slope)).toBeLessThan(1e-9);
    expect(r.latestGapPct).toBe(-25);
  });

  it("widening: negative slope returns gap_widening", () => {
    // -20 → -50 over 30 days
    const pts = series(
      T0,
      Array.from({ length: 30 }, (_, i) => -20 - i * (30 / 29)),
    );
    const r = computeProjection(pts);
    expect(r.status).toBe("gap_widening");
    if (r.status !== "gap_widening") return;
    expect(r.slope).toBeLessThan(0);
  });

  it("insufficient data: fewer than the minimum points returns no_data", () => {
    const pts = series(
      T0,
      Array.from({ length: MIN_POINTS_FOR_PROJECTION - 1 }, (_, i) => -30 + i),
    );
    const r = computeProjection(pts);
    expect(r.status).toBe("no_data");
    if (r.status !== "no_data") return;
    expect(r.reason).toBe("insufficient_points");
    expect(r.pointsUsed).toBe(MIN_POINTS_FOR_PROJECTION - 1);
  });

  it("all-null gap values returns no_data with reason all_null", () => {
    const pts = series(T0, Array.from({ length: 20 }, () => null));
    const r = computeProjection(pts);
    expect(r.status).toBe("no_data");
    if (r.status !== "no_data") return;
    expect(r.reason).toBe("all_null");
  });

  it("recovered: latest gap >= 0 short-circuits to recovered regardless of slope", () => {
    // climbs steadily and ends slightly above zero
    const pts = series(
      T0,
      Array.from({ length: 30 }, (_, i) => -29 + i),
    );
    const r = computeProjection(pts);
    expect(r.status).toBe("recovered");
    if (r.status !== "recovered") return;
    expect(r.latestGapPct).toBeGreaterThanOrEqual(0);
  });

  it("ignores NULL points in the middle of the series", () => {
    const values: (number | null)[] = Array.from(
      { length: 30 },
      (_, i) => -40 + i * (35 / 29),
    );
    values[5] = null;
    values[12] = null;
    values[20] = null;
    const r = computeProjection(series(T0, values));
    expect(r.status).toBe("projecting");
    if (r.status !== "projecting") return;
    expect(r.pointsUsed).toBe(27);
  });

  it("uses only the last `windowSize` non-null points", () => {
    // 60 days of widening, then 10 days closing fast. Window = 30 should
    // capture only the closing tail and project recovery; without windowing
    // the regression would be dominated by the widening prefix.
    const widening = Array.from({ length: 50 }, (_, i) => -10 - i);
    const closing = Array.from({ length: 20 }, (_, i) => -60 + i * 3);
    const pts = series(T0, [...widening, ...closing]);
    const r = computeProjection(pts, 20);
    expect(r.status).toBe("projecting");
    if (r.status !== "projecting") return;
    expect(r.slope).toBeGreaterThan(0);
    expect(r.pointsUsed).toBe(20);
  });

  it("unsorted input is sorted ascending before regression", () => {
    const ordered = series(
      T0,
      Array.from({ length: 30 }, (_, i) => -50 + i),
    );
    const shuffled = [...ordered].reverse();
    const a = computeProjection(ordered);
    const b = computeProjection(shuffled);
    expect(a.status).toBe(b.status);
    if (a.status === "projecting" && b.status === "projecting") {
      expect(b.slope).toBeCloseTo(a.slope, 6);
      expect(
        Math.abs(
          a.projectedRecoveryDate.getTime() - b.projectedRecoveryDate.getTime(),
        ),
      ).toBeLessThan(1000);
    }
  });
});
