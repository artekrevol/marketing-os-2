import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  withBrandScope,
  crawlSchedulesTable,
  type CrawlSchedule,
} from "@workspace/db";
import { registerCrawlSchedule, removeCrawlSchedule } from "@workspace/jobs";
import { requireAuth } from "../../middlewares/auth.js";
import { guardBrand, fail, UUID_RE } from "./_shared.js";

const router: IRouter = Router();
router.use(requireAuth);

/**
 * Minimal cron sanity check (5 or 6 space-separated fields). BullMQ
 * validates the pattern itself at register time; this just rejects
 * obviously bad input before we persist a row.
 */
function looksLikeCron(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const parts = s.trim().split(/\s+/);
  return parts.length === 5 || parts.length === 6;
}

/** GET /api/seo/schedules?brandId= */
router.get("/", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  try {
    const rows = await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.select(crawlSchedulesTable, {
        orderBy: crawlSchedulesTable.createdAt,
      }),
    );
    res.json({ schedules: rows });
  } catch (err) {
    fail(res, req, "schedules.list", err);
  }
});

interface ScheduleBody {
  brandId?: string;
  cronExpression?: string;
  listId?: string | null;
  active?: boolean;
}

/**
 * POST /api/seo/schedules — create a recurring rank-check schedule.
 *
 * On create, if `active` (default true) we register the repeatable
 * BullMQ job directly via `registerCrawlSchedule`. The queue is the
 * shared channel between API and worker — there is no separate event
 * bus — so the worker picks up the new repeatable immediately.
 */
router.post("/", async (req, res) => {
  const body = (req.body ?? {}) as ScheduleBody;
  const guard = await guardBrand(req, body.brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  if (!looksLikeCron(body.cronExpression)) {
    res.status(400).json({ error: "cronExpression must be a 5- or 6-field cron string" });
    return;
  }
  if (
    body.listId != null &&
    (typeof body.listId !== "string" || !UUID_RE.test(body.listId))
  ) {
    res.status(400).json({ error: "listId must be a UUID" });
    return;
  }
  const active = body.active ?? true;
  try {
    const rows = (await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.insert(
        crawlSchedulesTable,
        {
          cronExpression: body.cronExpression,
          listId: body.listId ?? null,
          active,
        },
        { returning: true },
      ),
    )) as CrawlSchedule[];
    const schedule = rows[0]!;
    if (active) {
      await registerCrawlSchedule({
        scheduleId: schedule.id,
        brandId: guard.brandId,
        listId: schedule.listId ?? null,
        cron: schedule.cronExpression,
      });
    }
    res.status(201).json({ schedule });
  } catch (err) {
    fail(res, req, "schedules.create", err);
  }
});

/**
 * PUT /api/seo/schedules/:id — update cron/list/active.
 *
 * Reconciles the BullMQ repeatable to match the new state: register
 * (refresh) when the schedule is active, remove when deactivated.
 */
router.put("/:id", async (req, res) => {
  const id = req.params["id"];
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: "id must be a UUID" });
    return;
  }
  const body = (req.body ?? {}) as ScheduleBody;
  const guard = await guardBrand(req, body.brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  if (body.cronExpression !== undefined && !looksLikeCron(body.cronExpression)) {
    res.status(400).json({ error: "cronExpression must be a 5- or 6-field cron string" });
    return;
  }
  if (
    body.listId != null &&
    (typeof body.listId !== "string" || !UUID_RE.test(body.listId))
  ) {
    res.status(400).json({ error: "listId must be a UUID" });
    return;
  }
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (body.cronExpression !== undefined) set["cronExpression"] = body.cronExpression;
  if (body.listId !== undefined) set["listId"] = body.listId;
  if (body.active !== undefined) set["active"] = body.active;
  try {
    const updated = await withBrandScope(guard.brandId, async ({ scoped }) => {
      await scoped.update(crawlSchedulesTable, set, eq(crawlSchedulesTable.id, id));
      const rows = (await scoped.select(crawlSchedulesTable, {
        where: eq(crawlSchedulesTable.id, id),
        limit: 1,
      })) as CrawlSchedule[];
      return rows[0] ?? null;
    });
    if (!updated) {
      res.status(404).json({ error: "schedule not found" });
      return;
    }
    if (updated.active) {
      await registerCrawlSchedule({
        scheduleId: updated.id,
        brandId: guard.brandId,
        listId: updated.listId ?? null,
        cron: updated.cronExpression,
      });
    } else {
      await removeCrawlSchedule(updated.id);
    }
    res.json({ schedule: updated });
  } catch (err) {
    fail(res, req, "schedules.update", err);
  }
});

/** DELETE /api/seo/schedules/:id?brandId= — delete and unregister. */
router.delete("/:id", async (req, res) => {
  const id = req.params["id"];
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: "id must be a UUID" });
    return;
  }
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  try {
    await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.delete(crawlSchedulesTable, eq(crawlSchedulesTable.id, id)),
    );
    await removeCrawlSchedule(id);
    res.json({ ok: true });
  } catch (err) {
    fail(res, req, "schedules.delete", err);
  }
});

export default router;
