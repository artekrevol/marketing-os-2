/**
 * Manual smoke test: enqueue a heartbeat, poll for the event row, print
 * PASS/FAIL. Run with:
 *
 *   DATABASE_URL=... REDIS_URL=... pnpm --filter @workspace/worker test:enqueue-heartbeat
 *
 * Requires the worker process to be running (Railway or `pnpm dev`).
 */
import { sql } from "drizzle-orm";
import { guardedDb as db, eventsTable } from "@workspace/db";
import { enqueue, closeAllQueues, closeRedisConnection } from "@workspace/jobs";

const TIMEOUT_MS = 5_000;
const POLL_MS = 250;

async function pollForEvent(idempotencyKey: string, deadlineMs: number): Promise<string | null> {
  while (Date.now() < deadlineMs) {
    const rows = await db
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(sql`event_type = 'system.heartbeat' and payload->>'idempotencyKey' = ${idempotencyKey}`)
      .limit(1);
    if (rows.length > 0) return rows[0].id;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return null;
}

async function main(): Promise<void> {
  const idem = `heartbeat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const start = Date.now();

  const { jobId } = await enqueue("maintenance.heartbeat-noop", {
    idempotencyKey: idem,
    message: "smoke-test",
  });
  console.log(`[enqueue-heartbeat] queued jobId=${jobId} idem=${idem}`);

  const eventId = await pollForEvent(idem, start + TIMEOUT_MS);
  const elapsed = Date.now() - start;

  if (!eventId) {
    console.error(`[enqueue-heartbeat] FAIL: no event after ${elapsed}ms`);
    process.exitCode = 1;
  } else {
    console.log(`[enqueue-heartbeat] PASS: event ${eventId} in ${elapsed}ms`);
  }

  // Re-enqueue same key — must still produce exactly one row.
  await enqueue("maintenance.heartbeat-noop", {
    idempotencyKey: idem,
    message: "smoke-test-duplicate",
  });
  await new Promise((r) => setTimeout(r, 1500));
  const dupRows = await db
    .select({ id: eventsTable.id })
    .from(eventsTable)
    .where(sql`event_type = 'system.heartbeat' and payload->>'idempotencyKey' = ${idem}`);
  if (dupRows.length === 1) {
    console.log("[enqueue-heartbeat] PASS: idempotency held — exactly 1 row");
  } else {
    console.error(`[enqueue-heartbeat] FAIL: expected 1 row, got ${dupRows.length}`);
    process.exitCode = 1;
  }

  await closeAllQueues();
  await closeRedisConnection();
}

main().catch((err) => {
  console.error("[enqueue-heartbeat] fatal:", err);
  process.exit(1);
});
