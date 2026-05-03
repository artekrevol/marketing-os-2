import { eq } from "drizzle-orm";
import {
  withBrandScope,
  recoveryInitiativesTable,
  eventsTable,
  type RecoveryInitiative,
} from "@workspace/db";
import { enqueue } from "@workspace/jobs";
import {
  CompleteInitiativeInputSchema,
  type CompleteInitiativeInput,
} from "../types";
import {
  InitiativeNotFoundError,
  InitiativeNotActiveError,
} from "../errors";

/** Delay (ms) before the actual-impact computation runs — 14 days per pack §4 P2. */
const ACTUAL_IMPACT_DELAY_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Mark an initiative complete. Side effects:
 *   1. Set status='completed', completed_at=now() (under brand scope).
 *   2. Enqueue `scoring.recovery-initiative-impact` with a 14-day
 *      delay so the worker can compute `actual_impact_clicks_14d`.
 *      The job is in the `scoring` queue — already wired up in
 *      lib/jobs/src/queues.ts (amendments §E).
 *   3. Emit `recovery.initiative_completed` to `events`.
 *
 * Refuses to complete an initiative that is not currently `active` —
 * re-completing or completing an abandoned initiative is almost
 * always a UI bug; surface it loudly.
 */
export async function completeInitiative(
  raw: CompleteInitiativeInput,
): Promise<RecoveryInitiative> {
  const input = CompleteInitiativeInputSchema.parse(raw);

  // Re-call semantics: if the row is already `completed`, we still
  // run the enqueue (BullMQ collapses on jobId so it is a no-op when
  // the job already exists). This makes `completeInitiative`
  // idempotent and ALSO recovers from the failure mode where a
  // previous call committed the DB update but the post-commit
  // enqueue threw — re-running schedules the missing impact job
  // without an admin override path.
  const initiative = await withBrandScope(
    input.brandId,
    async ({ db, scoped }) => {
      const existing = (await scoped.select(recoveryInitiativesTable, {
        where: eq(recoveryInitiativesTable.id, input.initiativeId),
        limit: 1,
      })) as RecoveryInitiative[];
      if (existing.length === 0) {
        throw new InitiativeNotFoundError(input.initiativeId);
      }
      const current = existing[0]!;
      if (current.status === "abandoned") {
        throw new InitiativeNotActiveError(input.initiativeId, current.status);
      }
      if (current.status === "completed") {
        return current;
      }

      const now = new Date();
      await scoped.update(
        recoveryInitiativesTable,
        { status: "completed", completedAt: now, updatedAt: now },
        eq(recoveryInitiativesTable.id, input.initiativeId),
      );

      const refreshed = (await scoped.select(recoveryInitiativesTable, {
        where: eq(recoveryInitiativesTable.id, input.initiativeId),
        limit: 1,
      })) as RecoveryInitiative[];
      const completed = refreshed[0]!;

      await db.insert(eventsTable).values({
        brandId: input.brandId,
        actorId: input.actorId,
        eventType: "recovery.initiative_completed",
        subjectType: "recovery_initiative",
        subjectId: completed.id,
        payload: {
          completedAt: completed.completedAt
            ? completed.completedAt.toISOString()
            : null,
        },
      });

      return completed;
    },
  );

  // Enqueue the delayed actual-impact job OUTSIDE the transaction.
  // Deterministic idempotencyKey + BullMQ jobId dedupe means a
  // retry-after-prior-DB-commit re-creates the missing job rather
  // than duplicating it. If THIS enqueue throws, the caller can
  // safely re-invoke `completeInitiative`: the DB step short-circuits
  // (already_completed branch above) and the enqueue runs again.
  await enqueue(
    "scoring.recovery-initiative-impact",
    {
      idempotencyKey: `recovery-initiative-impact:${initiative.id}`,
      brandId: input.brandId,
      initiativeId: initiative.id,
    },
    { delay: ACTUAL_IMPACT_DELAY_MS },
  );

  return initiative;
}
