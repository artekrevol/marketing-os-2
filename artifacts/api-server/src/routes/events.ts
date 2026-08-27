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
 * Fire-and-forget event logging. Brand events require an authorized brand.
 * Only explicitly global system events may omit brandId.
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
    const isGlobal = !brandId;
    if (isGlobal && (!eventType.startsWith("system.") || subjectType !== "system")) {
      res.status(400).json({ error: "brandId required for brand events" });
      return;
    }
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
      scope: isGlobal ? "global" : "brand",
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
