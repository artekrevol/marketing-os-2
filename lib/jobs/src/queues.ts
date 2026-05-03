import { Queue, type JobsOptions } from "bullmq";
import { getRedisConnection } from "./connection";

/** The five named queues. Order is informational; consumers may scale
 *  workers independently per queue.
 */
export const QUEUE_NAMES = [
  "crawls",
  "integrations",
  "ai-jobs",
  "notifications",
  "maintenance",
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

/** BullMQ defaults used by every job unless overridden at enqueue time. */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 30_000 }, // 30s → 1m → 2m (capped at 5m)
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 1000 },
};

const queues = new Map<QueueName, Queue>();

/** Get (and lazily create) the BullMQ Queue for a queue name. */
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

/** Iterable of (name, queue) for every registered queue. */
export function allQueues(): [QueueName, Queue][] {
  return QUEUE_NAMES.map((n) => [n, getQueue(n)]);
}

/** Close every Queue. Used by graceful shutdown handlers. */
export async function closeAllQueues(): Promise<void> {
  await Promise.all(Array.from(queues.values()).map((q) => q.close()));
  queues.clear();
}
