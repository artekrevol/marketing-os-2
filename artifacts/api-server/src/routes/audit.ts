import { Router } from "express";
import { db, auditLogTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

/**
 * POST /api/audit
 * Admin-sensitive audit log entry. Justification is mandatory.
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
    const userId = (req as any).auth?.userId ?? null;
    await db.insert(auditLogTable).values({
      action,
      targetType: targetType || null,
      targetId: targetId || null,
      justification: justification.trim(),
      metadata: metadata || {},
      brandId: brandId || null,
      actorId: userId,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
