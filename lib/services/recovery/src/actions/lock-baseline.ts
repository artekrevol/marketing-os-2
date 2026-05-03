import { sql } from "drizzle-orm";
import {
  withBrandScope,
  recoveryBaselinesTable,
  eventsTable,
  auditLogTable,
  type RecoveryBaseline,
} from "@workspace/db";
import {
  LockBaselineInputSchema,
  type LockBaselineInput,
} from "../types";
import {
  BaselineAlreadyLockedError,
  InsufficientRankingsDataError,
} from "../errors";

/**
 * Aggregated 30-day rolling slice of `rank_snapshots` ending on the
 * baseline date. Per amendments §D.2 baselines are computed from
 * rankings only; GSC/GA4 stay NULL.
 */
interface RankBaseline {
  avgPosition: number;
  keywordsInTop10: number;
  keywordsInTop3: number;
  keywordCount: number;
}

/**
 * Compute the rankings portion of a baseline against `rank_snapshots`.
 * The schema for `rank_snapshots` is owned by Sprint 1 and not yet
 * mirrored in Drizzle, so we read it via raw SQL. Columns assumed:
 * `brand_id uuid`, `keyword text`, `position numeric`, `snapshot_date date`.
 *
 * Methodology (amendments §D.2):
 *   - Take the most-recent position per keyword within the 30-day
 *     window ending on `baselineDate`. This collapses noisy daily
 *     readings to one snapshot per keyword — the value the pack
 *     describes as "the baseline-day position."
 *   - `avg_position` = mean across those keywords.
 *   - `keywords_in_top_10` / `keywords_in_top_3` = counts at <= 10 / <= 3.
 *
 * Throws `InsufficientRankingsDataError` when no rows exist in the
 * window — refusing to write a baseline is safer than writing a
 * misleading one with zero keywords.
 */
async function computeRankingsBaseline(
  db: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> },
  brandId: string,
  baselineDate: string,
): Promise<RankBaseline> {
  const result = (await db.execute(sql`
    with latest_per_keyword as (
      select distinct on (keyword)
        keyword,
        position
      from public.rank_snapshots
      where brand_id = ${brandId}::uuid
        and snapshot_date <= ${baselineDate}::date
        and snapshot_date > (${baselineDate}::date - interval '30 days')
      order by keyword, snapshot_date desc
    )
    select
      avg(position)::numeric                           as avg_position,
      count(*) filter (where position <= 10)::integer  as top_10,
      count(*) filter (where position <= 3)::integer   as top_3,
      count(*)::integer                                as keyword_count
    from latest_per_keyword
  `)) as { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;

  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  const row = rows[0];
  const keywordCount = Number(row?.keyword_count ?? 0);
  if (!row || keywordCount === 0) {
    throw new InsufficientRankingsDataError(brandId, baselineDate);
  }
  return {
    avgPosition: Number(row.avg_position),
    keywordsInTop10: Number(row.top_10),
    keywordsInTop3: Number(row.top_3),
    keywordCount,
  };
}

/**
 * Lock the pre-October baseline for a brand.
 *
 * Idempotency: enforced by the `recovery_baselines.brand_id` unique
 * constraint and by an explicit pre-check inside the transaction.
 * A second caller racing with the first will either see the existing
 * row in the SELECT or hit the unique violation on insert — both
 * surface as `BaselineAlreadyLockedError`.
 *
 * Side effects (in order):
 *   1. Insert `recovery_baselines` row.
 *   2. Insert `audit_log` row (`recovery.baseline_locked`).
 *   3. Insert `events` row (`recovery.baseline_locked`).
 */
export async function lockBaseline(
  raw: LockBaselineInput,
): Promise<RecoveryBaseline> {
  const input = LockBaselineInputSchema.parse(raw);

  return withBrandScope(input.brandId, async ({ db, scoped }) => {
    // Existence pre-check inside the transaction. The UNIQUE index is
    // the durable enforcement; this gives a clean error path that
    // doesn't depend on catching a 23505.
    const existingResult = (await db.execute(sql`
      select id from public.recovery_baselines
      where brand_id = ${input.brandId}::uuid
      limit 1
    `)) as { rows?: Array<{ id: string }> } | Array<{ id: string }>;
    const existingRows = Array.isArray(existingResult)
      ? existingResult
      : (existingResult.rows ?? []);
    if (existingRows.length > 0) {
      throw new BaselineAlreadyLockedError(input.brandId);
    }

    const rankings = await computeRankingsBaseline(
      db,
      input.brandId,
      input.baselineDate,
    );

    // GSC / GA4 ingestion has not landed (amendments §D); both fields
    // write NULL on every brand. The dry-run report (Prompt 3) is
    // responsible for the operator-facing callout — log here for
    // worker-side traceability.
    // eslint-disable-next-line no-console
    console.warn(
      `[recovery.lockBaseline] brand=${input.brandId} writing NULL for baseline_gsc_clicks_daily and baseline_ga4_sessions_daily — GSC/GA4 ingestion deferred`,
    );

    let inserted: RecoveryBaseline[];
    try {
      inserted = (await scoped.insert(
        recoveryBaselinesTable,
        {
          brandId: input.brandId,
          baselineDate: input.baselineDate,
          methodology: "30d_rolling_avg",
          baselineGscClicksDaily: null,
          baselineGa4SessionsDaily: null,
          baselineAvgPosition: rankings.avgPosition.toString(),
          baselineKeywordsInTop10: rankings.keywordsInTop10,
          baselineKeywordsInTop3: rankings.keywordsInTop3,
          recoveryThresholdPct:
            input.recoveryThresholdPct != null
              ? input.recoveryThresholdPct.toString()
              : "100",
          recoveryConsecutiveDays: input.recoveryConsecutiveDays ?? 60,
          lockedBy: input.lockedBy,
          notes: input.notes ?? null,
        },
        { returning: true },
      )) as RecoveryBaseline[];
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new BaselineAlreadyLockedError(input.brandId);
      }
      throw err;
    }
    const baseline = inserted[0]!;

    await db.insert(auditLogTable).values({
      brandId: input.brandId,
      actorId: input.lockedBy,
      action: "recovery.baseline_locked",
      targetType: "recovery_baseline",
      targetId: baseline.id,
      justification: input.notes?.trim() || "Initial lock",
      metadata: {
        baselineDate: input.baselineDate,
        keywordCount: rankings.keywordCount,
        baselineAvgPosition: rankings.avgPosition,
        baselineKeywordsInTop10: rankings.keywordsInTop10,
        baselineKeywordsInTop3: rankings.keywordsInTop3,
        gscNull: true,
        ga4Null: true,
      },
    });

    await db.insert(eventsTable).values({
      brandId: input.brandId,
      actorId: input.lockedBy,
      eventType: "recovery.baseline_locked",
      subjectType: "recovery_baseline",
      subjectId: baseline.id,
      payload: {
        baselineDate: input.baselineDate,
        keywordCount: rankings.keywordCount,
      },
    });

    return baseline;
  });
}
