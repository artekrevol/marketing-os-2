import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  submitForReview,
  decide,
  getReviewDetail,
  listReviewerQueue,
  callerHasBrandAccess,
  ContentObjectNotFoundError,
  InvalidTransitionError,
  MissingCommentError,
} from "@workspace/quality-gate";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
router.use(requireAuth);

/**
 * The seo-os UI expects a stable cross-cut contract: snake_case fields,
 * `passed/failed/null` (boolean) for check outcomes, and a derived
 * `qa_run.status` of `'queued'|'running'|'completed'|'failed'|'error'`
 * (with `passed → completed` because UX talks about "checks completed",
 * not "checks passed"). The service layer keeps the DB-native names
 * (passed/failed/error/severity:hard) — this route is the boundary
 * that maps to the UI's vocabulary.
 */
function mapRunStatus(s: string | null): string | null {
  if (s == null) return null;
  if (s === "passed") return "completed";
  return s;
}
function mapSeverity(s: string): "hard_fail" | "warn" | "info" {
  if (s === "hard") return "hard_fail";
  if (s === "warn") return "warn";
  return "info";
}
function mapPassed(outcome: string): boolean | null {
  if (outcome === "pass") return true;
  if (outcome === "fail") return false;
  return null; // 'error' or unknown
}

interface AuthedReq {
  auth?: { userId: string };
  body: unknown;
  query: Record<string, unknown>;
  params: Record<string, string>;
  log: { error: (...args: unknown[]) => void };
}
interface AuthedRes {
  status: (code: number) => { json: (b: unknown) => void };
  json: (b: unknown) => void;
}

async function ensureBrandAccess(
  req: { auth?: { userId: string } },
  brandId: string | undefined,
): Promise<
  | { ok: true; userId: string; brandId: string }
  | { ok: false; status: number; error: string }
> {
  if (!req.auth) return { ok: false, status: 401, error: "unauthenticated" };
  if (!brandId || typeof brandId !== "string") {
    return { ok: false, status: 400, error: "brandId required" };
  }
  const has = await callerHasBrandAccess(brandId, req.auth.userId);
  if (!has) return { ok: false, status: 403, error: "no access to this brand" };
  return { ok: true, userId: req.auth.userId, brandId };
}

/** POST /api/quality-gate/submit  → kicks off a qa_run. */
router.post("/submit", async (req, res) => {
  const { brandId, contentObjectId } = (req.body ?? {}) as Record<string, string>;
  const guard = await ensureBrandAccess(req, brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  try {
    const { qaRunId, idempotencyKey } = await submitForReview({
      contentObjectId,
      actorId: guard.userId,
      brandId: guard.brandId,
    });
    res.status(202).json({ qaRunId, idempotencyKey });
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      res.status(409).json({ error: "invalid_transition", message: err.message });
      return;
    }
    if (err instanceof ContentObjectNotFoundError) {
      res.status(404).json({ error: "not_found", message: err.message });
      return;
    }
    req.log.error({ err }, "quality-gate: submit failed");
    res.status(500).json({ error: "internal_error", message: (err as Error).message });
  }
});

/** POST /api/quality-gate/decide  → reviewer decision. */
router.post("/decide", async (req, res) => {
  const { brandId, contentObjectId, decision, comment } = (req.body ?? {}) as Record<
    string,
    string
  >;
  const guard = await ensureBrandAccess(req, brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  if (decision !== "approved" && decision !== "rejected") {
    res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
    return;
  }
  try {
    const result = await decide({
      contentObjectId,
      reviewerId: guard.userId,
      brandId: guard.brandId,
      decision,
      comment,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof MissingCommentError) {
      res.status(400).json({ error: "comment_required", message: err.message });
      return;
    }
    if (err instanceof InvalidTransitionError) {
      res.status(409).json({ error: "invalid_transition", message: err.message });
      return;
    }
    if (err instanceof ContentObjectNotFoundError) {
      res.status(404).json({ error: "not_found", message: err.message });
      return;
    }
    req.log.error({ err }, "quality-gate: decide failed");
    res.status(500).json({ error: "internal_error", message: (err as Error).message });
  }
});

/** GET /api/quality-gate/queue?brandId=… */
router.get("/queue", async (req, res) => {
  const brandId = typeof req.query["brandId"] === "string" ? req.query["brandId"] : undefined;
  const guard = await ensureBrandAccess(req, brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  try {
    const rows = await listReviewerQueue(guard.brandId);
    const items = rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      word_count: r.wordCount,
      updated_at: r.updatedAt,
      qa_run: r.qaRunId
        ? {
            id: r.qaRunId,
            status: mapRunStatus(r.qaStatus),
            started_at: r.qaStartedAt,
            finished_at: r.qaCompletedAt,
          }
        : null,
    }));
    res.json({ items });
  } catch (err) {
    req.log.error({ err }, "quality-gate: queue failed");
    res.status(500).json({ error: "internal_error", message: (err as Error).message });
  }
});

