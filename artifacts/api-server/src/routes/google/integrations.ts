import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { guardedDb } from "@workspace/db";
import { requireAuth } from "../../middlewares/auth.js";
import { guardBrand, requireAdminOrLead } from "../seo/_shared.js";
import {
  listBusinessProfileAccounts,
  listBusinessProfileLocations,
  listGa4Properties,
} from "./google-client.js";
import {
  ensureFreshGoogleToken,
  loadGoogleConnection,
} from "./google-connection.js";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/ga4/properties", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }

  try {
    const connection = await loadGoogleConnection(guard.brandId);
    if (!connection) {
      res.status(404).json({ error: "Google account not connected for this brand" });
      return;
    }
    const properties = await listGa4Properties(await ensureFreshGoogleToken(connection));
    res.json({ properties });
  } catch (err) {
    req.log.error({ err }, "google: GA4 property discovery failed");
    res.status(502).json({
      error: "Failed to list GA4 properties",
      message: "Google Analytics could not be reached. Check that the connected account has Analytics access.",
    });
  }
});

router.post("/ga4/property", async (req, res) => {
  if (!requireAdminOrLead(req, res)) return;
  const { brandId, propertyId } = req.body as {
    brandId?: string;
    propertyId?: string;
  };
  const guard = await guardBrand(req, brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  if (!propertyId || !/^\d{1,30}$/.test(propertyId)) {
    res.status(400).json({ error: "propertyId must be a numeric GA4 property ID" });
    return;
  }

  try {
    await guardedDb.execute(sql`
      UPDATE google_brand_connections
      SET ga4_property_id = ${propertyId}, updated_at = now()
      WHERE brand_id = ${guard.brandId}::uuid
    `);
    res.json({ ok: true, ga4PropertyId: propertyId });
  } catch (err) {
    req.log.error({ err }, "google: GA4 property save failed");
    res.status(500).json({ error: "Failed to save GA4 property" });
  }
});

router.get("/business-profile/accounts", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }

  try {
    const connection = await loadGoogleConnection(guard.brandId);
    if (!connection) {
      res.status(404).json({ error: "Google account not connected for this brand" });
      return;
    }
    const accounts = await listBusinessProfileAccounts(
      await ensureFreshGoogleToken(connection),
    );
    res.json({ accounts });
  } catch (err) {
    req.log.error({ err }, "google: Business Profile account discovery failed");
    res.status(502).json({
      error: "Failed to list Business Profile accounts",
      message: "Business Profile could not be reached. Check that the connected account manages a profile.",
    });
  }
});

router.get("/business-profile/locations", async (req, res) => {
  const guard = await guardBrand(req, req.query["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  const accountName = req.query["accountName"];
  if (typeof accountName !== "string" || !/^accounts\/[A-Za-z0-9_-]+$/.test(accountName)) {
    res.status(400).json({ error: "Valid Business Profile accountName required" });
    return;
  }

  try {
    const connection = await loadGoogleConnection(guard.brandId);
    if (!connection) {
      res.status(404).json({ error: "Google account not connected for this brand" });
      return;
    }
    const locations = await listBusinessProfileLocations(
      await ensureFreshGoogleToken(connection),
      accountName,
    );
    res.json({ locations });
  } catch (err) {
    req.log.error({ err }, "google: Business Profile location discovery failed");
    res.status(502).json({
      error: "Failed to list Business Profile locations",
      message: "Business Profile locations could not be loaded for this account.",
    });
  }
});

router.post("/business-profile/selection", async (req, res) => {
  if (!requireAdminOrLead(req, res)) return;
  const { brandId, accountName, locationNames } = req.body as {
    brandId?: string;
    accountName?: string | null;
    locationNames?: string[];
  };
  const guard = await guardBrand(req, brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  if (accountName !== null && accountName !== undefined &&
      !/^accounts\/[A-Za-z0-9_-]+$/.test(accountName)) {
    res.status(400).json({ error: "Invalid Business Profile accountName" });
    return;
  }
  if (!Array.isArray(locationNames) ||
      locationNames.length > 500 ||
      locationNames.some((name) => !/^locations\/[A-Za-z0-9_-]+$/.test(name))) {
    res.status(400).json({ error: "locationNames must contain valid location resource names" });
    return;
  }

  try {
    await guardedDb.execute(sql`
      UPDATE google_brand_connections
      SET business_profile_account_name = ${accountName ?? null},
          business_profile_location_names = ${locationNames},
          updated_at = now()
      WHERE brand_id = ${guard.brandId}::uuid
    `);
    res.json({
      ok: true,
      businessProfileAccountName: accountName ?? null,
      businessProfileLocationNames: locationNames,
    });
  } catch (err) {
    req.log.error({ err }, "google: Business Profile selection save failed");
    res.status(500).json({ error: "Failed to save Business Profile selection" });
  }
});

export default router;