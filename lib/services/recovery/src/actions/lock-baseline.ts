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
import { BaselineAlreadyLockedError } from "../errors";
import { computeRankingsBaseline } from "../lib/compute-rankings-baseline";

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
          baselineGscClicksDaily: null,
          baselineGa4SessionsDaily: null,
          baselineAvgPosition: rankings.avgPosition.toString(),
          baselineKeywordsInTop10: rankings.keywordsInTop10,
          baselineKeywordsInTop3: rankings.keywordsInTop3,
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
