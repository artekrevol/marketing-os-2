import http from "node:http";
import { allQueues } from "@workspace/jobs";
import { logger } from "./logger";

export interface HealthServer {
  close: () => Promise<void>;
}

/**
 * Tiny HTTP server on PORT (default 3001) exposing GET /health for
 * Railway's healthcheck. Reports queue depths via getJobCounts so a
 * stuck Redis connection surfaces as a 5xx.
 */
export function startHealthServer(port: number, startedAt: number): HealthServer {
  const server = http.createServer(async (req, res) => {
    if (req.method !== "GET" || req.url?.split("?")[0] !== "/health") {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    try {
      const queues = await Promise.all(
        allQueues().map(async ([name, q]) => {
          const counts = await q.getJobCounts(
            "wait",
            "active",
            "delayed",
            "completed",
            "failed",
            "paused",
          );
          return { name, ...counts };
        }),
      );
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          status: "ok",
          uptime: Math.round((Date.now() - startedAt) / 1000),
          queues,
        }),
      );
    } catch (err) {
      logger.error({ err }, "/health: failure");
      res.statusCode = 503;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ status: "degraded", error: (err as Error).message }));
    }
  });

  server.listen(port, () => logger.info({ port }, "health server listening"));

  return {
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
