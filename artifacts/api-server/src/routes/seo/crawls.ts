import { Router, type IRouter } from "express";
import { eq, desc, inArray, sql } from "drizzle-orm";
import {
  withBrandScope,
  crawlBatchesTable,
  keywordsTable,
  rankSnapshotsTable,
  type Keyword,
  type CrawlBatch,
} from "@workspace/db";
import { enqueue } from "@workspace/jobs";
import { requireAuth } from "../../middlewares/auth.js";
import { guardBrand, fail, UUID_RE } from "./_shared.js";

const router: IRouter = Router();
router.use(requireAuth);

/**
 * POST /api/seo/crawls — { brandId, keywordIds? }
 *
 * Creates a `crawl_batches` row and enqueues `seo.crawl.run` (DataForSEO
 * SERP per keyword — costs money). When `keywordIds` is omitted, the
 * batch covers ALL brand keywords; pass a bounded set for cost control.
 * Returns 202 with the batch id.
 */
router.post("/", async (req, res) => {
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
    const prepared = await withBrandScope(guard.brandId, async ({ scoped }) => {
      const keywords = (await scoped.select(keywordsTable, {
        where: keywordIds?.length
          ? inArray(keywordsTable.id, keywordIds)
          : undefined,
      })) as Keyword[];
      if (keywords.length === 0) return null;
      // If an explicit set was given, every id must resolve for the brand.
      if (keywordIds && keywords.length !== keywordIds.length) {
        return { mismatch: true as const };
      }
      const inserted = (await scoped.insert(
        crawlBatchesTable,
        {
          status: "pending",
          keywordCount: keywords.length,
        },
        { returning: true },
      )) as CrawlBatch[];
      return {
        batchId: inserted[0]!.id,
        keywordIds: keywords.map((k) => k.id),
      };
    });

    if (!prepared) {
      res.status(400).json({ error: "no keywords to crawl" });
      return;
    }
    if ("mismatch" in prepared) {
      res.status(400).json({ error: "one or more keywordIds not found for brand" });
      return;
    }

    await enqueue("seo.crawl.run", {
      brandId: guard.brandId,
      batchId: prepared.batchId,
      keywordIds: prepared.keywordIds,
      idempotencyKey: `seo-crawl:${prepared.batchId}`,
    });

    res.status(202).json({
      ok: true,
      status: "queued",
      batchId: prepared.batchId,
      keywordCount: prepared.keywordIds.length,
    });
  } catch (err) {
    fail(res, req, "crawls.create", err);
  }
});

/** GET /api/seo/crawls/status?brandId= — recent batches, newest first */
router.get("/status", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  try {
    const rows = await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.select(crawlBatchesTable, {
        orderBy: desc(crawlBatchesTable.createdAt),
        limit: 50,
      }),
    );
    res.json({ batches: rows });
  } catch (err) {
    fail(res, req, "crawls.status", err);
  }
});

/** GET /api/seo/crawls/results/:batchId?brandId= — snapshots for a batch */
router.get("/results/:batchId", async (req, res) => {
  const batchId = req.params["batchId"];
  if (!batchId || !UUID_RE.test(batchId)) {
    res.status(400).json({ error: "batchId must be a UUID" });
    return;
  }
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  try {
    const rows = await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.select(rankSnapshotsTable, {
        where: eq(rankSnapshotsTable.batchId, batchId),
        orderBy: desc(rankSnapshotsTable.capturedAt),
        limit: 2000,
      }),
    );
    res.json({ results: rows });
  } catch (err) {
    fail(res, req, "crawls.results", err);
  }
});

/**
 * POST /api/seo/crawls/reset — { brandId, batchId }
 *
 * Marks a stuck `pending`/`running` batch as failed. Does NOT re-bill
 * DataForSEO — it only releases the batch from a hung state so the UI
 * stops showing it as in-flight.
 */
router.post("/reset", async (req, res) => {
  const body = (req.body ?? {}) as { brandId?: string; batchId?: string };
  const guard = await guardBrand(req, body.brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  if (!body.batchId || !UUID_RE.test(body.batchId)) {
    res.status(400).json({ error: "batchId must be a UUID" });
    return;
  }
  try {
    await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.update(
        crawlBatchesTable,
        {
          status: "failed",
          finishedAt: new Date(),
          errorMessage: "manually reset",
        },
        sql`${crawlBatchesTable.id} = ${body.batchId} and ${crawlBatchesTable.status} in ('pending','running')`,
      ),
    );
    res.json({ ok: true });
  } catch (err) {
    fail(res, req, "crawls.reset", err);
  }
});

export default router;
