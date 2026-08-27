import { Queue, type JobsOptions } from "bullmq";
import { getRedisConnection } from "./connection";
import { JOB_REGISTRY, type JobData, type JobName } from "./types";

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
export async function addRepeatable<N extends JobName>(
  queueName: QueueName,
  jobName: N,
  data: JobData<N>,
  pattern: string,
): Promise<void> {
  const entry = JOB_REGISTRY[jobName];
  if (entry.queue !== queueName) {
    throw new Error(`addRepeatable: ${jobName} belongs to ${entry.queue}, not ${queueName}`);
  }
  const parsed = entry.schema.parse(data) as JobData<N>;
  await getQueue(queueName).add(jobName, parsed, {
    repeat: { pattern },
    // The repeat identity must include the tenant for brand jobs. The
    // scheduler payload's idempotency key is the canonical identity.
    jobId: parsed.idempotencyKey,
    // Repeatable schedulers should not pile up on retry storms — one
    // delayed re-attempt is plenty; the next cron tick will fire
    // regardless.
    attempts: 1,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  });
}

/** Remove legacy fixed-calendar repeatables now owned by Scheduled Deployments. */
export async function removeRepeatablesByName(
  queueName: QueueName,
  jobNames: readonly string[],
): Promise<number> {
  const queue = getQueue(queueName);
  const names = new Set(jobNames);
  const repeatables = await queue.getRepeatableJobs();
  const stale = repeatables.filter((job) => names.has(job.name));
  await Promise.all(stale.map((job) => queue.removeRepeatableByKey(job.key)));
  return stale.length;
}

/**
 * SEO crawl schedules. A `crawl_schedules` row maps 1:1 to a repeatable
 * `seo.rank-check.scheduled` job on the `integrations` queue, keyed by
 * the schedule's id so the cron pattern can be replaced without leaking
 * orphan schedulers.
 *
 * This is the shared primitive both the worker (boot-time reconciliation
 * from active rows) and the API (on schedule create/update/deactivate)
 * call — there is no separate event bus; the BullMQ queue IS the shared
 * channel between the two processes.
 */
const RANK_CHECK_JOB = "seo.rank-check.scheduled";

/**
 * Register (or refresh) the repeatable rank-check for a schedule. Any
 * existing repeatable for the same `scheduleId` is removed first so a
 * changed cron pattern fully replaces the old one (BullMQ keys
 * repeatables by pattern, so a naive re-add would leave the old
 * schedule firing).
 */
export async function registerCrawlSchedule(opts: {
  scheduleId: string;
  brandId: string;
  listId: string | null;
  cron: string;
}): Promise<void> {
  const queue = getQueue("integrations");
  await removeCrawlSchedule(opts.scheduleId);
  await queue.add(
    RANK_CHECK_JOB,
    {
      brandId: opts.brandId,
      scheduleId: opts.scheduleId,
      listId: opts.listId,
      idempotencyKey: `${RANK_CHECK_JOB}:${opts.scheduleId}`,
    },
    {
      repeat: { pattern: opts.cron },
      // The repeatable identity. Removal/refresh matches on this id.
      jobId: opts.scheduleId,
      attempts: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    },
  );
}

/**
 * Remove the repeatable rank-check for a schedule (deactivation/delete,
 * or as the first half of a refresh). No-op if none is registered. We
 * match by `jobId` because the cron pattern may have changed since the
 * schedule was registered, so we cannot reconstruct the repeat key.
 */
export async function removeCrawlSchedule(scheduleId: string): Promise<void> {
  const queue = getQueue("integrations");
  const repeatables = await queue.getRepeatableJobs();
  await Promise.all(
    repeatables
      .filter((j) => j.name === RANK_CHECK_JOB && j.id === scheduleId)
      .map((j) => queue.removeRepeatableByKey(j.key)),
  );
}
