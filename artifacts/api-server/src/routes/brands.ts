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

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code?: unknown }).code === "23505"
    ) {
      return true;
    }
    current =
      typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function normalizeDomain(value: string): string | null {
  const candidate = value.trim().toLowerCase().replace(/\/+$/, "");
  if (!candidate || candidate.includes("/") || candidate.includes("@")) return null;

  const hostname = candidate.replace(/^https?:\/\//, "");
  if (
    hostname.length > 253 ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(hostname)
  ) {
    return null;
  }
  return hostname;
}

/**
 * POST /api/brands
 *
 * Admin-only. Creates a brand with the database's default voice profile and
 * thresholds. The endpoint validates independently of the form because it is
 * also a production security boundary.
 */
router.post("/", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const body = req.body as {
      name?: unknown;
      slug?: unknown;
      primary_domain?: unknown;
    };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const rawSlug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
    const slug = rawSlug || slugify(name);
    const rawDomain = typeof body.primary_domain === "string" ? body.primary_domain : "";
    const primaryDomain = normalizeDomain(rawDomain);
    const fieldErrors: Record<string, string> = {};

    if (name.length < 2) fieldErrors.name = "Enter a brand name.";
    else if (name.length > 120) fieldErrors.name = "Brand name must be 120 characters or fewer.";

    if (!slug) fieldErrors.slug = "Enter a brand slug.";
    else if (slug.length > 60) fieldErrors.slug = "Slug must be 60 characters or fewer.";
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      fieldErrors.slug = "Use lowercase letters, numbers, and single hyphens only.";
    }

    if (!primaryDomain) {
      fieldErrors.primary_domain = "Enter a valid domain such as example.com.";
    }

    if (Object.keys(fieldErrors).length > 0) {
      res.status(400).json({
        error: "validation_failed",
        message: "Check the highlighted brand fields.",
        fields: fieldErrors,
      });
      return;
    }

    const existing = await db
      .select({ id: brandsTable.id })
      .from(brandsTable)
      .where(eq(brandsTable.slug, slug))
      .limit(1);
    if (existing.length > 0) {
      res.status(409).json({
        error: "duplicate_slug",
        message: "A brand with that slug already exists.",
        fields: { slug: "Choose a different slug." },
      });
      return;
    }

    const [created] = await db
      .insert(brandsTable)
      .values({
        name,
        slug,
        primaryDomain,
      })
      .returning();

    res.status(201).json(brandToSnake(created!));
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({
        error: "duplicate_slug",
        message: "A brand with that slug already exists.",
        fields: { slug: "Choose a different slug." },
      });
      return;
    }
    next(err);
  }
});

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
