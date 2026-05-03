import { and, desc, eq, sql } from "drizzle-orm";
import {
  withBrandScope,
  recoveryBaselinesTable,
  recoverySnapshotsTable,
  recoveryInitiativesTable,
  type RecoveryBaseline,
  type RecoverySnapshot,
} from "@workspace/db";
import { computeProjection, type ProjectionResult } from "../lib/projection";

export interface RecoveryOverview {
  baseline: RecoveryBaseline | null;
  current: RecoverySnapshot | null;
  /** Latest `gap_to_baseline_top10_pct` value (rankings-based, %). */
  gapPct: number | null;
  /** Count of initiatives in `active` status. */
  activeInitiatives: number;
  /** Burn-down projection over the last 30 snapshots. */
  projection: ProjectionResult;
}

/**
 * Single-call dashboard payload for `/recovery`. Returns the locked
 * baseline (if any), the most-recent snapshot, the latest rankings-based
 * gap, the active-initiatives count, and the burn-down projection.
 *
 * `gapPct` is the value the gauge renders. Per amendments §D.5 we use
 * `gap_to_baseline_top10_pct` until GSC ingestion lands.
 */
export async function getRecoveryOverview(
  brandId: string,
): Promise<RecoveryOverview> {
  return withBrandScope(brandId, async ({ scoped }) => {
    const baselineRows = (await scoped.select(recoveryBaselinesTable, {
      where: eq(recoveryBaselinesTable.brandId, brandId),
      limit: 1,
    })) as RecoveryBaseline[];
    const baseline = baselineRows[0] ?? null;

    const snapshotRows = (await scoped.select(recoverySnapshotsTable, {
      where: eq(recoverySnapshotsTable.brandId, brandId),
      orderBy: desc(recoverySnapshotsTable.snapshotDate),
      limit: 30,
    })) as RecoverySnapshot[];

    const current = snapshotRows[0] ?? null;
    const gapPct =
      current?.gapToBaselineTop10Pct != null
        ? Number(current.gapToBaselineTop10Pct)
        : null;

    const activeCountRows = (await scoped.select(recoveryInitiativesTable, {
      where: and(
        eq(recoveryInitiativesTable.brandId, brandId),
        eq(recoveryInitiativesTable.status, "active"),
      )!,
    })) as Array<{ id: string }>;
    const activeInitiatives = activeCountRows.length;
    // `sql` import retained for future projections / aggregate queries
    // that the UI prompt may add without re-touching the import block.
    void sql;

    const projection = computeProjection(
      snapshotRows.map((r) => ({
        snapshotDate: new Date(r.snapshotDate),
        gapToBaselineTop10Pct:
          r.gapToBaselineTop10Pct != null
            ? Number(r.gapToBaselineTop10Pct)
            : null,
      })),
      30,
    );

    return { baseline, current, gapPct, activeInitiatives, projection };
  });
}
