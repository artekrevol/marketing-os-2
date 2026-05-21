import { Router } from "express";
import { db, eventsTable } from "@workspace/db";
import {
  requireAuth,
  assertBrandAccess,
  BrandAccessError,
} from "../middlewares/auth.js";

const router = Router();

/**
 * POST /api/events
 * Fire-and-forget event logging. If a brandId is supplied the caller
 * must have access to it — otherwise an authenticated user could
 * pollute another brand's analytics stream with fake events.
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
    if (brandId) {
      await assertBrandAccess(req, brandId);
    }
    const userId = req.auth?.userId ?? null;
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
    if (err instanceof BrandAccessError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
});

export default router;
