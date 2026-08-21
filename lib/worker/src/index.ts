import { Worker, type Job } from "bullmq";
import {
  QUEUE_NAMES,
  type QueueName,
  getRedisConnection,
  closeRedisConnection,
  closeAllQueues,
  addRepeatable,
  removeRepeatablesByName,
} from "@workspace/jobs";
import { loadEnv } from "./env";
import { logger } from "./logger";
import { initSentry, captureJobError } from "./sentry";
import { dispatch } from "./jobs";
import { recordDeadJob } from "./jobs/dead-letter";
import { recordTerminalIntegrationFailure } from "./jobs/terminal-failure";
import {
  registerActiveCrawlSchedules,
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

  // -----------------------------------------------------------------------
  // TEMPORARY — cron-alive verification probe (remove after confirmed)
  // Fires every 5 minutes; produces a "job: started" log line each time.
  // Query: SELECT COUNT(*) FROM events WHERE event_type='system.heartbeat'
  //        AND created_at > now() - interval '35 minutes'  — expect >=3.
  // -----------------------------------------------------------------------
  try {
    await addRepeatable(
      "maintenance",
      "maintenance.heartbeat-noop",
      { idempotencyKey: "cron-alive-probe", message: "cron alive" },
      "*/5 * * * *",
    );
    logger.info({ pattern: "*/5 * * * *" }, "worker: cron-alive probe registered");
  } catch (err) {
    logger.error({ err }, "worker: failed to register cron-alive probe");
  }

  // SEO Intelligence — reconcile repeatable rank-check schedules from
  // active `crawl_schedules` rows on every boot.
  try {
    const removed = await Promise.all([
      removeRepeatablesByName("integrations", [
        "seo.sync-gsc.nightly",
        "seo.refresh-content-context-nightly",
        "seo.discovery.weekly",
      ]),
      removeRepeatablesByName("scoring", ["scoring.recovery-snapshot-nightly"]),
    ]);
    logger.info({ removed: removed.reduce((sum, count) => sum + count, 0) }, "worker: removed legacy fixed repeatables");
  } catch (err) {
    logger.error({ err }, "worker: failed to remove legacy fixed repeatables");
  }

  try {
    await registerActiveCrawlSchedules(logger);
  } catch (err) {
    logger.error({ err }, "worker: failed to register active crawl schedules");
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
