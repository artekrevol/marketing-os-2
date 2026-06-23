import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import {
  withBrandScope,
  keywordsTable,
  rankSnapshotsTable,
  type Keyword,
} from "@workspace/db";
import { requireAuth } from "../../middlewares/auth.js";
import { guardBrand, fail, UUID_RE } from "./_shared.js";

const router: IRouter = Router();
router.use(requireAuth);

/** GET /api/seo/keywords?brandId=&listId= */
router.get("/", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  const listId = req.query["listId"];
  if (
    listId != null &&
    (typeof listId !== "string" || !UUID_RE.test(listId))
  ) {
    res.status(400).json({ error: "listId must be a UUID" });
    return;
  }
  try {
    const rows = await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.select(keywordsTable, {
        where: listId ? eq(keywordsTable.listId, listId) : undefined,
        orderBy: keywordsTable.keywordText,
      }),
    );
    res.json({ keywords: rows });
  } catch (err) {
    fail(res, req, "keywords.list", err);
  }
});

interface KeywordInput {
  keywordText?: string;
  locationId?: string;
  listId?: string | null;
}

function validateKeywordInput(k: KeywordInput): string | null {
  if (!k.keywordText || typeof k.keywordText !== "string") {
    return "keywordText required";
  }
  if (
    !k.locationId ||
    typeof k.locationId !== "string" ||
    !UUID_RE.test(k.locationId)
  ) {
    return "locationId (UUID) required";
  }
  if (k.listId != null && (typeof k.listId !== "string" || !UUID_RE.test(k.listId))) {
    return "listId must be a UUID";
  }
  return null;
}

/** POST /api/seo/keywords */
router.post("/", async (req, res) => {
  const body = (req.body ?? {}) as KeywordInput & { brandId?: string };
  const guard = await guardBrand(req, body.brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  const invalid = validateKeywordInput(body);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  try {
    const rows = (await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.insert(
        keywordsTable,
        {
          keywordText: body.keywordText,
          locationId: body.locationId,
          listId: body.listId ?? null,
        },
        { returning: true },
      ),
    )) as Keyword[];
    res.status(201).json({ keyword: rows[0] });
  } catch (err) {
    fail(res, req, "keywords.create", err);
  }
});

/** POST /api/seo/keywords/bulk — { brandId, keywords: [...] } */
router.post("/bulk", async (req, res) => {
  const body = (req.body ?? {}) as {
    brandId?: string;
    keywords?: KeywordInput[];
  };
  const guard = await guardBrand(req, body.brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  if (!Array.isArray(body.keywords) || body.keywords.length === 0) {
    res.status(400).json({ error: "keywords[] required" });
    return;
  }
  if (body.keywords.length > 1000) {
    res.status(400).json({ error: "keywords[] capped at 1000 per request" });
    return;
  }
  for (const k of body.keywords) {
    const invalid = validateKeywordInput(k);
    if (invalid) {
      res.status(400).json({ error: `invalid keyword: ${invalid}` });
      return;
    }
  }
  try {
    const rows = (await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.insert(
        keywordsTable,
        body.keywords!.map((k) => ({
          keywordText: k.keywordText,
          locationId: k.locationId,
          listId: k.listId ?? null,
        })),
        { returning: true },
      ),
    )) as Keyword[];
    res.status(201).json({ keywords: rows, inserted: rows.length });
  } catch (err) {
    fail(res, req, "keywords.bulk", err);
  }
});

/** GET /api/seo/keywords/:id?brandId= */
router.get("/:id", async (req, res) => {
  const id = req.params["id"];
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: "id must be a UUID" });
    return;
  }
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  try {
    const rows = (await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.select(keywordsTable, {
        where: eq(keywordsTable.id, id),
        limit: 1,
      }),
    )) as Keyword[];
    if (rows.length === 0) {
      res.status(404).json({ error: "keyword not found" });
      return;
    }
    res.json({ keyword: rows[0] });
  } catch (err) {
    fail(res, req, "keywords.get", err);
  }
});

/** PUT /api/seo/keywords/:id */
router.put("/:id", async (req, res) => {
  const id = req.params["id"];
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: "id must be a UUID" });
    return;
  }
  const body = (req.body ?? {}) as KeywordInput & { brandId?: string };
  const guard = await guardBrand(req, body.brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (body.keywordText !== undefined) set["keywordText"] = body.keywordText;
  if (body.locationId !== undefined) {
    if (typeof body.locationId !== "string" || !UUID_RE.test(body.locationId)) {
      res.status(400).json({ error: "locationId must be a UUID" });
      return;
    }
    set["locationId"] = body.locationId;
  }
  if (body.listId !== undefined) set["listId"] = body.listId;
  try {
    await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.update(keywordsTable, set, eq(keywordsTable.id, id)),
    );
    res.json({ ok: true });
  } catch (err) {
    fail(res, req, "keywords.update", err);
  }
});

/** DELETE /api/seo/keywords/:id?brandId= */
router.delete("/:id", async (req, res) => {
  const id = req.params["id"];
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: "id must be a UUID" });
    return;
  }
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  try {
    await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.delete(keywordsTable, eq(keywordsTable.id, id)),
    );
    res.json({ ok: true });
  } catch (err) {
    fail(res, req, "keywords.delete", err);
  }
});

/** GET /api/seo/keywords/:id/rankings?brandId= — rank history for one keyword */
router.get("/:id/rankings", async (req, res) => {
  const id = req.params["id"];
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: "id must be a UUID" });
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
        where: eq(rankSnapshotsTable.keywordId, id),
        orderBy: desc(rankSnapshotsTable.capturedAt),
        limit: 500,
      }),
    );
    res.json({ rankings: rows });
  } catch (err) {
    fail(res, req, "keywords.rankings", err);
  }
});

export default router;
