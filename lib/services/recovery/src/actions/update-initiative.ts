import { eq } from "drizzle-orm";
import {
  withBrandScope,
  recoveryInitiativesTable,
  eventsTable,
  type RecoveryInitiative,
} from "@workspace/db";
import {
  UpdateInitiativeInputSchema,
  type UpdateInitiativeInput,
} from "../types";
import { InitiativeNotFoundError } from "../errors";

/**
 * Update mutable fields on an initiative. `brand_id`, `created_by`,
 * `created_at`, `actual_impact_clicks_14d` and `completed_at` are NOT
 * mutable through this path — those are owned by the lock action,
 * the complete action, or the impact-computation worker job.
 */
export async function updateInitiative(
  raw: UpdateInitiativeInput,
): Promise<RecoveryInitiative> {
  const input = UpdateInitiativeInputSchema.parse(raw);

  return withBrandScope(input.brandId, async ({ db, scoped }) => {
    const existing = (await scoped.select(recoveryInitiativesTable, {
      where: eq(recoveryInitiativesTable.id, input.initiativeId),
      limit: 1,
    })) as RecoveryInitiative[];
    if (existing.length === 0) {
      throw new InitiativeNotFoundError(input.initiativeId);
    }

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) set.name = input.name;
    if (input.type !== undefined) set.type = input.type;
    if (input.description !== undefined) set.description = input.description;
    if (input.expectedImpactPct !== undefined) {
      set.expectedImpactPct =
        input.expectedImpactPct == null
          ? null
          : input.expectedImpactPct.toString();
    }
    if (input.expectedImpactClicks !== undefined) {
      set.expectedImpactClicks = input.expectedImpactClicks;
    }
    if (input.startedAt !== undefined) set.startedAt = input.startedAt;
    if (input.status !== undefined) set.status = input.status;

    await scoped.update(
      recoveryInitiativesTable,
      set,
      eq(recoveryInitiativesTable.id, input.initiativeId),
    );

    const refreshed = (await scoped.select(recoveryInitiativesTable, {
      where: eq(recoveryInitiativesTable.id, input.initiativeId),
      limit: 1,
    })) as RecoveryInitiative[];
    const initiative = refreshed[0]!;

    await db.insert(eventsTable).values({
      brandId: input.brandId,
      actorId: input.actorId,
      eventType: "recovery.initiative_updated",
      subjectType: "recovery_initiative",
      subjectId: initiative.id,
      payload: {
        changedFields: Object.keys(set).filter((k) => k !== "updatedAt"),
      },
    });

    return initiative;
  });
}
