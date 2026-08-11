import { Router, type IRouter } from "express";
import { eq, desc, inArray, and } from "drizzle-orm";
import {
  db,
  withBrandScope,
  competitorPagesTable,
  keywordsTable,
  type Keyword,
} from "@workspace/db";
import { enqueue } from "@workspace/jobs";
import { requireAuth } from "../../middlewares/auth.js";
import { guardBrand, fail, UUID_RE } from "./_shared.js";

const router: IRouter = Router();
router.use(requireAuth);

/** GET /api/seo/competitor-pages?brandId=&domain= */
router.get("/", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  const domain = req.query["domain"];
  if (domain != null && typeof domain !== "string") {
    res.status(400).json({ error: "domain must be a string" });
    return;
  }
  try {
    const rows = await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.select(competitorPagesTable, {
        where: domain
          ? eq(competitorPagesTable.competitorDomain, domain)
          : undefined,
        orderBy: desc(competitorPagesTable.capturedAt),
        limit: 1000,
      }),
    );
    res.json({ competitorPages: rows });
  } catch (err) {
    fail(res, req, "competitor-pages.list", err);
  }
});

/**
 * POST /api/seo/competitor-pages/discover — { brandId, keywordIds? }
 *
 * Enqueues `seo.competitor.discover` (DataForSEO SERP per keyword —
 * costs money). When `keywordIds` is omitted, the worker discovers
 * across ALL brand keywords; the caller should pass a bounded set for
 * cost control. Returns 202.
 */
router.post("/discover", async (req, res) => {
  const body = (req.body ?? {}) as { brandId?: string; keywordIds?: string[] };
  const guard = await guardBrand(req, body.brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  let keywordIds: string[] | undefined;
  if (body.keywordIds !== undefined) {
    if (
      !Array.isArray(body.keywordIds) ||
      body.keywordIds.some((k) => typeof k !== "string" || !UUID_RE.test(k))
    ) {
      res.status(400).json({ error: "keywordIds must be an array of UUIDs" });
      return;
    }
    keywordIds = body.keywordIds;
  }
  try {
    // Validate the keyword set belongs to this brand before spending.
    if (keywordIds && keywordIds.length > 0) {
      const found = (await withBrandScope(guard.brandId, ({ scoped }) =>
        scoped.select(keywordsTable, {
          where: inArray(keywordsTable.id, keywordIds!),
        }),
      )) as Keyword[];
      if (found.length !== keywordIds.length) {
        res.status(400).json({ error: "one or more keywordIds not found for brand" });
        return;
      }
    }
    const { jobId } = await enqueue("seo.competitor.discover", {
      brandId: guard.brandId,
      ...(keywordIds ? { keywordIds } : {}),
      idempotencyKey: `seo-competitor-discover:${guard.brandId}-${Date.now()}`,
    });
    res.status(202).json({ ok: true, status: "queued", jobId });
  } catch (err) {
    fail(res, req, "competitor-pages.discover", err);
  }
});

/**
 * DELETE /api/seo/competitor-pages/:id?brandId=
 *
 * Removes a single competitor page from the brand's dataset.
 * Scoped to the requesting brand — cannot delete another brand's rows.
 */
router.delete("/:id", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  const { id } = req.params;
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: "id must be a UUID" });
    return;
  }
  try {
    await db
      .delete(competitorPagesTable)
      .where(
        and(
          eq(competitorPagesTable.id, id),
          eq(competitorPagesTable.brandId, guard.brandId),
        ),
      );
    res.json({ ok: true });
  } catch (err) {
    fail(res, req, "competitor-pages.delete", err);
  }
});

export default router;
