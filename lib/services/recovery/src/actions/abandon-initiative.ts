import { eq } from "drizzle-orm";
import {
  withBrandScope,
  recoveryInitiativesTable,
  eventsTable,
  type RecoveryInitiative,
} from "@workspace/db";
import {
  AbandonInitiativeInputSchema,
  type AbandonInitiativeInput,
} from "../types";
import {
  InitiativeNotFoundError,
  InitiativeNotActiveError,
} from "../errors";

/**
 * Mark an initiative abandoned. Admin-only at the API surface — the
 * service layer assumes the caller has been gated already. Captures
 * the reason on the `recovery.initiative_abandoned` event payload
 * (the row itself only carries `status`, no `abandonment_reason`
 * column — events stream is the audit trail).
 *
 * Refuses to abandon an already-completed or already-abandoned
 * initiative; the UI hides the affordance in those cases, but a
 * direct API hit must surface a 409 rather than silently no-op.
 */
export async function abandonInitiative(
  raw: AbandonInitiativeInput,
): Promise<RecoveryInitiative> {
  const input = AbandonInitiativeInputSchema.parse(raw);

  return withBrandScope(input.brandId, async ({ db, scoped }) => {
    const existing = (await scoped.select(recoveryInitiativesTable, {
      where: eq(recoveryInitiativesTable.id, input.initiativeId),
      limit: 1,
    })) as RecoveryInitiative[];
    if (existing.length === 0) {
      throw new InitiativeNotFoundError(input.initiativeId);
    }
    const current = existing[0]!;
    if (current.status === "abandoned" || current.status === "completed") {
      throw new InitiativeNotActiveError(input.initiativeId, current.status);
    }

    const now = new Date();
    await scoped.update(
      recoveryInitiativesTable,
      { status: "abandoned", updatedAt: now },
      eq(recoveryInitiativesTable.id, input.initiativeId),
    );

    const refreshed = (await scoped.select(recoveryInitiativesTable, {
      where: eq(recoveryInitiativesTable.id, input.initiativeId),
      limit: 1,
    })) as RecoveryInitiative[];
    const abandoned = refreshed[0]!;

    await db.insert(eventsTable).values({
      brandId: input.brandId,
      actorId: input.actorId,
      eventType: "recovery.initiative_abandoned",
      subjectType: "recovery_initiative",
      subjectId: abandoned.id,
      payload: {
        reason: input.reason,
        previousStatus: current.status,
      },
    });

    return abandoned;
  });
}
