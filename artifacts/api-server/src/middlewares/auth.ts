import type { Request, RequestHandler } from "express";
import { db } from "@workspace/db";
import { userProfilesTable, projectsTable, USER_ROLES } from "@workspace/db";
import type { UserRole } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface AuthContext {
  userId: string;
  email: string | null;
  isAdmin: boolean;
  role: UserRole;
}

/** Resolved tenancy context. Never derive authorization from frontend state. */
export interface BrandRequestContext {
  brandId: string;
  actorId: string;
  role: UserRole;
  isAdmin: boolean;
  authorization: "admin" | "brand_access";
  correlationId: string;
}

/**
 * Roles permitted to enter the SEO OS module. "outreach" is a DEPARTMENT,
 * not a role, and is intentionally excluded. Kept in sync with the SEO OS
 * frontend gate (`AppShell` SEO_OS_ROLES) and the Hub SEO tile gate.
 */
export const SEO_OS_ROLES: ReadonlySet<UserRole> = new Set<UserRole>([
  "admin",
  "lead",
  "reviewer",
]);

function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      brandContext?: BrandRequestContext;
    }
  }
}

declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

function seedAdminEmails(): Set<string> {
  const raw = process.env["SEED_ADMIN_EMAILS"] ?? "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

function seedAdminUserIds(): Set<string> {
  const raw = process.env["SEED_ADMIN_USER_IDS"] ?? "";
  return new Set(raw.split(",").map((id) => id.trim()).filter(Boolean));
}

async function ensureUserProfile(
  userId: string,
  email: string | null,
): Promise<{ isAdmin: boolean; role: UserRole }> {
  const admins = seedAdminEmails();
  const adminIds = seedAdminUserIds();
  const isSeedAdmin =
    adminIds.has(userId) || (!!email && admins.has(email.toLowerCase()));

  const rows = await db
    .select({ role: userProfilesTable.role, email: userProfilesTable.email })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId))
    .limit(1);

  if (rows.length > 0) {
    const existing = rows[0]!;
    const needsEmailUpdate = !existing.email && !!email;
    const needsAdminPromotion = isSeedAdmin && existing.role !== "admin";

    if (needsEmailUpdate || needsAdminPromotion) {
      await db
        .update(userProfilesTable)
        .set({
          ...(needsEmailUpdate ? { email } : {}),
          ...(needsAdminPromotion ? { role: "admin" } : {}),
          updatedAt: new Date(),
        })
        .where(eq(userProfilesTable.userId, userId));
    }

    const isAdmin = existing.role === "admin" || isSeedAdmin;
    const role: UserRole = isAdmin
      ? "admin"
      : isUserRole(existing.role)
        ? existing.role
        : "member";
    return { isAdmin, role };
  }

  const role: UserRole = isSeedAdmin ? "admin" : "member";
  await db
    .insert(userProfilesTable)
    .values({ userId, email, role, brandAccess: [] })
    .onConflictDoNothing();

  return { isAdmin: isSeedAdmin, role };
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  try {
    const rows = await db
      .select({ email: userProfilesTable.email })
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, userId))
      .limit(1);
    const email = rows[0]?.email ?? null;
    const { isAdmin, role } = await ensureUserProfile(userId, email);
    req.auth = { userId, email, isAdmin, role };
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Express middleware: gate the SEO OS module to roles in `SEO_OS_ROLES`
 * (admin, lead, reviewer). Self-contained — resolves the session and
 * profile like `requireAdmin`, so it can be mounted directly on the
 * `/api/seo` router without depending on an upstream `requireAuth`.
 * Members (and any non-listed role) get 403; the SEO OS frontend
 * redirects them to ContentForge.
 */
