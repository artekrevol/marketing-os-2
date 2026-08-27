import { Router } from "express";
import { db, auditLogTable } from "@workspace/db";
import {
  requireAuth,
  assertBrandAccess,
  BrandAccessError,
} from "../middlewares/auth.js";

const router = Router();

/**
 * POST /api/audit
 * Admin-sensitive audit log entry. Justification is mandatory.
 * Brand actions require an authorized brand. A missing brandId is stored as
 * an explicit global platform action rather than an ambiguous null row.
 */
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { action, targetType, targetId, justification, metadata, brandId } = req.body as {
      action?: string;
      targetType?: string | null;
      targetId?: string | null;
      justification?: string;
      metadata?: Record<string, unknown>;
      brandId?: string | null;
    };
    if (!action) { res.status(400).json({ error: "action required" }); return; }
    if (!justification || !justification.trim()) { res.status(400).json({ error: "justification required" }); return; }
    const isGlobal = !brandId;
    if (isGlobal && !action.startsWith("system.") && !action.startsWith("admin.")) {
      res.status(400).json({ error: "brandId required for brand audit actions" });
      return;
    }
    if (isGlobal && !req.auth?.isAdmin) {
      res.status(403).json({ error: "global audit actions require admin access" });
      return;
    }
    if (brandId) {
      await assertBrandAccess(req, brandId);
    }
    const userId = req.auth?.userId ?? null;
    await db.insert(auditLogTable).values({
      action,
      targetType: targetType || null,
      targetId: targetId || null,
      justification: justification.trim(),
      metadata: metadata || {},
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
