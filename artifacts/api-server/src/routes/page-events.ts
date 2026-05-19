import { Router } from "express";
import { db, eventsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

/**
 * POST /api/page-events
 * Page-view telemetry from the frontend usePageTracker hook.
 * Stores into the shared events table with eventType="page_view".
 */
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const {
      path,
      project_id,
      entered_at,
      duration_ms,
      user_agent,
      referrer,
    } = req.body as {
      path?: string;
      project_id?: string | null;
      entered_at?: string;
      duration_ms?: number;
      user_agent?: string;
      referrer?: string | null;
    };

    const userId = (req as any).auth?.userId ?? null;

    await db.insert(eventsTable).values({
      eventType: "page_view",
      subjectType: project_id ? "project" : null,
      subjectId: project_id ?? null,
      payload: {
        path: path ?? null,
        entered_at: entered_at ?? null,
        duration_ms: duration_ms ?? null,
        user_agent: user_agent ?? null,
        referrer: referrer ?? null,
      },
      brandId: null,
      actorId: userId,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
