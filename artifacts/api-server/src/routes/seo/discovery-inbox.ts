/**
 * Discovery Inbox API — /api/seo/discovery-inbox
 *
 * Lists keyword discovery candidates (is_discovery_candidate = true) for
 * human review, and exposes promote/reject/archive review actions.
 *
 * Access: Admin + Lead only (not reviewer). See requireAdminOrLead below.
 */
import { Router, type IRouter } from "express";
import { sql, and, eq } from "drizzle-orm";
import { withBrandScope, keywordsTable } from "@workspace/db";
import { requireAuth } from "../../middlewares/auth.js";
import { guardBrand, requireAdminOrLead, fail } from "./_shared.js";

const router: IRouter = Router();
router.use(requireAuth);

const VALID_REVIEW_STATUSES = new Set(["pending", "promoted", "rejected", "archived"]);

/**
 * GET /api/seo/discovery-inbox?brandId=&status=pending
 *
 * Returns discovery candidates for the brand, optionally filtered by
 * candidate_review_status. Default: returns all statuses.
 * Ordered: pending first (discovered_at ASC), then others by reviewed_at DESC.
 */
router.get("/", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const roleCheck = requireAdminOrLead(req, res);
  if (!roleCheck) return;

  const rawStatus = req.query["status"];
  const statusFilter =
    typeof rawStatus === "string" && VALID_REVIEW_STATUSES.has(rawStatus)
      ? rawStatus
      : null;

  try {
    const rows = await withBrandScope(guard.brandId, async ({ db }) => {
      const result = (await db.execute(sql`
        SELECT
          id,
          keyword_text,
          discovery_seed_keyword,
          candidate_review_status,
          candidate_reviewed_at,
          candidate_reviewed_by,
          discovered_at,
          search_volume,
          difficulty,
          ahrefs_keyword_difficulty,
          ahrefs_sum_traffic,
          priority,
          is_branded
        FROM keywords
        WHERE brand_id = ${guard.brandId}::uuid
          AND is_discovery_candidate = true
          ${statusFilter != null ? sql`AND candidate_review_status = ${statusFilter}` : sql``}
        ORDER BY
          CASE WHEN candidate_review_status = 'pending' THEN 0 ELSE 1 END ASC,
          CASE WHEN candidate_review_status = 'pending' THEN discovered_at END ASC,
          candidate_reviewed_at DESC NULLS LAST
        LIMIT 1000
      `)) as unknown as { rows?: unknown[] } | unknown[];
      return Array.isArray(result) ? result : (result.rows ?? []);
    });

    res.json({ candidates: rows });
  } catch (err) {
    fail(res, req, "discovery-inbox.list", err);
  }
});

/**
 * POST /api/seo/discovery-inbox/review
 *
 * Review a single discovery candidate.
 * Body: { brandId, keywordId, decision: "promoted"|"rejected"|"archived" }
 *
 * Writes candidate_review_status, candidate_reviewed_at, candidate_reviewed_by.
 * On "promoted", also sets is_discovery_candidate = false (keyword enters
 * the normal tracked set) and priority = "P2" if not already set.
 */
router.post("/review", async (req, res) => {
  const body = (req.body ?? {}) as {
    brandId?: string;
    keywordId?: string;
    decision?: string;
  };

  const guard = await guardBrand(req, body.brandId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const roleCheck = requireAdminOrLead(req, res);
  if (!roleCheck) return;

  const { keywordId, decision } = body;
  if (!keywordId || typeof keywordId !== "string") {
    res.status(400).json({ error: "keywordId required" }); return;
  }
  if (!decision || !VALID_REVIEW_STATUSES.has(decision) || decision === "pending") {
    res.status(400).json({ error: "decision must be promoted, rejected, or archived" }); return;
  }

  try {
    await withBrandScope(guard.brandId, async ({ db }) => {
      if (decision === "promoted") {
        await db.execute(sql`
          UPDATE keywords
          SET
            candidate_review_status = 'promoted',
            candidate_reviewed_at   = now(),
            candidate_reviewed_by   = ${guard.userId},
            is_discovery_candidate  = false,
            priority                = COALESCE(priority, 'P2'),
            is_active               = true
          WHERE id = ${keywordId}::uuid
            AND brand_id = ${guard.brandId}::uuid
            AND is_discovery_candidate = true
        `);
      } else {
        await db.execute(sql`
          UPDATE keywords
          SET
            candidate_review_status = ${decision},
            candidate_reviewed_at   = now(),
            candidate_reviewed_by   = ${guard.userId}
          WHERE id = ${keywordId}::uuid
            AND brand_id = ${guard.brandId}::uuid
            AND is_discovery_candidate = true
        `);
      }
    });

    res.json({ ok: true, keywordId, decision });
  } catch (err) {
    fail(res, req, "discovery-inbox.review", err);
  }
});

/**
 * POST /api/seo/discovery-inbox/review-bulk
 *
 * Bulk-review multiple discovery candidates with the same decision.
 * Body: { brandId, keywordIds: string[], decision: "promoted"|"rejected"|"archived" }
 */
router.post("/review-bulk", async (req, res) => {
  const body = (req.body ?? {}) as {
    brandId?: string;
    keywordIds?: unknown;
    decision?: string;
  };

  const guard = await guardBrand(req, body.brandId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const roleCheck = requireAdminOrLead(req, res);
  if (!roleCheck) return;

  const { decision } = body;
  if (!decision || !VALID_REVIEW_STATUSES.has(decision) || decision === "pending") {
    res.status(400).json({ error: "decision must be promoted, rejected, or archived" }); return;
  }

  const ids = Array.isArray(body.keywordIds)
    ? (body.keywordIds as unknown[]).filter((id): id is string => typeof id === "string")
    : [];
  if (ids.length === 0) {
    res.status(400).json({ error: "keywordIds must be a non-empty array of strings" }); return;
  }
  if (ids.length > 500) {
    res.status(400).json({ error: "Maximum 500 keywords per bulk review" }); return;
  }

  try {
    let updated = 0;
    await withBrandScope(guard.brandId, async ({ db }) => {
      if (decision === "promoted") {
        const result = (await db.execute(sql`
          UPDATE keywords
          SET
            candidate_review_status = 'promoted',
            candidate_reviewed_at   = now(),
            candidate_reviewed_by   = ${guard.userId},
            is_discovery_candidate  = false,
            priority                = COALESCE(priority, 'P2'),
            is_active               = true
          WHERE brand_id = ${guard.brandId}::uuid
            AND is_discovery_candidate = true
            AND id = ANY(${ids}::uuid[])
        `)) as unknown as { rowCount?: number };
        updated = result.rowCount ?? 0;
      } else {
        const result = (await db.execute(sql`
          UPDATE keywords
          SET
            candidate_review_status = ${decision},
            candidate_reviewed_at   = now(),
            candidate_reviewed_by   = ${guard.userId}
          WHERE brand_id = ${guard.brandId}::uuid
            AND is_discovery_candidate = true
            AND id = ANY(${ids}::uuid[])
        `)) as unknown as { rowCount?: number };
        updated = result.rowCount ?? 0;
      }
    });

    res.json({ ok: true, updated, decision });
  } catch (err) {
    fail(res, req, "discovery-inbox.review-bulk", err);
  }
});

export default router;
