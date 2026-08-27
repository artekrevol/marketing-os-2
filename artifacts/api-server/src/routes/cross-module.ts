import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  getKeywordContext,
  getContentForKeyword,
  getKeywordsForContent,
  attachKeywordToContent,
  withBrandScope,
  keywordsTable,
  locationsTable,
  projectsTable,
  type Keyword,
  type Location,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";
import { guardBrand, fail, UUID_RE } from "./seo/_shared.js";

/**
 * Cross-module read/write surface — the HTTP face of the Shared Data Layer.
 *
 * Frontends must never import `@workspace/db`, so every cross-module read goes
 * through these routes. The read endpoints return the query helper's
 * `QueryResult<T>` verbatim ({ data, source, reason }) so the client can render
 * <DataSourceTag> and explicit empty states. Brand access is enforced by
 * `guardBrand` (admin OR brand in `user_profiles.brand_access`); the read
 * helpers themselves never throw (DB errors surface as `reason:'system-error'`).
 *
 * Mounted under `/api/cross-module` with `requireAuth` only (NOT
 * `requireSeoRole`): content writers in ContentForge need keyword context too.
 */
const router: IRouter = Router();
router.use(requireAuth);

/**
 * GET /api/cross-module/locations?brandId=
 * Brand locations for the Intake panel. Unlike `/api/seo/locations` this is
 * NOT gated by `requireSeoRole`, so a ContentForge writer without an SEO role
 * can still pick a target location. Returns the minimal id+name shape.
 */
router.get("/locations", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  try {
    const rows = (await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.select(locationsTable, { orderBy: locationsTable.name }),
    )) as Location[];
    res.json({ locations: rows.map((l) => ({ id: l.id, name: l.name })) });
  } catch (err) {
    fail(res, req, "cross-module.locations", err);
  }
});

/** GET /api/cross-module/keyword-context?brandId=&keywordText=&locationId= */
router.get("/keyword-context", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  const keywordText = req.query["keywordText"];
  if (typeof keywordText !== "string" || keywordText.trim() === "") {
    res.status(400).json({ error: "keywordText is required" });
    return;
  }
  const locationId = req.query["locationId"];
  if (locationId != null && (typeof locationId !== "string" || !UUID_RE.test(locationId))) {
    res.status(400).json({ error: "locationId must be a UUID" });
    return;
  }
  if (locationId) {
    const owned = await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.select(locationsTable, {
        where: eq(locationsTable.id, locationId),
        limit: 1,
      }),
    );
    if (!(owned as Location[])[0]) {
      res.status(404).json({ error: "location not found in this brand" });
      return;
    }
  }
  // getKeywordContext never throws — it returns reason:'system-error' on failure.
  const result = await getKeywordContext(
    guard.brandId,
    keywordText.trim(),
    locationId ?? undefined,
  );
  res.json(result);
});

/** GET /api/cross-module/keywords-for-content?brandId=&projectId= */
router.get("/keywords-for-content", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  const projectId = req.query["projectId"];
  if (typeof projectId !== "string" || !UUID_RE.test(projectId)) {
    res.status(400).json({ error: "projectId must be a UUID" });
    return;
  }
  const ownedProject = await withBrandScope(guard.brandId, ({ scoped }) =>
    scoped.select(projectsTable, {
      where: eq(projectsTable.id, projectId),
      limit: 1,
    }),
  );
  if (!(ownedProject as Array<{ id: string }>)[0]) {
    res.status(404).json({ error: "project not found in this brand" });
    return;
  }
  const result = await getKeywordsForContent(guard.brandId, projectId);
  res.json(result);
});

/** GET /api/cross-module/content-for-keyword?brandId=&keywordId= */
router.get("/content-for-keyword", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  const keywordId = req.query["keywordId"];
  if (typeof keywordId !== "string" || !UUID_RE.test(keywordId)) {
    res.status(400).json({ error: "keywordId must be a UUID" });
    return;
  }
  const ownedKeyword = await withBrandScope(guard.brandId, ({ scoped }) =>
    scoped.select(keywordsTable, {
      where: eq(keywordsTable.id, keywordId),
      limit: 1,
    }),
  );
  if (!(ownedKeyword as Keyword[])[0]) {
    res.status(404).json({ error: "keyword not found in this brand" });
    return;
  }
  const result = await getContentForKeyword(guard.brandId, keywordId);
  res.json(result);
});