export const requireSeoRole: RequestHandler = async (req, res, next) => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  try {
    const rows = await db
      .select({ email: userProfilesTable.email })
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, userId))
      .limit(1);
    const email = rows[0]?.email ?? null;
    const { isAdmin, role } = await ensureUserProfile(userId, email);
    req.auth = { userId, email, isAdmin, role };
    if (!SEO_OS_ROLES.has(role)) {
      res
        .status(403)
        .json({ error: "SEO OS access requires admin, lead, or reviewer role" });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Brand-access authorization helpers.
 *
 * `requireAuth` only verifies the caller is logged in. These helpers add
 * the second layer: verify the caller (a) is an admin, or (b) has the
 * project/brand in their `user_profiles.brand_access` array.
 *
 * Use `assertBrandAccessForProject(req, projectId)` inside any route
 * handler that takes a `:id` (project id) param and reads or writes
 * project-scoped data. Returns the resolved `brandId` on success, or
 * throws a `BrandAccessError` that the router translates to 403/404.
 */
export class BrandAccessError extends Error {
  constructor(public readonly status: 403 | 404, message: string) {
    super(message);
  }
}

async function userHasBrandAccess(userId: string, brandId: string): Promise<boolean> {
  const rows = await db
    .select({ brandAccess: userProfilesTable.brandAccess })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId))
    .limit(1);
  return (rows[0]?.brandAccess ?? []).includes(brandId);
}

/**
 * Resolve a project's brand and confirm the authenticated user may act
 * on it. Throws BrandAccessError(404) if the project is missing,
 * BrandAccessError(403) if the user is not an admin and lacks brand_access.
 */
export async function assertBrandAccessForProject(
  req: Request,
  projectId: string,
): Promise<string> {
  const auth = req.auth;
  if (!auth) {
    throw new BrandAccessError(403, "unauthenticated");
  }
  const rows = await db
    .select({ brandId: projectsTable.brandId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  const brandId = rows[0]?.brandId;
  if (!brandId) {
    throw new BrandAccessError(404, "project not found");
  }
  if (!auth.isAdmin && !(await userHasBrandAccess(auth.userId, brandId))) {
    throw new BrandAccessError(403, "forbidden");
  }
  req.brandContext = {
    brandId,
    actorId: auth.userId,
    role: auth.role,
    isAdmin: auth.isAdmin,
    authorization: auth.isAdmin ? "admin" : "brand_access",
    correlationId: req.header("x-request-id") ?? String(req.id),
  };
  return brandId;
}

/**
 * Confirm the authenticated user may act on a given brand directly.
 * Used by routes that take a brandId from the query/body (e.g.
 * GET /api/projects?brandId=…) rather than via a project lookup.
 */
export async function assertBrandAccess(
  req: Request,
  brandId: string,
): Promise<void> {
  const auth = req.auth;
  if (!auth) throw new BrandAccessError(403, "unauthenticated");
  if (!auth.isAdmin && !(await userHasBrandAccess(auth.userId, brandId))) {
    throw new BrandAccessError(403, "forbidden");
  }
  req.brandContext = {
    brandId,
    actorId: auth.userId,
    role: auth.role,
    isAdmin: auth.isAdmin,
    authorization: auth.isAdmin ? "admin" : "brand_access",
    correlationId: req.header("x-request-id") ?? String(req.id),
  };
}

/**
 * Express middleware: read `project_id` from the request body and verify
 * the authenticated caller has brand-access for that project (or is an
 * admin). Use on any project-mutating route that takes `project_id` in
 * the body — most `/api/ai/*` endpoints. Mounts after `requireAuth`.
 */
export const requireProjectAccess: RequestHandler = async (req, res, next) => {
  try {
    const projectId = (req.body as { project_id?: unknown })?.project_id;
    if (typeof projectId !== "string" || !projectId) {
      res.status(400).json({ error: "project_id required" });
      return;
    }
    await assertBrandAccessForProject(req, projectId);
    next();
  } catch (err) {
    if (err instanceof BrandAccessError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const requireAdmin: RequestHandler = async (req, res, next) => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  try {
    const rows = await db
      .select({ email: userProfilesTable.email })
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, userId))
      .limit(1);
    const email = rows[0]?.email ?? null;
    const { isAdmin, role } = await ensureUserProfile(userId, email);
    req.auth = { userId, email, isAdmin, role };
    if (!isAdmin) {
      res.status(403).json({ error: "admin required" });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
};
