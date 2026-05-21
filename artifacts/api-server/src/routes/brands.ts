import { Router } from "express";
import { db, brandsTable, userProfilesTable } from "@workspace/db";
import { eq, asc, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";

const router = Router();

function brandToSnake(b: typeof brandsTable.$inferSelect) {
  return {
    id: b.id,
    slug: b.slug,
    name: b.name,
    primary_domain: b.primaryDomain,
    voice_profile: b.voiceProfile,
    thresholds: b.thresholds,
    created_at: b.createdAt,
    updated_at: b.updatedAt,
  };
}

/**
 * GET /api/brands
 *
 * Admins see every brand. Non-admin writers see only the brands listed
 * in their `user_profiles.brand_access` — previously this leaked the
 * full brand directory to every authenticated user.
 */
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const auth = req.auth;
    if (!auth) { res.status(401).json({ error: "unauthenticated" }); return; }

    if (auth.isAdmin) {
      const rows = await db.select().from(brandsTable).orderBy(asc(brandsTable.name));
      res.json(rows.map(brandToSnake));
      return;
    }

    const profile = await db
      .select({ brandAccess: userProfilesTable.brandAccess })
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, auth.userId))
      .limit(1);
    const accessible = profile[0]?.brandAccess ?? [];
    if (accessible.length === 0) { res.json([]); return; }

    const rows = await db
      .select()
      .from(brandsTable)
      .where(inArray(brandsTable.id, accessible))
      .orderBy(asc(brandsTable.name));
    res.json(rows.map(brandToSnake));
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/brands/:id
 *
 * Admin-only. The previous comment claimed this was "enforced upstream
 * by AdminBrands audit gate" but the gate was UI-only — a direct API
 * call from any writer could mutate brand settings. Now gated server-side.
 */
router.patch("/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = req.params["id"] as string;
    const { primary_domain, voice_profile, thresholds } = req.body as {
      primary_domain?: string | null;
      voice_profile?: unknown;
      thresholds?: unknown;
    };

    const set: Partial<typeof brandsTable.$inferInsert> = { updatedAt: new Date() };
    if (primary_domain !== undefined) set.primaryDomain = primary_domain;
    if (voice_profile !== undefined) set.voiceProfile = voice_profile as Record<string, unknown>;
    if (thresholds !== undefined) set.thresholds = thresholds as Record<string, unknown>;

    await db.update(brandsTable).set(set).where(eq(brandsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
