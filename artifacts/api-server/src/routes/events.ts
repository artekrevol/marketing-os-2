import { Router } from "express";
import { db, eventsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

/**
 * POST /api/events
 * Fire-and-forget event logging.
 */
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { eventType, subjectType, subjectId, payload, brandId } = req.body as {
      eventType?: string;
      subjectType?: string | null;
      subjectId?: string | null;
      payload?: Record<string, unknown>;
      brandId?: string | null;
    };
    if (!eventType) { res.status(400).json({ error: "eventType required" }); return; }
    const userId = (req as any).auth?.userId ?? null;
    await db.insert(eventsTable).values({
      eventType,
      subjectType: subjectType || null,
      subjectId: subjectId || null,
      payload: payload || {},
      brandId: brandId || null,
      actorId: userId,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
