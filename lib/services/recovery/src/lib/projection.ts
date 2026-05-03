/**
 * Burn-down projection — pure function. Linear regression on
 * `gap_to_baseline_top10_pct` versus elapsed days. Per amendments §D.4
 * the rankings-based gap is what we project on this sprint; the
 * clicks-based gap remains in the schema for the future GSC pipeline
 * but is not used here.
 *
 * Sign convention from the schema:
 *   gap = (current_top10 - baseline_top10) / baseline_top10 * 100
 *
 * - Below baseline → gap is negative.
 * - Recovered      → gap is at or above zero.
 *
 * "Recovery" therefore means the gap closes upward toward zero. Slope
 * must be POSITIVE for the gap to be closing; flat or negative slope
 * means the brand is stuck or sliding further away.
 */

/** Minimum number of points needed for a meaningful regression. */
export const MIN_POINTS_FOR_PROJECTION = 7;

/** Discriminated union returned by `computeProjection`. */
export type ProjectionResult =
  | {
      status: "projecting";
      slope: number;
      intercept: number;
      latestGapPct: number;
      projectedRecoveryDate: Date;
      pointsUsed: number;
    }
  | {
      status: "recovered";
      slope: number;
      intercept: number;
      latestGapPct: number;
      pointsUsed: number;
    }
  | {
      status: "gap_widening";
      slope: number;
      intercept: number;
      latestGapPct: number;
      pointsUsed: number;
    }
  | {
      status: "no_data";
      reason: "insufficient_points" | "all_null" | "no_variance";
      pointsUsed: number;
    };

export interface ProjectionInputPoint {
  /** Snapshot date. */
  snapshotDate: Date;
  /** `gap_to_baseline_top10_pct` value at that date. NULL allowed. */
  gapToBaselineTop10Pct: number | null;
}

/**
 * Compute a burn-down projection from the most-recent snapshots.
 *
 * Inputs need not be sorted — the function sorts ascending by date and
 * uses the last `windowSize` (default 30) points with non-null gap.
 * Days are measured as floating-point days since the earliest used
 * point so the projection is robust to gaps in the snapshot stream.
 *
 * Pure: no I/O, no clock reads beyond what's passed in.
 */
export function computeProjection(
  points: ReadonlyArray<ProjectionInputPoint>,
  windowSize = 30,
): ProjectionResult {
  // Drop NULLs and sort ascending so "last N" actually means most recent.
  const usable = points
    .filter(
      (p): p is { snapshotDate: Date; gapToBaselineTop10Pct: number } =>
        p.gapToBaselineTop10Pct != null && Number.isFinite(p.gapToBaselineTop10Pct),
    )
    .map((p) => ({
      ts: p.snapshotDate.getTime(),
      gap: p.gapToBaselineTop10Pct,
    }))
    .sort((a, b) => a.ts - b.ts);

  if (usable.length === 0) {
    return { status: "no_data", reason: "all_null", pointsUsed: 0 };
  }

  const window = usable.slice(-windowSize);
  if (window.length < MIN_POINTS_FOR_PROJECTION) {
    return {
      status: "no_data",
      reason: "insufficient_points",
      pointsUsed: window.length,
    };
  }

  // Convert timestamps to days-since-first-point. Using the window's
  // first point as the origin keeps the numeric range tight regardless
  // of how far back the snapshot history goes.
  const t0 = window[0]!.ts;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const xs = window.map((p) => (p.ts - t0) / MS_PER_DAY);
  const ys = window.map((p) => p.gap);
  const n = window.length;

  // If every x is identical (multiple snapshots stamped the same date),
  // regression is undefined; treat as no usable variance.
  const xMin = xs[0]!;
  const xMax = xs[xs.length - 1]!;
  if (xMax - xMin < 1e-9) {
    return { status: "no_data", reason: "no_variance", pointsUsed: n };
  }

  // Ordinary least-squares slope + intercept.
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]!;
    sy += ys[i]!;
  }
  const meanX = sx / n;
  const meanY = sy / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    num += dx * (ys[i]! - meanY);
    den += dx * dx;
  }
  if (den < 1e-12) {
    return { status: "no_data", reason: "no_variance", pointsUsed: n };
  }
  const slope = num / den; // gap-percent per day
  const intercept = meanY - slope * meanX;

  const latestPoint = window[window.length - 1]!;
  const latestGapPct = latestPoint.gap;

  // Already at or above baseline — recovery is in hand regardless of
  // slope. The UI will render this as the green/recovered state.
  if (latestGapPct >= 0) {
    return {
      status: "recovered",
      slope,
      intercept,
      latestGapPct,
      pointsUsed: n,
    };
  }

  // Gap is below zero. To close, slope must be strictly positive.
  // Treat exact-zero slopes as widening for the user-facing message —
  // a flat curve never reaches zero either.
  if (slope <= 0) {
    return {
      status: "gap_widening",
      slope,
      intercept,
      latestGapPct,
      pointsUsed: n,
    };
  }

  // Project forward from the latest point's x. We solve
  //   intercept + slope * xRecover = 0
  // → xRecover = -intercept / slope.
  const xRecover = -intercept / slope;
  const xLatest = xs[xs.length - 1]!;
  const daysToRecovery = xRecover - xLatest;

  // Defensive: if floating-point rounding pushes the projection
  // backwards in time, the regression is too noisy to trust. Surface
  // as widening rather than emit a date in the past.
  if (!Number.isFinite(daysToRecovery) || daysToRecovery <= 0) {
    return {
      status: "gap_widening",
      slope,
      intercept,
      latestGapPct,
      pointsUsed: n,
    };
  }

  const projectedRecoveryDate = new Date(
    latestPoint.ts + daysToRecovery * MS_PER_DAY,
  );

  return {
    status: "projecting",
    slope,
    intercept,
    latestGapPct,
    projectedRecoveryDate,
    pointsUsed: n,
  };
}
