import { Router, type IRouter } from "express";
import { sql, desc, eq } from "drizzle-orm";
import { db, eventsTable, deadJobsTable } from "@workspace/db";
import { allQueues, enqueue } from "@workspace/jobs";
import { requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();
router.use(requireAdmin);

/**
 * Resolve the idempotency key for an admin-trigger request. Honors a
 * caller-supplied `idempotencyKey` in the JSON body (allowing the
 * /admin/system UI or curl to send the same key for a double-click,
 * which BullMQ will dedupe via jobId), and falls back to a fresh
 * server-side key when none is provided. Trims and clamps length to
 * keep the value safe to use as a Redis key.
 */
function resolveIdem(req: { body?: unknown }, prefix: string): string {
  const body = (req.body ?? {}) as { idempotencyKey?: unknown };
  const supplied = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (supplied.length > 0 && supplied.length <= 128) return supplied;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Enqueue a maintenance heartbeat. Returns the resulting jobId. */
router.post("/heartbeat", async (req, res) => {
  const idem = resolveIdem(req, "api");
  try {
    const { jobId, queueName } = await enqueue("maintenance.heartbeat-noop", {
      idempotencyKey: idem,
      message: `triggered by ${req.auth?.email ?? req.auth?.userId ?? "admin"}`,
    });
    res.status(202).json({ jobId, queueName, idempotencyKey: idem });
  } catch (err) {
    req.log.error({ err }, "admin-system: heartbeat enqueue failed");
    res.status(503).json({ error: "queue unavailable", message: (err as Error).message });
  }
});

router.post("/test-dataforseo", async (req, res) => {
  const idem = resolveIdem(req, "dfs");
  try {
    const { jobId, queueName } = await enqueue("integrations.dataforseo-serp-test", {
      idempotencyKey: idem,
      query: "tekrevol",
      locationCode: 2840,
      languageCode: "en",
    });
    res.status(202).json({ jobId, queueName, idempotencyKey: idem });
  } catch (err) {
    req.log.error({ err }, "admin-system: dfs test enqueue failed");
    res.status(503).json({ error: "queue unavailable", message: (err as Error).message });
  }
});

router.post("/test-originality", async (req, res) => {
  const idem = resolveIdem(req, "orig");
  try {
    const { jobId, queueName } = await enqueue("integrations.originality-ai-scan-test", {
      idempotencyKey: idem,
      text: "Original content benchmark used by the SEO OS worker tier to verify the Originality.ai integration is healthy.",
    });
    res.status(202).json({ jobId, queueName, idempotencyKey: idem });
  } catch (err) {
    req.log.error({ err }, "admin-system: originality test enqueue failed");
    res.status(503).json({ error: "queue unavailable", message: (err as Error).message });
  }
});

/** Live queue depths via BullMQ getJobCounts. */
router.get("/queues", async (_req, res) => {
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
    res.json({ queues });
  } catch (err) {
    res.status(503).json({ error: "queue unavailable", message: (err as Error).message });
  }
});

/** Recent events, optionally filtered by event_type. Limit 20. */
router.get("/events", async (req, res) => {
  const type = typeof req.query["type"] === "string" ? req.query["type"] : null;
  const rows = await (type
    ? db
        .select()
        .from(eventsTable)
        .where(eq(eventsTable.eventType, type))
        .orderBy(desc(eventsTable.createdAt))
        .limit(20)
    : db
        .select()
        .from(eventsTable)
        .orderBy(desc(eventsTable.createdAt))
        .limit(20));
  res.json({ events: rows });
});

/** Worker heartbeat freshness — most recent system.heartbeat event. */
router.get("/heartbeat-freshness", async (_req, res) => {
  const result = await db.execute(
    sql`select id, created_at, payload from public.events
        where event_type = 'system.heartbeat'
        order by created_at desc
        limit 1`,
  );
  const rows = (result as unknown as { rows: Array<{ id: string; created_at: string; payload: unknown }> }).rows;
  if (rows.length === 0) {
    res.json({ lastEventAt: null, ageSeconds: null });
    return;
  }
  const last = new Date(rows[0].created_at).getTime();
  res.json({
    lastEventAt: rows[0].created_at,
    ageSeconds: Math.round((Date.now() - last) / 1000),
    payload: rows[0].payload,
  });
});

/** Last 20 dead-letter rows. */
router.get("/dead-jobs", async (_req, res) => {
  const rows = await db
    .select()
    .from(deadJobsTable)
    .orderBy(desc(deadJobsTable.failedAt))
    .limit(20);
  res.json({ deadJobs: rows });
});

export default router;
