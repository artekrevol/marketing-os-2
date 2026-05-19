import { Router } from "express";
import { db, userProfilesTable, brandsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

/**
 * GET /api/me
 * Returns the authenticated user's profile, role, and accessible brands.
 * Used by both ContentForge and SEO OS AppShells to bootstrap the brand switcher.
 */
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { userId, email, isAdmin } = req.auth!;

    const profiles = await db
      .select()
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, userId))
      .limit(1);

    const profile = profiles[0];
    const brandAccess = (profile?.brandAccess ?? []) as string[];
    const role = profile?.role ?? "writer";
    const effectiveAdmin = isAdmin || role === "admin";

    let brands: (typeof brandsTable.$inferSelect)[];
    if (effectiveAdmin) {
      brands = await db.select().from(brandsTable).orderBy(brandsTable.name);
    } else if (brandAccess.length > 0) {
      brands = await db
        .select()
        .from(brandsTable)
        .where(inArray(brandsTable.id, brandAccess));
    } else {
      brands = [];
    }

    res.json({ userId, email, isAdmin: effectiveAdmin, role, brands });
  } catch (err) {
    next(err);
  }
});

export default router;
