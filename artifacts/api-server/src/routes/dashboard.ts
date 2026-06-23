import { Router } from "express";
import {
  db,
  userProfilesTable,
  brandsTable,
  projectsTable,
  contentObjectsTable,
  recoveryInitiativesTable,
} from "@workspace/db";
import { eq, inArray, and, ne, desc, count } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

type ActivityItem = {
  id: string;
  kind: "project" | "review" | "seo";
  label: string;
  detail: string;
  brandName: string;
  at: string;
};

/**
 * GET /api/dashboard/summary
 * Cross-brand rollup for the unified Hub landing dashboard. Aggregates the
 * stats and recent activity the signed-in user is allowed to see (admins see
 * every brand; everyone else is scoped to their `brand_access`). Keeps the
 * frontend simple — one call instead of N brand-scoped requests.
 */
router.get("/summary", requireAuth, async (req, res, next) => {
  try {
    const { userId, isAdmin } = req.auth!;

    const profiles = await db
      .select()
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, userId))
      .limit(1);

    const profile = profiles[0];
    const brandAccess = (profile?.brandAccess ?? []) as string[];
    const role = profile?.role ?? "member";
    const effectiveAdmin = isAdmin || role === "admin";
    // Mirror the SEO OS module gate (admin|lead|reviewer): users who cannot
    // enter SEO OS should not see SEO initiative stats or activity here.
    const canSeo = effectiveAdmin || role === "lead" || role === "reviewer";

    let brands: { id: string; name: string }[];
    if (effectiveAdmin) {
      brands = await db
        .select({ id: brandsTable.id, name: brandsTable.name })
        .from(brandsTable)
        .orderBy(brandsTable.name);
    } else if (brandAccess.length > 0) {
      brands = await db
        .select({ id: brandsTable.id, name: brandsTable.name })
        .from(brandsTable)
        .where(inArray(brandsTable.id, brandAccess));
    } else {
      brands = [];
    }

    const brandIds = brands.map((b) => b.id);
    const brandName = new Map(brands.map((b) => [b.id, b.name]));

    if (brandIds.length === 0) {
      res.json({
        stats: { brands: 0, activeProjects: 0, inReview: 0, seoInitiatives: 0 },
        recentActivity: [],
      });
      return;
    }

    const [
      activeProjectsRows,
      inReviewRows,
      seoInitiativeRows,
      recentProjects,
      recentReviews,
      recentInitiatives,
    ] = await Promise.all([
      db
        .select({ value: count() })
        .from(projectsTable)
        .where(
          and(
            inArray(projectsTable.brandId, brandIds),
            ne(projectsTable.status, "archived"),
          ),
        ),
      db
        .select({ value: count() })
        .from(contentObjectsTable)
        .where(
          and(
            inArray(contentObjectsTable.brandId, brandIds),
            inArray(contentObjectsTable.status, ["submitted", "in_review"]),
          ),
        ),
      canSeo
        ? db
            .select({ value: count() })
            .from(recoveryInitiativesTable)
            .where(
              and(
                inArray(recoveryInitiativesTable.brandId, brandIds),
                eq(recoveryInitiativesTable.status, "active"),
              ),
            )
        : Promise.resolve([{ value: 0 }]),
      db
        .select({
          id: projectsTable.id,
          brandId: projectsTable.brandId,
          topic: projectsTable.topic,
          status: projectsTable.status,
          updatedAt: projectsTable.updatedAt,
        })
        .from(projectsTable)
        .where(inArray(projectsTable.brandId, brandIds))
        .orderBy(desc(projectsTable.updatedAt))
        .limit(8),
      db
        .select({
          id: contentObjectsTable.id,
          brandId: contentObjectsTable.brandId,
          title: contentObjectsTable.title,
          status: contentObjectsTable.status,
          updatedAt: contentObjectsTable.updatedAt,
        })
        .from(contentObjectsTable)
        .where(
          and(
            inArray(contentObjectsTable.brandId, brandIds),
            inArray(contentObjectsTable.status, [
              "submitted",
              "in_review",
              "approved",
              "rejected",
            ]),
          ),
        )
        .orderBy(desc(contentObjectsTable.updatedAt))
        .limit(8),
      canSeo
        ? db
            .select({
              id: recoveryInitiativesTable.id,
              brandId: recoveryInitiativesTable.brandId,
              name: recoveryInitiativesTable.name,
              status: recoveryInitiativesTable.status,
              startedAt: recoveryInitiativesTable.startedAt,
            })
            .from(recoveryInitiativesTable)
            .where(inArray(recoveryInitiativesTable.brandId, brandIds))
            .orderBy(desc(recoveryInitiativesTable.startedAt))
            .limit(5)
        : Promise.resolve(
            [] as {
              id: string;
              brandId: string;
              name: string;
              status: string;
              startedAt: Date;
            }[],
          ),
    ]);

    const reviewLabel: Record<string, string> = {
      submitted: "Draft submitted for review",
      in_review: "Draft in review",
      approved: "Draft approved",
      rejected: "Draft rejected",
    };

    const activity: ActivityItem[] = [
      ...recentProjects.map((p) => ({
        id: `project-${p.id}`,
        kind: "project" as const,
        label: "Project updated",
        detail: p.topic,
        brandName: brandName.get(p.brandId) ?? "—",
        at: (p.updatedAt as Date).toISOString(),
      })),
      ...recentReviews.map((c) => ({
        id: `review-${c.id}`,
        kind: "review" as const,
        label: reviewLabel[c.status] ?? "Draft updated",
        detail: c.title || "Untitled draft",
        brandName: brandName.get(c.brandId) ?? "—",
        at: (c.updatedAt as Date).toISOString(),
      })),
      ...recentInitiatives.map((i) => ({
        id: `seo-${i.id}`,
        kind: "seo" as const,
        label: "SEO initiative started",
        detail: i.name,
        brandName: brandName.get(i.brandId) ?? "—",
        at: (i.startedAt as Date).toISOString(),
      })),
    ]
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 12);

    res.json({
      stats: {
        brands: brands.length,
        activeProjects: Number(activeProjectsRows[0]?.value ?? 0),
        inReview: Number(inReviewRows[0]?.value ?? 0),
        seoInitiatives: Number(seoInitiativeRows[0]?.value ?? 0),
      },
      recentActivity: activity,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
