import { Worker, type Job } from "bullmq";
import {
  QUEUE_NAMES,
  type QueueName,
  getRedisConnection,
  closeRedisConnection,
  closeAllQueues,
  addRepeatable,
} from "@workspace/jobs";
import { guardedDb, brandsTable } from "@workspace/db";
import { loadEnv } from "./env";
import { logger } from "./logger";
import { initSentry, captureJobError } from "./sentry";
import { dispatch } from "./jobs";
import { recordDeadJob } from "./jobs/dead-letter";
import { recordTerminalIntegrationFailure } from "./jobs/terminal-failure";
import {
  registerActiveCrawlSchedules,
  registerDiscoveryWeeklySchedule,
} from "./jobs/seo/schedules";
import { startHealthServer } from "./health";

const startedAt = Date.now();

async function main(): Promise<void> {
  const env = loadEnv();
  initSentry(env.SENTRY_DSN, env.NODE_ENV);
  logger.info({ env: env.NODE_ENV }, "worker: booting");

  const connection = getRedisConnection();

  const workers: Worker[] = QUEUE_NAMES.map((name: QueueName) => {
    const w = new Worker(name, (job: Job) => dispatch(job, name), {
      connection,
      autorun: true,
      // Sprint 3: `content` queue runs Quality Gate jobs which call
      // Originality.ai (paid per-credit). Cap concurrency so a backlog
      // burst can't blow the budget.
      concurrency: name === "content" ? 5 : 8,
    });

    w.on("completed", (job) =>
      logger.debug({ jobId: job.id, jobName: job.name, queue: name }, "worker: completed"),
    );

    w.on("failed", async (job, err) => {
      const attempts = job?.attemptsMade ?? 0;
      // Defensive: BullMQ defaults usually populate `job.opts.attempts`
      // from the queue's `defaultJobOptions`, but if a producer enqueues
      // without that option AND the queue defaults are missing, fall
      // back to JOB_DEFAULTS.attempts (set in @workspace/jobs) so we
      // never dead-letter on attempt #0 due to a missing/zero attempts
      // field. We also clamp to >=1 to defend against bad data.
      const rawMax = job?.opts?.attempts;
      const max = Math.max(1, typeof rawMax === "number" && rawMax > 0 ? rawMax : 5);
      if (rawMax == null || rawMax === 0) {
        logger.warn(
          { jobId: job?.id, jobName: job?.name, queue: name, rawMax },
          "worker: job.opts.attempts missing — falling back to default (5)",
        );
      }
      logger.warn(
        { jobId: job?.id, jobName: job?.name, queue: name, attempts, max, err: err?.message },
        "worker: job failed",
      );
      captureJobError(err ?? new Error("unknown"), {
        jobId: job?.id ?? "<unknown>",
        jobName: job?.name ?? "<unknown>",
        queueName: name,
        attempt: attempts,
        brandId: ((job?.data as { brandId?: string } | undefined)?.brandId) ?? null,
      });
      if (job && attempts >= max) {
        // Terminal failure: persist to dead_jobs AND emit a single
        // `integration.error` event (for integration jobs only). This
        // is the ONLY place that writes integration.error — handlers
        // never do it per-attempt, so retries don't pollute the feed.
        await recordDeadJob(name, job, err ?? new Error("unknown"), logger);
        await recordTerminalIntegrationFailure(job, err ?? new Error("unknown"), logger);
      }
    });

    w.on("error", (err) => logger.error({ err, queue: name }, "worker: error"));

    return w;
  });

  // Recovery War Room — register the nightly snapshot fan-out
  // (amendments §E). BullMQ keys repeatable schedules by
  // `(name, repeat.pattern)` so re-registering on every boot is safe.
  try {
    await addRepeatable(
      "scoring",
      "scoring.recovery-snapshot-nightly",
      { idempotencyKey: "scoring.recovery-snapshot-nightly:cron" },
      "0 3 * * *",
    );
    logger.info(
      { name: "scoring.recovery-snapshot-nightly", pattern: "0 3 * * *" },
      "worker: repeatable job registered",
    );
  } catch (err) {
    logger.error({ err }, "worker: failed to register recovery-snapshot-nightly cron");
  }

  // Shared Data Layer — nightly refresh of in-flight keyword research
  // briefs whose SEO context snapshot has gone stale (>7 days).
  try {
    await addRepeatable(
      "integrations",
      "seo.refresh-content-context-nightly",
      { idempotencyKey: "seo.refresh-content-context-nightly:cron" },
      "0 3 * * *",
    );
    logger.info(
      { name: "seo.refresh-content-context-nightly", pattern: "0 3 * * *" },
      "worker: repeatable job registered",
    );
  } catch (err) {
    logger.error(
      { err },
      "worker: failed to register refresh-content-context-nightly cron",
    );
  }

  // SEO Intelligence — reconcile repeatable rank-check schedules from
  // active `crawl_schedules` rows on every boot.
  try {
    await registerActiveCrawlSchedules(logger);
  } catch (err) {
    logger.error({ err }, "worker: failed to register active crawl schedules");
  }

  // Discovery Engine — register weekly keyword discovery repeatable for
  // each brand. Safe to call on every boot (addRepeatable is idempotent).
  try {
    const brands = await guardedDb
      .select({ id: brandsTable.id })
      .from(brandsTable);
    for (const { id } of brands) {
      await registerDiscoveryWeeklySchedule(id, logger);
    }
  } catch (err) {
    logger.error({ err }, "worker: failed to register discovery weekly schedules");
  }

  const health = startHealthServer(env.PORT, startedAt);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "worker: shutdown initiated");
    try {
      await Promise.all(workers.map((w) => w.close()));
      await closeAllQueues();
      await closeRedisConnection();
      await health.close();
      logger.info("worker: shutdown complete");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "worker: shutdown failed");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "worker: uncaughtException");
    void shutdown("uncaughtException");
  });
  process.on("unhandledRejection", (err) => {
    logger.fatal({ err }, "worker: unhandledRejection");
  });

  logger.info({ queues: QUEUE_NAMES.length, workers: workers.length }, "worker: ready");
}

main().catch((err) => {
  logger.fatal({ err }, "worker: fatal boot error");
  process.exit(1);
});
