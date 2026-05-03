import { and, desc, eq, gte } from "drizzle-orm";
import {
  withBrandScope,
  recoverySnapshotsTable,
  type RecoverySnapshot,
} from "@workspace/db";

export interface GetSnapshotsOptions {
  /**
   * Trailing window in days (e.g. 90 for the dashboard chart). The
   * earliest snapshot returned has `snapshot_date >= today - days`.
   * Default 90.
   */
  days?: number;
  /** Hard cap on returned rows. Default 365 (one year). */
  limit?: number;
}

/**
 * Return recovery_snapshots for a brand within a trailing window,
 * ordered ascending by date so the trend chart can render directly.
 *
 * Rankings-based fields are non-null; GSC/GA4/clicks-pct fields will
 * be NULL until those ingestion pipelines land (amendments §D.4).
 */
export async function getSnapshots(
  brandId: string,
  opts: GetSnapshotsOptions = {},
): Promise<RecoverySnapshot[]> {
  const days = opts.days ?? 90;
  const limit = opts.limit ?? 365;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString().slice(0, 10);

  return withBrandScope(brandId, async ({ scoped }) => {
    const rows = (await scoped.select(recoverySnapshotsTable, {
      where: and(
        eq(recoverySnapshotsTable.brandId, brandId),
        gte(recoverySnapshotsTable.snapshotDate, sinceIso),
      )!,
      orderBy: desc(recoverySnapshotsTable.snapshotDate),
      limit,
    })) as RecoverySnapshot[];

    // Return ascending so the chart's x-axis flows naturally; the DB
    // query takes DESC + LIMIT so we get the most-recent N rows even
    // when the table is huge.
    return rows.slice().reverse();
  });
}
