import {
  withBrandScope,
  recoveryInitiativesTable,
  eventsTable,
  type RecoveryInitiative,
} from "@workspace/db";
import {
  CreateInitiativeInputSchema,
  type CreateInitiativeInput,
} from "../types";

/**
 * Create a manually-logged recovery initiative. Brand-scoped via
 * `withBrandScope`; the row's `brand_id` is stamped from scope.
 *
 * Emits `recovery.initiative_created` to `events` for the activity
 * stream; no `audit_log` row — initiative CRUD is non-admin work
 * (admin or editor per RLS), so the events stream is the right home.
 */
export async function createInitiative(
  raw: CreateInitiativeInput,
): Promise<RecoveryInitiative> {
  const input = CreateInitiativeInputSchema.parse(raw);

  return withBrandScope(input.brandId, async ({ db, scoped }) => {
    const inserted = (await scoped.insert(
      recoveryInitiativesTable,
      {
        brandId: input.brandId,
        name: input.name,
        type: input.type,
        description: input.description ?? null,
        expectedImpactPct:
          input.expectedImpactPct != null
            ? input.expectedImpactPct.toString()
            : null,
        expectedImpactClicks: input.expectedImpactClicks ?? null,
        startedAt: input.startedAt,
        status: "active",
        createdBy: input.actorId,
      },
      { returning: true },
    )) as RecoveryInitiative[];
    const initiative = inserted[0]!;

    await db.insert(eventsTable).values({
      brandId: input.brandId,
      actorId: input.actorId,
      eventType: "recovery.initiative_created",
      subjectType: "recovery_initiative",
      subjectId: initiative.id,
      payload: {
        name: initiative.name,
        type: initiative.type,
        startedAt: initiative.startedAt.toISOString(),
      },
    });

    return initiative;
  });
}