/**
 * POST /api/cross-module/track-keyword
 * Idempotently ensure a keyword exists in SEO OS so the crawl schedule will
 * pick it up. Used by the ContentForge Intake "Track this keyword" checkbox.
 * Body: { brandId, keywordText, locationId }.
 */
router.post("/track-keyword", async (req, res) => {
  const body = (req.body ?? {}) as {
    brandId?: string;
    keywordText?: string;
    locationId?: string;
  };
  const guard = await guardBrand(req, body.brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  const keywordText = (body.keywordText ?? "").trim();
  if (!keywordText) {
    res.status(400).json({ error: "keywordText is required" });
    return;
  }
  if (typeof body.locationId !== "string" || !UUID_RE.test(body.locationId)) {
    res.status(400).json({ error: "locationId (UUID) is required" });
    return;
  }
  const locationId = body.locationId;
  try {
    const out = await withBrandScope(guard.brandId, async ({ scoped }) => {
      // Tenant isolation: the location must belong to this brand. `scoped`
      // filters by brand_id, so a foreign location id won't be found.
      const ownedLocation = (await scoped.select(locationsTable, {
        where: eq(locationsTable.id, locationId),
        limit: 1,
      })) as Location[];
      if (!ownedLocation[0]) {
        throw new Error(`cross-module: location ${locationId} not found in this brand`);
      }
      const existing = (await scoped.select(keywordsTable, {
        where: and(
          eq(keywordsTable.keywordText, keywordText),
          eq(keywordsTable.locationId, locationId),
        )!,
        limit: 1,
      })) as Keyword[];
      if (existing[0]) return { keywordId: existing[0].id, created: false };
      const inserted = (await scoped.insert(
        keywordsTable,
        { keywordText, locationId },
        { returning: true },
      )) as Keyword[];
      return { keywordId: inserted[0]!.id, created: true };
    });
    res.status(out.created ? 201 : 200).json(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : "track-keyword failed";
    if (message.includes("not found in this brand")) {
      res.status(404).json({ error: message });
      return;
    }
    fail(res, req, "cross-module.track-keyword", err);
  }
});

/**
 * POST /api/cross-module/attach
 * Manually link (or re-target) a keyword to a project. When `isCanonical` is
 * true this is the "wrong target keyword?" override: any existing canonical
 * link on the project is demoted first, then the new one is attached as
 * canonical. Body: { brandId, projectId, keywordText, locationId?, isCanonical? }.
 */
router.post("/attach", async (req, res) => {
  const body = (req.body ?? {}) as {
    brandId?: string;
    projectId?: string;
    keywordText?: string;
    locationId?: string | null;
    isCanonical?: boolean;
  };
  const guard = await guardBrand(req, body.brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  if (typeof body.projectId !== "string" || !UUID_RE.test(body.projectId)) {
    res.status(400).json({ error: "projectId must be a UUID" });
    return;
  }
  const keywordText = (body.keywordText ?? "").trim();
  if (!keywordText) {
    res.status(400).json({ error: "keywordText is required" });
    return;
  }
  if (
    body.locationId != null &&
    (typeof body.locationId !== "string" || !UUID_RE.test(body.locationId))
  ) {
    res.status(400).json({ error: "locationId must be a UUID" });
    return;
  }
  const projectId = body.projectId;
  const isCanonical = body.isCanonical !== false; // default true for an override
  try {
    const ownedProject = await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.select(projectsTable, {
        where: eq(projectsTable.id, projectId),
        limit: 1,
      }),
    );
    if (!(ownedProject as Array<{ id: string }>)[0]) {
      res.status(404).json({ error: "project not found in this brand" });
      return;
    }
    // The helper runs ownership checks, atomic canonical demotion, link
    // (re)attach, counter increment, and provenance all in ONE transaction.
    const out = await attachKeywordToContent(
      guard.brandId,
      projectId,
      keywordText,
      body.locationId ?? null,
      guard.userId,
      isCanonical,
      isCanonical, // demoteExistingCanonical: this is the "wrong target?" override
    );
    res.status(201).json(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : "attach failed";
    // Brand-new keyword with no location to track it in → caller error.
    if (message.includes("cannot be created without a locationId")) {
      res.status(400).json({ error: message });
      return;
    }
    // Foreign project/location id (cross-tenant attempt) → not found in brand.
    if (message.includes("not found in this brand")) {
      res.status(404).json({ error: message });
      return;
    }
    fail(res, req, "cross-module.attach", err);
  }
});

export default router;
