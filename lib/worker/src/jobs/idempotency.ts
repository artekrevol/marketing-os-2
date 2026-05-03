import { sql } from "drizzle-orm";
import { db, eventsTable } from "@workspace/db";
import type { Logger } from "pino";

/**
 * Handler-level idempotency guard.
 *
 * BullMQ's `jobId` dedupes enqueues, but it is bounded by
 * `removeOnComplete` retention; once an old job is reaped, the same key
 * could be re-enqueued and processed twice. To make every job at-most-
 * once over a longer horizon, every handler that produces side effects
 * (DB writes, external API calls that cost money) should call
 * `assertNotDuplicate` *before* doing any work.
 *
 * The contract: each successful run records an event whose
 * `payload->>'idempotencyKey'` matches the job's `idempotencyKey` and
 * whose `event_type` matches `successEventType`. A subsequent run with
 * the same idempotencyKey will see that event and short-circuit.
 *
 * Returns `{ duplicate: true, eventId }` if a prior success exists.
 * Returns `{ duplicate: false }` if the handler should proceed.
 */
export async function assertNotDuplicate(
  successEventType: string,
  idempotencyKey: string,
  log: Logger,
): Promise<{ duplicate: true; eventId: string } | { duplicate: false }> {
  const existing = await db
    .select({ id: eventsTable.id })
    .from(eventsTable)
    .where(
      sql`event_type = ${successEventType} and payload->>'idempotencyKey' = ${idempotencyKey}`,
    )
    .limit(1);

  if (existing.length > 0) {
    log.info(
      { idempotencyKey, eventId: existing[0].id, successEventType },
      "idempotency: duplicate detected, short-circuit",
    );
    return { duplicate: true, eventId: existing[0].id };
  }
  return { duplicate: false };
}
