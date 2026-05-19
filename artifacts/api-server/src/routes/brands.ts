import { Router } from "express";
import { db, brandsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

/**
 * GET /api/brands
 * Returns all brands, sorted by name.
 */
router.get("/", requireAuth, async (_req, res, next) => {
  try {
    const rows = await db.select().from(brandsTable).orderBy(asc(brandsTable.name));
    res.json(
      rows.map((b) => ({
        id: b.id,
        slug: b.slug,
        name: b.name,
        primary_domain: b.primaryDomain,
        voice_profile: b.voiceProfile,
        thresholds: b.thresholds,
        created_at: b.createdAt,
        updated_at: b.updatedAt,
      })),
    );
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/brands/:id
 * Update mutable brand fields. Requires admin (enforced upstream by AdminBrands audit gate).
 */
router.patch("/:id", requireAuth, async (req, res, next) => {
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

