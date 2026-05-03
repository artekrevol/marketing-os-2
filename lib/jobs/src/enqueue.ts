import type { JobsOptions } from "bullmq";
import { getQueue } from "./queues";
import { JOB_REGISTRY, type JobName, type JobData } from "./types";

/**
 * Type-safe enqueue. Validates the payload against the job's zod schema
 * before pushing it to BullMQ; a payload that fails validation throws
 * synchronously so the caller (API server, scheduler) sees the error
 * immediately instead of finding it in dead_jobs an hour later.
 *
 * Idempotency: BullMQ's `jobId` is set to the payload's
 * `idempotencyKey`, so re-enqueueing with the same key is a no-op
 * inside the redis attempt-window.
 */
export async function enqueue<N extends JobName>(
  name: N,
  data: JobData<N>,
  opts?: JobsOptions,
): Promise<{ jobId: string; queueName: string }> {
  const entry = JOB_REGISTRY[name];
  if (!entry) {
    throw new Error(`enqueue: unknown job name ${name}`);
  }
  const parsed = entry.schema.parse(data) as JobData<N>;
  const queue = getQueue(entry.queue);
  const jobId = `${name}:${parsed.idempotencyKey}`;
  const job = await queue.add(name, parsed, {
    jobId,
    ...opts,
  });
  return { jobId: job.id ?? jobId, queueName: entry.queue };
}
