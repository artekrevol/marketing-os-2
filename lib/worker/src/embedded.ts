/**
 * Embedded worker entry point — starts BullMQ workers inside an existing
 * Node.js process (e.g. the API server) without binding an extra HTTP port.
 *
 * Differences from the standalone `index.ts`:
 *  - No `loadEnv()` — the host process owns env validation.
 *  - No `startHealthServer()` — no extra port is opened.
 *  - No `process.on()` signal handlers — the host process handles shutdown.
 *  - No Sentry init — callers may init Sentry themselves if desired.
 *  - Returns a `close()` handle the host process calls on shutdown.
 */
import { Worker, type Job } from "bullmq";
import {
  QUEUE_NAMES,
  type QueueName,
  getRedisConnection,
  closeAllQueues,
  addRepeatable,
} from "@workspace/jobs";
import { logger } from "./logger";
import { dispatch } from "./jobs";
import { recordDeadJob } from "./jobs/dead-letter";
import { recordTerminalIntegrationFailure } from "./jobs/terminal-failure";
import { captureJobError } from "./sentry";

export interface EmbeddedWorkerHandle {
  close(): Promise<void>;
}

export async function startEmbeddedWorkers(): Promise<EmbeddedWorkerHandle> {
  logger.info("embedded-worker: starting");

  const connection = getRedisConnection();

  const workers: Worker[] = QUEUE_NAMES.map((name: QueueName) => {
    const w = new Worker(name, (job: Job) => dispatch(job, name), {
      connection,
      autorun: true,
      concurrency: name === "content" ? 5 : 8,
    });

    w.on("completed", (job) =>
      logger.debug(
        { jobId: job.id, jobName: job.name, queue: name },
        "embedded-worker: completed",
      ),
    );

    w.on("failed", async (job, err) => {
      const attempts = job?.attemptsMade ?? 0;
      const rawMax = job?.opts?.attempts;
      const max = Math.max(
        1,
        typeof rawMax === "number" && rawMax > 0 ? rawMax : 5,
      );
      logger.warn(
        {
          jobId: job?.id,
          jobName: job?.name,
          queue: name,
          attempts,
          max,
          err: err?.message,
        },
        "embedded-worker: job failed",
      );
      captureJobError(err ?? new Error("unknown"), {
        jobId: job?.id ?? "<unknown>",
        jobName: job?.name ?? "<unknown>",
        queueName: name,
        attempt: attempts,
        brandId:
          ((job?.data as { brandId?: string } | undefined)?.brandId) ?? null,
      });
      if (job && attempts >= max) {
        await recordDeadJob(name, job, err ?? new Error("unknown"), logger);
        await recordTerminalIntegrationFailure(
          job,
          err ?? new Error("unknown"),
          logger,
        );
      }
    });

    w.on("error", (err) =>
      logger.error({ err, queue: name }, "embedded-worker: worker error"),
    );

    return w;
  });

  try {
    await addRepeatable(
      "scoring",
      "scoring.recovery-snapshot-nightly",
      { idempotencyKey: "scoring.recovery-snapshot-nightly:cron" },
      "0 3 * * *",
    );
    logger.info(
      { pattern: "0 3 * * *" },
      "embedded-worker: repeatable job registered",
    );
  } catch (err) {
    logger.error(
      { err },
      "embedded-worker: failed to register recovery-snapshot-nightly cron",
    );
  }

  logger.info(
    { queues: QUEUE_NAMES.length, workers: workers.length },
    "embedded-worker: ready",
  );

  return {
    async close() {
      logger.info("embedded-worker: closing");
      await Promise.all(workers.map((w) => w.close()));
      await closeAllQueues();
      logger.info("embedded-worker: closed");
    },
  };
}
