import { db, eventsTable } from "@workspace/db";
import type { Job } from "bullmq";
import type { Logger } from "pino";

/**
 * Map a job name → the integration `subjectId` we want to tag in
 * `integration.error` events. Only integration-bound jobs need this;
 * `maintenance.*` jobs are not externally costly and we skip the
 * dedicated error event for them (the dead_jobs table is enough).
 */
const INTEGRATION_SUBJECT: Record<string, string> = {
  "integrations.dataforseo-serp-test": "dataforseo",
  "integrations.originality-ai-scan-test": "originality-ai",
};

/**
 * Emit a single `integration.error` event ONLY on terminal failure
 * (`attemptsMade >= attempts`). Per-attempt errors are NOT written —
 * they would pollute observability with up to N rows per dead job.
 *
 * Safe to call from the BullMQ Worker `failed` listener; swallows its
 * own errors so a write failure here can never break the worker loop.
 */
export async function recordTerminalIntegrationFailure(
  job: Job | undefined,
  err: Error,
  log: Logger,
): Promise<void> {
  if (!job) return;
  const subject = INTEGRATION_SUBJECT[job.name];
  if (!subject) return; // not an integration job — dead_jobs is the record

  const payload = (job.data ?? {}) as {
    brandId?: string | null;
    idempotencyKey?: string;
  };

  try {
    await db.insert(eventsTable).values({
      eventType: "integration.error",
      brandId: payload.brandId ?? null,
      subjectType: "integration",
      subjectId: subject,
      payload: {
        idempotencyKey: payload.idempotencyKey ?? null,
        jobId: job.id ?? null,
        jobName: job.name,
        attemptsMade: job.attemptsMade ?? 0,
        message: err.message ?? "unknown",
      },
    });
  } catch (writeErr) {
    log.error(
      { writeErr, originalErr: err, jobId: job.id, jobName: job.name },
      "terminal-failure: failed to record integration.error",
    );
  }
}
