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
