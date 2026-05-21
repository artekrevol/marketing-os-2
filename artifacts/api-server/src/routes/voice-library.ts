import { Router } from "express";
import { db, voiceLibraryTable, projectsTable, userProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

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

    const project = await db
      .select({ brandId: projectsTable.brandId })
      .from(projectsTable)
      .where(eq(projectsTable.id, project_id))
      .limit(1);
    const brandId = project[0]?.brandId;
    if (!brandId) {
      res.status(404).json({ ok: false, error: "project not found" });
      return;
    }

    // Authorization: only admins or users with brand_access to this brand
    // may write voice-library rows for the project.
    if (!req.auth?.isAdmin) {
      const accessRows = await db
        .select({ brandAccess: userProfilesTable.brandAccess })
        .from(userProfilesTable)
        .where(eq(userProfilesTable.userId, req.auth!.userId))
        .limit(1);
      const accessible = accessRows[0]?.brandAccess ?? [];
      if (!accessible.includes(brandId)) {
        res.status(403).json({ ok: false, error: "forbidden" });
        return;
      }
    }

    await db.insert(voiceLibraryTable).values({
      projectId: project_id,
      brandId,
      originalAiText: original_ai_text,
      editedHumanText: edited_human_text,
      editType: edit_type ?? "inline",
      writerId: writer_id ?? null,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
