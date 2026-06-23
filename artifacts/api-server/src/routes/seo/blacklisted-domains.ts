import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  withBrandScope,
  blacklistedDomainsTable,
  type BlacklistedDomain,
} from "@workspace/db";
import { requireAuth } from "../../middlewares/auth.js";
import { guardBrand, fail, UUID_RE } from "./_shared.js";

const router: IRouter = Router();
router.use(requireAuth);

/** GET /api/seo/blacklisted-domains?brandId= */
router.get("/", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  try {
    const rows = await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.select(blacklistedDomainsTable, {
        orderBy: blacklistedDomainsTable.domain,
      }),
    );
    res.json({ blacklistedDomains: rows });
  } catch (err) {
    fail(res, req, "blacklisted-domains.list", err);
  }
});

/** POST /api/seo/blacklisted-domains — { brandId, domain, reason? } */
router.post("/", async (req, res) => {
  const body = (req.body ?? {}) as {
    brandId?: string;
    domain?: string;
    reason?: string | null;
  };
  const guard = await guardBrand(req, body.brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  if (!body.domain || typeof body.domain !== "string") {
    res.status(400).json({ error: "domain required" });
    return;
  }
  const domain = body.domain.trim().toLowerCase().replace(/^www\./, "");
  try {
    const rows = (await withBrandScope(guard.brandId, ({ scoped }) =>
      scoped.insert(
        blacklistedDomainsTable,
        { domain, reason: body.reason ?? null },
        { returning: true },
      ),
    )) as BlacklistedDomain[];
    res.status(201).json({ blacklistedDomain: rows[0] });
  } catch (err) {
    fail(res, req, "blacklisted-domains.create", err);
  }
});

/** DELETE /api/seo/blacklisted-domains/:id?brandId= */
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
      scoped.delete(blacklistedDomainsTable, eq(blacklistedDomainsTable.id, id)),
    );
    res.json({ ok: true });
  } catch (err) {
    fail(res, req, "blacklisted-domains.delete", err);
  }
});

export default router;
