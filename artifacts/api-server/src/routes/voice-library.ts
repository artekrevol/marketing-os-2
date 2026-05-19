import { Router } from "express";
import { db, voiceLibraryTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

/**
 * POST /api/voice-library
 * Append a human-edited diff for voice learning. Non-fatal, fire-and-forget.
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
    await db.insert(voiceLibraryTable).values({
      projectId: project_id || null,
      brandId: null,
      originalAiText: original_ai_text || null,
      editedHumanText: edited_human_text || null,
      editType: edit_type || "inline",
      writerId: writer_id || null,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
