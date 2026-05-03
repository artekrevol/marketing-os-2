import { desc, eq } from "drizzle-orm";
import {
  withBrandScope,
  recoverySnapshotsTable,
  type RecoverySnapshot,
} from "@workspace/db";
import { computeProjection, type ProjectionResult } from "../lib/projection";

/**
 * Run the burn-down projection against the most-recent 30 snapshots
 * for a brand. Reads the rankings-based gap column
 * (`gap_to_baseline_top10_pct`) per amendments §D.4.
 */
export async function getBurnDownProjection(
  brandId: string,
  windowSize = 30,
): Promise<ProjectionResult> {
  return withBrandScope(brandId, async ({ scoped }) => {
    const rows = (await scoped.select(recoverySnapshotsTable, {
      where: eq(recoverySnapshotsTable.brandId, brandId),
      orderBy: desc(recoverySnapshotsTable.snapshotDate),
      limit: windowSize,
    })) as RecoverySnapshot[];

    // Drizzle's `date` column is typed as `string` (ISO `YYYY-MM-DD`);
    // normalize to Date here so the projection function can do
    // arithmetic without re-parsing.
    const points = rows.map((r) => ({
      snapshotDate: new Date(r.snapshotDate),
      gapToBaselineTop10Pct:
        r.gapToBaselineTop10Pct != null
          ? Number(r.gapToBaselineTop10Pct)
          : null,
    }));

    return computeProjection(points, windowSize);
  });
}
