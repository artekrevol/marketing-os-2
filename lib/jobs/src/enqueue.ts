import type { JobsOptions } from "bullmq";
import { getQueue } from "./queues";
import { JOB_REGISTRY, type JobName, type JobData } from "./types";

/**
 * Build the BullMQ custom job id from a job name and idempotency key.
 *
 * BullMQ (>=5) rejects a custom id containing `:` unless it splits into
 * exactly three parts (i.e. at most two colons total). Since we always
 * prefix with `${name}:`, the `idempotencyKey` must itself contain
 * exactly one colon. We fail fast here with an actionable message so
 * callers see the offending key instead of BullMQ's opaque
 * "Custom Id cannot contain :" at enqueue time. Use a non-colon
 * separator (e.g. `-`) for any extra segments in the key.
 */
export function buildJobId(name: string, idempotencyKey: string): string {
  const jobId = `${name}:${idempotencyKey}`;
  if (jobId.includes(":") && jobId.split(":").length !== 3) {
    throw new Error(
      `enqueue: invalid jobId "${jobId}" — idempotencyKey must contain exactly one ":" ` +
        `(BullMQ allows at most two colons total). Use a non-colon separator for extra segments.`,
    );
  }
  return jobId;
}

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
  const jobId = buildJobId(name, parsed.idempotencyKey);
  const job = await queue.add(name, parsed, {
    jobId,
    ...opts,
  });
  return { jobId: job.id ?? jobId, queueName: entry.queue };
}
