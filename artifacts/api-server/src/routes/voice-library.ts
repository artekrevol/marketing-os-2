import { Router } from "express";
import { voiceLibraryTable, withBrandScope } from "@workspace/db";
import {
  assertBrandAccessForProject as assertProjectAccess,
  BrandAccessError,
  requireAuth,
} from "../middlewares/auth.js";

const router = Router();

/**
 * POST /api/voice-library
 * Append a human-edited diff for voice learning. Required fields are
 * enforced by the DB; we validate up-front and skip cleanly rather than
 * crashing the request.
 */
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { project_id, original_ai_text, edited_human_text, edit_type, writer_id } = req.body as {
      project_id?: string;
      original_ai_text?: string;
      edited_human_text?: string;
      edit_type?: string;
      writer_id?: string | null;
    };

    if (!project_id || !original_ai_text || !edited_human_text) {
      res.status(400).json({
        ok: false,
        error: "project_id, original_ai_text, and edited_human_text are required",
      });
      return;
    }

    const brandId = await assertProjectAccess(req, project_id);
    await withBrandScope(brandId, ({ scoped }) => scoped.insert(voiceLibraryTable, {
      projectId: project_id,
      brandId,
      originalAiText: original_ai_text,
      editedHumanText: edited_human_text,
      editType: edit_type ?? "inline",
      writerId: writer_id ?? null,
    }));
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof BrandAccessError) {
      res.status(err.status).json({ ok: false, error: err.message });
      return;
    }
    next(err);
  }
});

export default router;
