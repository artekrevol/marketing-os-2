import { db, eventsTable } from "@workspace/db";
import type { JobData } from "@workspace/jobs";
import type { Logger } from "pino";
import { assertNotDuplicate } from "./idempotency";

const SLEEP_MS = 100;
const SUCCESS_EVENT = "system.heartbeat";

export async function handleHeartbeat(
  payload: JobData<"maintenance.heartbeat-noop">,
  log: Logger,
): Promise<{ inserted: boolean; eventId?: string }> {
  await new Promise((r) => setTimeout(r, SLEEP_MS));

  const dup = await assertNotDuplicate(SUCCESS_EVENT, payload.idempotencyKey, log);
  if (dup.duplicate) return { inserted: false, eventId: dup.eventId };

  const [row] = await db
    .insert(eventsTable)
    .values({
      eventType: SUCCESS_EVENT,
      brandId: payload.brandId ?? null,
      subjectType: "system",
      subjectId: "worker",
      payload: {
        idempotencyKey: payload.idempotencyKey,
        message: payload.message,
        receivedAt: new Date().toISOString(),
      },
    })
    .returning({ id: eventsTable.id });

  log.info({ idempotencyKey: payload.idempotencyKey, eventId: row?.id }, "heartbeat: event written");
  return { inserted: true, eventId: row?.id };
}
