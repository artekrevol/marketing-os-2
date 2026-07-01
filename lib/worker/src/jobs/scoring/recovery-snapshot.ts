import { eq, sql } from "drizzle-orm";
import {
  withBrandScope,
  guardedDb,
  brandsTable,
  recoveryBaselinesTable,
  recoverySnapshotsTable,
  eventsTable,
  type RecoveryBaseline,
} from "@workspace/db";
import { computeRankingsBaseline } from "@workspace/services-recovery";
import type { JobData } from "@workspace/jobs";
import { enqueue } from "@workspace/jobs";
import type { Logger } from "pino";

const SNAPSHOT_SUCCESS_EVENT = "recovery.snapshot_computed";

/**
 * Compute (or short-circuit on) one `recovery_snapshots` row for a
 * `(brandId, snapshotDate)` pair.
 *
 * Methodology (amendments §D.4):
 *   - `avg_position_30d`, `keywords_in_top_10`, `keywords_in_top_3`
 *     come from `rank_snapshots` over the trailing 30-day window
 *     ending on `snapshotDate` — same query the baseline uses,
 *     reused via `computeRankingsBaseline`.
 *   - `gap_to_baseline_position = avg_position_30d - baseline_avg_position`
 *     (positive = worse).
 *   - `gap_to_baseline_top10_pct = (current - baseline) / baseline * 100`,
 *     the rankings-based headline metric until GSC ingestion lands.
 *   - GSC and GA4 columns write NULL.
 *
 * Idempotency: handler short-circuits when a row already exists for
 * `(brand_id, snapshot_date)` — the unique index is the durable
 * enforcement; this gives a clean log line instead of a 23505.
 */
export async function handleRecoverySnapshot(
  payload: JobData<"scoring.recovery-snapshot">,
  log: Logger,
): Promise<
  | { skipped: true; reason: string }
  | { computed: true; snapshotId: string; gapTop10Pct: number | null }
> {
  return withBrandScope(payload.brandId, async ({ db, scoped }) => {
    // Existence check on (brand_id, snapshot_date). Idempotent re-runs.
    const existingResult = (await db.execute(sql`
      select id from public.recovery_snapshots
      where brand_id = ${payload.brandId}::uuid
        and snapshot_date = ${payload.snapshotDate}::date
      limit 1
    `)) as { rows?: Array<{ id: string }> } | Array<{ id: string }>;
    const existingRows = Array.isArray(existingResult)
      ? existingResult
      : (existingResult.rows ?? []);
    if (existingRows.length > 0) {
      log.info(
        { snapshotId: existingRows[0]!.id, snapshotDate: payload.snapshotDate },
        "recovery-snapshot: already computed for (brand, date)",
      );
      return { skipped: true, reason: "already_computed" };
    }

    // Baseline must exist before snapshots can be computed — the gap
    // metrics are meaningless without it.
    const baselineRows = (await db.execute(sql`
      select
        avg_position_30d,
        keywords_in_top_10,
        keywords_in_top_3
      from public.recovery_baselines
      where brand_id = ${payload.brandId}::uuid
      limit 1
    `)) as
      | { rows?: Array<Record<string, unknown>> }
      | Array<Record<string, unknown>>;
    const baselineList = Array.isArray(baselineRows)
      ? baselineRows
      : (baselineRows.rows ?? []);
    const baselineRow = baselineList[0];
    if (!baselineRow) {
      log.warn(
        { brandId: payload.brandId },
        "recovery-snapshot: no locked baseline; cannot compute gap — skipping",
      );
      return { skipped: true, reason: "baseline_not_locked" };
    }
    const baselineAvgPosition = Number(baselineRow.avg_position_30d);
    const baselineTop10 = Number(baselineRow.keywords_in_top_10);

    // Trailing 30-day rankings window ending on snapshotDate.
    const rankings = await computeRankingsBaseline(
      db,
      payload.brandId,
      payload.snapshotDate,
    );

    const gapPosition = rankings.avgPosition - baselineAvgPosition;
    const gapTop10Pct =
      baselineTop10 > 0
        ? ((rankings.keywordsInTop10 - baselineTop10) / baselineTop10) * 100
        : null;

    const inserted = (await scoped.insert(
      recoverySnapshotsTable,
      {
        brandId: payload.brandId,
        snapshotDate: payload.snapshotDate,
        // GSC / GA4 ingestion deferred (amendments §D, §G).
        gscClicks30dAvg: null,
        ga4Sessions30dAvg: null,
        avgPosition30d: rankings.avgPosition.toString(),
        keywordsInTop10: rankings.keywordsInTop10,
        keywordsInTop3: rankings.keywordsInTop3,
        gapToBaselineClicksPct: null,
        gapToBaselinePosition: gapPosition.toString(),
        gapToBaselineTop10Pct: gapTop10Pct == null ? null : gapTop10Pct.toString(),
      },
      { returning: true },
    )) as Array<{ id: string }>;
    const snapshotId = inserted[0]?.id ?? null;

    await db.insert(eventsTable).values({
      brandId: payload.brandId,
      eventType: SNAPSHOT_SUCCESS_EVENT,
      subjectType: "recovery_snapshot",
      subjectId: snapshotId,
      payload: {
        idempotencyKey: payload.idempotencyKey,
        snapshotDate: payload.snapshotDate,
        avgPosition30d: rankings.avgPosition,
        keywordsInTop10: rankings.keywordsInTop10,
        keywordsInTop3: rankings.keywordsInTop3,
        gapToBaselinePosition: gapPosition,
        gapToBaselineTop10Pct: gapTop10Pct,
      },
    });

    log.info(
      {
        snapshotId,
        snapshotDate: payload.snapshotDate,
        avgPosition30d: rankings.avgPosition,
        gapPosition,
        gapTop10Pct,
      },
      "recovery-snapshot: computed",
    );

    return { computed: true, snapshotId: snapshotId ?? "<unknown>", gapTop10Pct };
  });
}

