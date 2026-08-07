/**
 * Competitor Curation API — /api/seo/competitor-curation
 *
 * Allows admin + lead users to curate the competitor_insights set:
 * mark competitors as relevant/irrelevant, provide exclusion reasons,
 * and bulk-mark a selection as irrelevant.
 *
 * Access: Admin + Lead only.
 */
import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { withBrandScope } from "@workspace/db";
import { requireAuth } from "../../middlewares/auth.js";
import { guardBrand, requireAdminOrLead, UUID_RE, fail } from "./_shared.js";

const router: IRouter = Router();
router.use(requireAuth);

type FilterValue = "all" | "relevant" | "irrelevant" | "never_reviewed";
const VALID_FILTERS = new Set<FilterValue>(["all", "relevant", "irrelevant", "never_reviewed"]);

/**
 * GET /api/seo/competitor-curation?brandId=&filter=all
 *
 * Returns all competitor_insights rows for the brand with curation fields,
 * sorted by shared_keyword_count DESC.
 * filter: all | relevant | irrelevant | never_reviewed
 */
router.get("/", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const roleCheck = requireAdminOrLead(req, res);
  if (!roleCheck) return;

  const rawFilter = req.query["filter"] as string | undefined;
  const filter: FilterValue =
    rawFilter && VALID_FILTERS.has(rawFilter as FilterValue)
      ? (rawFilter as FilterValue)
      : "all";

  const filterClause =
    filter === "relevant"       ? sql`AND is_relevant_competitor = true` :
    filter === "irrelevant"     ? sql`AND is_relevant_competitor = false` :
    filter === "never_reviewed" ? sql`AND last_reviewed_at IS NULL` :
    sql``;

  try {
    const rows = await withBrandScope(guard.brandId, async ({ db }) => {
      const result = (await db.execute(sql`
        SELECT
          id,
          competitor_domain,
          shared_keyword_count,
          ahrefs_domain_rating,
          ahrefs_keywords_common,
          is_relevant_competitor,
          exclusion_reason,
          last_reviewed_at,
          last_reviewed_by,
          last_computed_at,
          created_at
        FROM competitor_insights
        WHERE brand_id = ${guard.brandId}::uuid
          ${filterClause}
        ORDER BY shared_keyword_count DESC NULLS LAST
      `)) as unknown as { rows?: unknown[] } | unknown[];
      return Array.isArray(result) ? result : (result.rows ?? []);
    });

    res.json({ competitors: rows, filter });
  } catch (err) {
    fail(res, req, "competitor-curation.list", err);
  }
});

/**
 * PUT /api/seo/competitor-curation/:id
 *
 * Update relevance flag and/or exclusion reason for a single competitor.
 * Body: { brandId, isRelevantCompetitor: boolean, exclusionReason?: string | null }
 *
 * Auto-populates last_reviewed_at = now(), last_reviewed_by = caller's userId.
 * When marking as relevant, clears exclusion_reason (unless explicitly provided).
 */
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "id must be a UUID" }); return;
  }

  const body = (req.body ?? {}) as {
    brandId?: string;
    isRelevantCompetitor?: boolean;
    exclusionReason?: string | null;
  };

  const guard = await guardBrand(req, body.brandId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const roleCheck = requireAdminOrLead(req, res);
  if (!roleCheck) return;

  if (typeof body.isRelevantCompetitor !== "boolean") {
    res.status(400).json({ error: "isRelevantCompetitor (boolean) required" }); return;
  }

  const isRelevant = body.isRelevantCompetitor;
  // When marking relevant, clear exclusion_reason unless caller explicitly provides one.
  const exclusionReason =
    body.exclusionReason !== undefined
      ? (body.exclusionReason ?? null)
      : isRelevant
        ? null // clear on relevance restoration
        : undefined; // keep existing if not provided when marking irrelevant

  try {
    await withBrandScope(guard.brandId, async ({ db }) => {
      if (exclusionReason !== undefined) {
        await db.execute(sql`
          UPDATE competitor_insights
          SET
            is_relevant_competitor = ${isRelevant},
            exclusion_reason       = ${exclusionReason},
            last_reviewed_at       = now(),
            last_reviewed_by       = ${guard.userId}
          WHERE id = ${id}::uuid
            AND brand_id = ${guard.brandId}::uuid
        `);
      } else {
        await db.execute(sql`
          UPDATE competitor_insights
          SET
            is_relevant_competitor = ${isRelevant},
            last_reviewed_at       = now(),
            last_reviewed_by       = ${guard.userId}
          WHERE id = ${id}::uuid
            AND brand_id = ${guard.brandId}::uuid
        `);
      }
    });

    res.json({ ok: true, id, isRelevantCompetitor: isRelevant });
  } catch (err) {
    fail(res, req, "competitor-curation.update", err);
  }
});

/**
 * POST /api/seo/competitor-curation/bulk-mark-irrelevant
 *
 * Mark multiple competitors as irrelevant with a shared reason.
 * Body: { brandId, ids: string[], exclusionReason: string }
 */
router.post("/bulk-mark-irrelevant", async (req, res) => {
  const body = (req.body ?? {}) as {
    brandId?: string;
    ids?: unknown;
    exclusionReason?: string;
  };

  const guard = await guardBrand(req, body.brandId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const roleCheck = requireAdminOrLead(req, res);
  if (!roleCheck) return;

  const ids = Array.isArray(body.ids)
    ? (body.ids as unknown[]).filter((id): id is string => typeof id === "string" && UUID_RE.test(id))
    : [];
  if (ids.length === 0) {
    res.status(400).json({ error: "ids must be a non-empty array of UUIDs" }); return;
  }
  if (ids.length > 100) {
    res.status(400).json({ error: "Maximum 100 competitors per bulk action" }); return;
  }

  const exclusionReason =
    typeof body.exclusionReason === "string" && body.exclusionReason.trim().length > 0
      ? body.exclusionReason.trim()
      : null;

  try {
    let updated = 0;
    await withBrandScope(guard.brandId, async ({ db }) => {
      const result = (await db.execute(sql`
        UPDATE competitor_insights
        SET
          is_relevant_competitor = false,
          exclusion_reason       = ${exclusionReason},
          last_reviewed_at       = now(),
          last_reviewed_by       = ${guard.userId}
        WHERE brand_id = ${guard.brandId}::uuid
          AND id = ANY(${ids}::uuid[])
      `)) as unknown as { rowCount?: number };
      updated = result.rowCount ?? 0;
    });

    res.json({ ok: true, updated });
  } catch (err) {
    fail(res, req, "competitor-curation.bulk-mark-irrelevant", err);
  }
});

export default router;
