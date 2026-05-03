import { sql } from "drizzle-orm";
import { db, eventsTable } from "@workspace/db";
import type { JobData } from "@workspace/jobs";
import type { Logger } from "pino";

const SLEEP_MS = 100;

export async function handleHeartbeat(
  payload: JobData<"maintenance.heartbeat-noop">,
  log: Logger,
): Promise<{ inserted: boolean; eventId?: string }> {
  await new Promise((r) => setTimeout(r, SLEEP_MS));

  const idem = payload.idempotencyKey;

  // Idempotency: short-circuit if an event with this key already exists.
  const existing = await db
    .select({ id: eventsTable.id })
    .from(eventsTable)
    .where(sql`event_type = 'system.heartbeat' and payload->>'idempotencyKey' = ${idem}`)
    .limit(1);

  if (existing.length > 0) {
    log.info({ idempotencyKey: idem, eventId: existing[0].id }, "heartbeat: duplicate, short-circuit");
    return { inserted: false, eventId: existing[0].id };
  }

  const [row] = await db
    .insert(eventsTable)
    .values({
      eventType: "system.heartbeat",
      brandId: payload.brandId ?? null,
      subjectType: "system",
      subjectId: "worker",
      payload: {
        idempotencyKey: idem,
        message: payload.message,
        receivedAt: new Date().toISOString(),
      },
    })
    .returning({ id: eventsTable.id });

  log.info({ idempotencyKey: idem, eventId: row?.id }, "heartbeat: event written");
  return { inserted: true, eventId: row?.id };
}