/** GET /api/quality-gate/review?contentObjectId=&brandId= */
async function reviewDetailHandler(
  req: AuthedReq,
  res: AuthedRes,
  contentObjectId: string | undefined,
) {
  const brandId =
    typeof req.query["brandId"] === "string" ? (req.query["brandId"] as string) : undefined;
  const guard = await ensureBrandAccess(req, brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  if (!contentObjectId) {
    res.status(400).json({ error: "contentObjectId required" });
    return;
  }
  try {
    const detail = await getReviewDetail(guard.brandId, contentObjectId);
    if (!detail) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const o = detail.object;
    const r = detail.qaRun;
    res.json({
      contentObject: {
        id: o.id,
        brand_id: o.brandId,
        project_id: o.projectId,
        draft_id: o.draftId,
        title: o.title,
        body_md: o.bodyMd,
        word_count: o.wordCount,
        status: o.status,
        submitted_at: o.submittedAt ? o.submittedAt.toISOString() : null,
        decided_at: o.decidedAt ? o.decidedAt.toISOString() : null,
        submitted_by: o.submittedBy,
        decided_by: o.decidedBy,
      },
      qaRun: r
        ? {
            id: r.id,
            status: mapRunStatus(r.status) ?? r.status,
            started_at: r.startedAt ? r.startedAt.toISOString() : null,
            finished_at: r.completedAt ? r.completedAt.toISOString() : null,
            summary: (r.summary as Record<string, unknown> | null) ?? null,
          }
        : null,
      checks: detail.checks.map((c) => ({
        id: c.id,
        qa_run_id: c.qaRunId,
        check_key: c.checkName,
        severity: mapSeverity(c.severity),
        passed: mapPassed(c.outcome),
        threshold: c.threshold == null ? null : Number(c.threshold),
        observed: c.score == null ? null : Number(c.score),
        details: (c.details as Record<string, unknown> | null) ?? null,
        created_at: c.completedAt.toISOString(),
      })),
      signoffs: detail.signoffs.map((s) => ({
        id: s.id,
        decision: s.decision,
        comment: s.comment,
        reviewer_id: s.reviewerId,
        decided_at: s.createdAt.toISOString(),
      })),
      overrides: detail.overrides.map((ov) => ({
        id: ov.id,
        check_key: ov.checkName,
        reason: ov.justification,
        overrider_id: ov.overriddenBy,
        created_at: ov.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "quality-gate: review detail failed");
    res.status(500).json({ error: "internal_error", message: (err as Error).message });
  }
}

router.get("/review", async (req, res) => {
  const id =
    typeof req.query["contentObjectId"] === "string"
      ? (req.query["contentObjectId"] as string)
      : undefined;
  await reviewDetailHandler(req, res, id);
});

// Back-compat alias.
router.get("/review/:id", async (req, res) => {
  await reviewDetailHandler(req, res, req.params["id"]);
});

/** POST /api/quality-gate/start-from-draft  (ContentForge convenience). */
router.post("/start-from-draft", async (req, res) => {
  const { brandId, projectId } = (req.body ?? {}) as Record<string, string>;
  const guard = await ensureBrandAccess(req, brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }
  try {
    const result = (await db.execute(
      sql`with latest as (
            select id, body_md, word_count
              from public.drafts
             where project_id = ${projectId}::uuid
               and brand_id   = ${guard.brandId}::uuid
             order by updated_at desc nulls last, created_at desc
             limit 1
          ),
          existing as (
            select id from public.content_objects
             where project_id = ${projectId}::uuid
               and brand_id   = ${guard.brandId}::uuid
               and status     = 'drafting'
             order by created_at desc
             limit 1
          ),
          inserted as (
            insert into public.content_objects (brand_id, project_id, draft_id, title, body_md, word_count)
            select ${guard.brandId}::uuid,
                   ${projectId}::uuid,
                   l.id,
                   coalesce((select topic from public.projects where id = ${projectId}::uuid), ''),
                   coalesce(l.body_md, ''),
                   coalesce(l.word_count, 0)
              from latest l
             where not exists (select 1 from existing)
            returning id
          )
          select id, 'created'::text as source from inserted
          union all
          select id, 'reused'::text  as source from existing`,
    )) as unknown as { rows?: Array<{ id: string; source: string }> };
    const rows = (result.rows ?? []) as Array<{ id: string; source: string }>;
    const row = rows[0];
    if (!row) {
      res.status(404).json({ error: "no_draft", message: "Project has no draft yet" });
      return;
    }
    res
      .status(row.source === "created" ? 201 : 200)
      .json({ contentObjectId: row.id, source: row.source });
  } catch (err) {
    req.log.error({ err }, "quality-gate: start-from-draft failed");
    res.status(500).json({ error: "internal_error", message: (err as Error).message });
  }
});

export default router;