/**
 * Format a `Date` as ISO `YYYY-MM-DD` in UTC. Cron fires at 03:00 UTC,
 * so "yesterday" is consistently the previous calendar day in UTC.
 */
function isoDateUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Nightly fan-out (registered as a BullMQ repeatable job at
 * `0 3 * * *`). For every brand with a locked baseline, enqueue one
 * `scoring.recovery-snapshot` job for yesterday's date.
 *
 * Idempotency: the per-brand job's `idempotencyKey` is
 * `recovery-snapshot:<brandId>-<date>`, so re-firing the cron the same
 * minute (or a backfill landing on the same date) is a no-op via
 * BullMQ's `jobId` dedup AND the per-row unique `(brand_id,
 * snapshot_date)` check inside the handler.
 */
export async function handleRecoverySnapshotNightly(
  _payload: JobData<"scoring.recovery-snapshot-nightly">,
  log: Logger,
): Promise<{ enqueued: number; snapshotDate: string }> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const snapshotDate = isoDateUtc(yesterday);

  // System-side enumeration: the `brands` table is NOT brand-scoped
  // (it is the lookup root), so listing brand ids through `guardedDb`
  // is legitimate. Per-brand recovery_baselines reads then happen
  // inside `withBrandScope` so the tenancy guard remains active for
  // every brand-scoped read.
  const brandRows = await guardedDb
    .select({ id: brandsTable.id })
    .from(brandsTable);

  let enqueued = 0;
  let withBaseline = 0;
  for (const { id: brandId } of brandRows) {
    const hasBaseline = await withBrandScope(brandId, async ({ scoped }) => {
      const rows = (await scoped.select(recoveryBaselinesTable, {
        where: eq(recoveryBaselinesTable.brandId, brandId),
        limit: 1,
      })) as RecoveryBaseline[];
      return rows.length > 0;
    });
    if (!hasBaseline) continue;
    withBaseline += 1;
    await enqueue("scoring.recovery-snapshot", {
      brandId,
      snapshotDate,
      idempotencyKey: `recovery-snapshot:${brandId}-${snapshotDate}`,
    });
    enqueued += 1;
  }

  log.info(
    { snapshotDate, brands: brandRows.length, withBaseline, enqueued },
    "recovery-snapshot-nightly: fan-out complete",
  );
  return { enqueued, snapshotDate };
}

/** Re-export type used by the dispatcher for unused-import friendliness. */
export type { RecoveryBaseline };
