import { guardedDb as db, deadJobsTable } from "@workspace/db";
import type { Job } from "bullmq";
import type { Logger } from "pino";

/**
 * Persist a job that exhausted its retry budget into the `dead_jobs`
 * table. Called from each Worker's `failed` listener when
 * `attemptsMade >= attempts`.
 */
export async function recordDeadJob(
  queueName: string,
  job: Job | undefined,
  err: Error,
  log: Logger,
): Promise<void> {
  if (!job) return;
  try {
    await db.insert(deadJobsTable).values({
      queueName,
      jobName: job.name,
      jobId: job.id ?? "<unknown>",
      payload: (job.data ?? {}) as object,
      failureReason: err.message ?? "unknown failure",
      stack: err.stack ?? null,
      attemptsMade: job.attemptsMade ?? 0,
    });
    log.warn(
      { jobId: job.id, jobName: job.name, queueName, attempts: job.attemptsMade },
      "dead-letter: job persisted",
    );
  } catch (writeErr) {
    log.error({ writeErr, originalErr: err }, "dead-letter: failed to persist");
  }
}
