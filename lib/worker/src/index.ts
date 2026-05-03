import { Worker, type Job } from "bullmq";
import {
  QUEUE_NAMES,
  type QueueName,
  getRedisConnection,
  closeRedisConnection,
  closeAllQueues,
} from "@workspace/jobs";
import { loadEnv } from "./env";
import { logger } from "./logger";
import { initSentry, captureJobError } from "./sentry";
import { dispatch } from "./jobs";
import { recordDeadJob } from "./jobs/dead-letter";
import { recordTerminalIntegrationFailure } from "./jobs/terminal-failure";
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
      concurrency: name === "ai-jobs" ? 4 : 8,
    });

    w.on("completed", (job) =>
      logger.debug({ jobId: job.id, jobName: job.name, queue: name }, "worker: completed"),
    );

    w.on("failed", async (job, err) => {
      const attempts = job?.attemptsMade ?? 0;
      const max = (job?.opts?.attempts ?? 1);
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
