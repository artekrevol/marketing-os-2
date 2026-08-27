/**
 * Google OAuth 2.0 flow — per-brand connection management.
 *
 *   GET  /start?brandId=...  — admin initiates OAuth, redirects to Google
 *   GET  /callback           — Google redirects here after user approves
 *   DELETE /:brandId         — admin disconnects a brand's Google account
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { guardedDb, withBrandScope } from "@workspace/db";
import {
  assertBrandAccess,
  BrandAccessError,
  requireAuth,
} from "../../middlewares/auth.js";
import { requireAdminOrLead } from "../seo/_shared.js";
import {
  buildAuthUrl,
  exchangeCode,
  fetchUserInfo,
  tokenExpiryDate,
  GOOGLE_SCOPES,
} from "./google-client.js";
import { encryptToken } from "./google-crypto.js";

const router: IRouter = Router();

/* ─── POST start — kick off the OAuth dance ──────────────────────────────── */
router.get("/start", requireAuth, (req: Request, res: Response) => {
  if (!requireAdminOrLead(req, res)) return;

  const brandId = req.query["brandId"] as string | undefined;
  if (!brandId || !/^[0-9a-f-]{36}$/i.test(brandId)) {
    res.status(400).json({ error: "Valid brandId required" });
    return;
  }

  void (async () => {
    try {
      await assertBrandAccess(req, brandId);

      // Create a short-lived CSRF state token (10 min TTL)
      const stateRes = (await guardedDb.execute(sql`
        INSERT INTO google_oauth_states (brand_id, created_by, expires_at)
        VALUES (${brandId}::uuid, ${req.auth!.userId}, now() + interval '10 minutes')
        RETURNING id::text
      `)) as unknown as { rows?: Array<{ id: string }> } | Array<{ id: string }>;
      const stateRows = Array.isArray(stateRes) ? stateRes : (stateRes.rows ?? []);
      const stateId = stateRows[0]?.id;
      if (!stateId) throw new Error("Failed to create OAuth state");

      res.redirect(buildAuthUrl(stateId));
    } catch (err) {
      if (err instanceof BrandAccessError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      console.error("[google/oauth/start]", err);
      res.status(500).json({ error: "Failed to initiate Google OAuth" });
    }
  })();
});

/* ─── GET callback — Google posts here after user approves ───────────────── */
router.get("/callback", requireAuth, (req: Request, res: Response) => {
  const code = req.query["code"] as string | undefined;
  const stateId = req.query["state"] as string | undefined;
  const error = req.query["error"] as string | undefined;

  if (error) {
    res.redirect("/seo-os/seo/integrations?google=denied&reason=authorization_denied");
    return;
  }

  if (!code || !stateId) {
    res.redirect("/seo-os/seo/integrations?google=error&reason=missing_params");
    return;
  }

  void (async () => {
    try {
      // Validate & consume the state token
      const stateRes = (await guardedDb.execute(sql`
        UPDATE google_oauth_states
        SET used = true
        WHERE id = ${stateId}::uuid
          AND created_by = ${req.auth!.userId}
          AND used = false
          AND expires_at > now()
        RETURNING brand_id::text
      `)) as unknown as { rows?: Array<{ brand_id: string }> } | Array<{ brand_id: string }>;
      const stateRows = Array.isArray(stateRes) ? stateRes : (stateRes.rows ?? []);
      const brandId = stateRows[0]?.brand_id;
      if (!brandId) {
        res.redirect("/seo-os/seo/integrations?google=error&reason=invalid_state");
        return;
      }
      await assertBrandAccess(req, brandId);

      // Exchange code for tokens
      const tokens = await exchangeCode(code);
      if (!tokens.refresh_token) {
        // This can happen if the user already authorized before and prompt=consent was skipped
        res.redirect("/seo-os/seo/integrations?google=error&reason=no_refresh_token");
        return;
      }

      // Fetch user email to display in the UI
      const userInfo = await fetchUserInfo(tokens.access_token);
      const expiry = tokenExpiryDate(tokens.expires_in);

      // Encrypt tokens before storing (AES-256-GCM via GOOGLE_OAUTH_ENCRYPTION_KEY)
      const encAccessToken = encryptToken(tokens.access_token);
      const encRefreshToken = encryptToken(tokens.refresh_token);

      // Upsert into google_brand_connections (one row per brand)
      await guardedDb.execute(sql`
        INSERT INTO google_brand_connections
          (brand_id, google_account_email, access_token, refresh_token, token_expiry, scopes, updated_at)
        VALUES
          (${brandId}::uuid, ${userInfo.email}, ${encAccessToken}, ${encRefreshToken},
           ${expiry.toISOString()}, ${GOOGLE_SCOPES}, now())
        ON CONFLICT (brand_id) DO UPDATE SET
          google_account_email = EXCLUDED.google_account_email,
          access_token         = EXCLUDED.access_token,
          refresh_token        = EXCLUDED.refresh_token,
          token_expiry         = EXCLUDED.token_expiry,
          scopes               = EXCLUDED.scopes,
          updated_at           = now()
      `);

      res.redirect(`/seo-os/seo/integrations?google=connected&brand=${brandId}`);
    } catch (err) {
      console.error("[google/oauth/callback]", err);
      res.redirect("/seo-os/seo/integrations?google=error&reason=callback_failed");
    }
  })();
});

/* ─── DELETE /:brandId — disconnect ─────────────────────────────────────── */
router.delete("/:brandId", requireAuth, (req: Request, res: Response) => {
  if (!requireAdminOrLead(req, res)) return;

  const { brandId } = req.params as { brandId: string };
  if (!/^[0-9a-f-]{36}$/i.test(brandId)) {
    res.status(400).json({ error: "Invalid brandId" });
    return;
  }

  void (async () => {
    try {
      await assertBrandAccess(req, brandId);

      await guardedDb.execute(sql`
        DELETE FROM google_brand_connections WHERE brand_id = ${brandId}::uuid
      `);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof BrandAccessError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      console.error("[google/oauth/disconnect]", err);
      res.status(500).json({ error: "Disconnect failed" });
    }
  })();
});

export default router;
