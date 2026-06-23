import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { withBrandScope, locationsTable, type Location } from "@workspace/db";
import { requireAuth } from "../../middlewares/auth.js";
import { guardBrand, fail, UUID_RE } from "./_shared.js";

const router: IRouter = Router();
router.use(requireAuth);

/** GET /api/seo/locations?brandId= */
router.get("/", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  try {
    const rows = await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.select(locationsTable, { orderBy: locationsTable.name }),
    );
    res.json({ locations: rows });
  } catch (err) {
    fail(res, req, "locations.list", err);
  }
});

interface LocationBody {
  brandId?: string;
  name?: string;
  countryCode?: string | null;
  region?: string | null;
  city?: string | null;
  dataforseoLocationCode?: number;
  languageCode?: string;
}

/** POST /api/seo/locations */
router.post("/", async (req, res) => {
  const body = (req.body ?? {}) as LocationBody;
  const guard = await guardBrand(req, body.brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  if (!body.name || typeof body.name !== "string") {
    res.status(400).json({ error: "name required" });
    return;
  }
  if (typeof body.dataforseoLocationCode !== "number") {
    res.status(400).json({ error: "dataforseoLocationCode (number) required" });
    return;
  }
  try {
    const rows = (await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.insert(
        locationsTable,
        {
          name: body.name,
          countryCode: body.countryCode ?? null,
          region: body.region ?? null,
          city: body.city ?? null,
          dataforseoLocationCode: body.dataforseoLocationCode,
          languageCode: body.languageCode ?? "en",
        },
        { returning: true },
      ),
    )) as Location[];
    res.status(201).json({ location: rows[0] });
  } catch (err) {
    fail(res, req, "locations.create", err);
  }
});

/** PUT /api/seo/locations/:id */
router.put("/:id", async (req, res) => {
  const id = req.params["id"];
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: "id must be a UUID" });
    return;
  }
  const body = (req.body ?? {}) as LocationBody;
  const guard = await guardBrand(req, body.brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) set["name"] = body.name;
  if (body.countryCode !== undefined) set["countryCode"] = body.countryCode;
  if (body.region !== undefined) set["region"] = body.region;
  if (body.city !== undefined) set["city"] = body.city;
  if (body.dataforseoLocationCode !== undefined)
    set["dataforseoLocationCode"] = body.dataforseoLocationCode;
  if (body.languageCode !== undefined) set["languageCode"] = body.languageCode;
  try {
    await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.update(locationsTable, set, eq(locationsTable.id, id)),
    );
    res.json({ ok: true });
  } catch (err) {
    fail(res, req, "locations.update", err);
  }
});

/** DELETE /api/seo/locations/:id?brandId= */
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
      scoped.delete(locationsTable, eq(locationsTable.id, id)),
    );
    res.json({ ok: true });
  } catch (err) {
    fail(res, req, "locations.delete", err);
  }
});

export default router;
