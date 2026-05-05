import { Queue, type JobsOptions } from "bullmq";
import { getRedisConnection } from "./connection";

/**
 * The five named queues. Sprint 3 rename:
 *   - dropped: crawls, ai-jobs, notifications (Sprint 2 placeholders)
 *   - kept:    maintenance, integrations
 *   - added:   projects (project-lifecycle jobs), content (QA + drafting),
 *              scoring (originality/composite scoring jobs)
 *
 * Worker concurrency (lib/worker/src/index.ts) is tuned per-queue;
 * `content` runs at concurrency=5 to bound Originality.ai cost.
 */
export const QUEUE_NAMES = [
  "maintenance",
  "integrations",
  "projects",
  "content",
  "scoring",
  "ai",
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

/** BullMQ defaults used by every job unless overridden at enqueue time. */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 1000 },
};

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: getRedisConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    queues.set(name, q);
  }
  return q;
}

export function allQueues(): [QueueName, Queue][] {
  return QUEUE_NAMES.map((n) => [n, getQueue(n)]);
}

export async function closeAllQueues(): Promise<void> {
  await Promise.all(Array.from(queues.values()).map((q) => q.close()));
  queues.clear();
}

/**
 * Register (or refresh) a BullMQ repeatable job. BullMQ keys a
 * repeatable schedule by `(name, repeat.pattern, repeat.tz, jobId?)`,
 * so calling this multiple times with the same arguments is a no-op
 * — safe to invoke on every worker boot.
 *
 * Recovery War Room uses this to register the nightly snapshot
 * fan-out (`scoring.recovery-snapshot-nightly`, `0 3 * * *`).
 */
export async function addRepeatable(
  queueName: QueueName,
  jobName: string,
  data: Record<string, unknown>,
  pattern: string,
): Promise<void> {
  await getQueue(queueName).add(jobName, data, {
    repeat: { pattern },
    // Repeatable schedulers should not pile up on retry storms — one
    // delayed re-attempt is plenty; the next cron tick will fire
    // regardless.
    attempts: 1,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  });
}
