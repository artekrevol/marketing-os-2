import { Router } from "express";
import { db, eventsTable } from "@workspace/db";
import {
  requireAuth,
  assertBrandAccessForProject,
  BrandAccessError,
} from "../middlewares/auth.js";

const router = Router();

/**
 * POST /api/page-events
 * Page-view telemetry from the frontend usePageTracker hook.
 * Stores into the shared events table with eventType="page_view".
 *
 * If a project_id is provided we verify the caller has access to that
 * project's brand — otherwise a writer could pollute another brand's
 * telemetry with fake page_view rows tagged to their projects.
 */
router.post("/", requireAuth, async (req, res, next) => {
  try {
    if (!req.body) { res.json({ ok: true }); return; }
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

    const brandId = project_id
      ? await assertBrandAccessForProject(req, project_id)
      : null;

    const userId = req.auth?.userId ?? null;

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
      brandId,
      scope: brandId ? "brand" : "global",
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
