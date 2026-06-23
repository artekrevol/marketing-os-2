import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  withBrandScope,
  keywordListsTable,
  type KeywordList,
} from "@workspace/db";
import { requireAuth } from "../../middlewares/auth.js";
import { guardBrand, fail, UUID_RE } from "./_shared.js";

const router: IRouter = Router();
router.use(requireAuth);

/** GET /api/seo/keyword-lists?brandId= */
router.get("/", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  try {
    const rows = await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.select(keywordListsTable, { orderBy: keywordListsTable.name }),
    );
    res.json({ keywordLists: rows });
  } catch (err) {
    fail(res, req, "keyword-lists.list", err);
  }
});

interface ListBody {
  brandId?: string;
  name?: string;
  parentListId?: string | null;
  description?: string | null;
}

/** POST /api/seo/keyword-lists */
router.post("/", async (req, res) => {
  const body = (req.body ?? {}) as ListBody;
  const guard = await guardBrand(req, body.brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  if (!body.name || typeof body.name !== "string") {
    res.status(400).json({ error: "name required" });
    return;
  }
  if (
    body.parentListId != null &&
    (typeof body.parentListId !== "string" || !UUID_RE.test(body.parentListId))
  ) {
    res.status(400).json({ error: "parentListId must be a UUID" });
    return;
  }
  try {
    const rows = (await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.insert(
        keywordListsTable,
        {
          name: body.name,
          parentListId: body.parentListId ?? null,
          description: body.description ?? null,
        },
        { returning: true },
      ),
    )) as KeywordList[];
    res.status(201).json({ keywordList: rows[0] });
  } catch (err) {
    fail(res, req, "keyword-lists.create", err);
  }
});

/** PUT /api/seo/keyword-lists/:id */
router.put("/:id", async (req, res) => {
  const id = req.params["id"];
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: "id must be a UUID" });
    return;
  }
  const body = (req.body ?? {}) as ListBody;
  const guard = await guardBrand(req, body.brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) set["name"] = body.name;
  if (body.parentListId !== undefined) set["parentListId"] = body.parentListId;
  if (body.description !== undefined) set["description"] = body.description;
  try {
    await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.update(keywordListsTable, set, eq(keywordListsTable.id, id)),
    );
    res.json({ ok: true });
  } catch (err) {
    fail(res, req, "keyword-lists.update", err);
  }
});

/** DELETE /api/seo/keyword-lists/:id?brandId= */
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
      scoped.delete(keywordListsTable, eq(keywordListsTable.id, id)),
    );
    res.json({ ok: true });
  } catch (err) {
    fail(res, req, "keyword-lists.delete", err);
  }
});

export default router;
