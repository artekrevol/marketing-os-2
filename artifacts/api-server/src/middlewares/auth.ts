import { getAuth, clerkClient } from "@clerk/express";
import type { RequestHandler } from "express";
import { db } from "@workspace/db";
import { userProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface AuthContext {
  userId: string;
  email: string | null;
  isAdmin: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/**
 * Returns the set of emails that are unconditionally admin.
 * Sourced from SEED_ADMIN_EMAILS (comma-separated). Case-insensitive.
 * Example: SEED_ADMIN_EMAILS=abeer@tekrevol.com,rabia.mahmood@tekrevol.com
 */
function seedAdminEmails(): Set<string> {
  const raw = process.env["SEED_ADMIN_EMAILS"] ?? "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Returns the set of Clerk user IDs that are unconditionally admin.
 * Sourced from SEED_ADMIN_USER_IDS (comma-separated).
 * More reliable than email matching: user IDs are immutable, never null,
 * and don't depend on Clerk email resolution succeeding.
 * Example: SEED_ADMIN_USER_IDS=user_abc123,user_xyz456
 */
function seedAdminUserIds(): Set<string> {
  const raw = process.env["SEED_ADMIN_USER_IDS"] ?? "";
  return new Set(raw.split(",").map((id) => id.trim()).filter(Boolean));
}

/**
 * Fetches the primary email for a Clerk user via the backend API.
 * Falls back to null if the call fails (e.g. network, wrong key).
 * Used because Replit-managed Clerk does not include email in session claims
 * by default, leaving sessionClaims.email empty on every request.
 */
async function fetchClerkEmail(userId: string): Promise<string | null> {
  try {
    const user = await clerkClient.users.getUser(userId);
    return user.emailAddresses?.[0]?.emailAddress ?? null;
  } catch {
    return null;
  }
}

/**
 * JIT-provision a user_profiles row on first authenticated request.
 *
 * Scalable admin promotion rules (applied on every login):
 *   1. If the email matches SEED_ADMIN_EMAILS → role is forced to "admin"
 *      and the row is updated if it was previously "writer". This means
 *      adding an email to SEED_ADMIN_EMAILS takes effect on next login —
 *      no manual DB promotion needed.
 *   2. Otherwise the existing role in the DB is respected.
 *   3. Email is backfilled on the DB row whenever it was previously blank.
 */
async function ensureUserProfile(
  userId: string,
  email: string | null,
): Promise<{ isAdmin: boolean }> {
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

    return { isAdmin: existing.role === "admin" || isSeedAdmin };
  }

  // First login — provision a new profile with correct role.
  const role = isSeedAdmin ? "admin" : "writer";
  await db
    .insert(userProfilesTable)
    .values({ userId, email, role, brandAccess: [] })
    .onConflictDoNothing();

  return { isAdmin: isSeedAdmin };
}

/**
 * Resolves the caller's email. Tries session claims first (cheap, no
 * network hop), then falls back to the Clerk backend API (one HTTP call,
 * result can be cached if needed). Replit-managed Clerk omits email from
 * session claims by default so the backend lookup is the reliable path.
 */
async function resolveEmail(
  sessionClaimEmail: string | null,
  userId: string,
): Promise<string | null> {
  if (sessionClaimEmail) return sessionClaimEmail;
  return fetchClerkEmail(userId);
}

/**
 * Requires a valid Clerk session cookie.
 * Attaches req.auth = { userId, email, isAdmin } on success.
 * JIT-provisions a user_profiles row for new users.
 * Auto-promotes SEED_ADMIN_EMAILS entries on every request.
 */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const clerkAuth = getAuth(req);
  if (!clerkAuth?.userId) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  try {
    const claimEmail =
      (clerkAuth.sessionClaims?.["email"] as string | null) ?? null;
    const email = await resolveEmail(claimEmail, clerkAuth.userId);
    const { isAdmin } = await ensureUserProfile(clerkAuth.userId, email);
    req.auth = { userId: clerkAuth.userId, email, isAdmin };
    next();
  } catch (err) {
    next(err);
  }
};

/** requireAuth + admin gate. */
export const requireAdmin: RequestHandler = async (req, res, next) => {
  const clerkAuth = getAuth(req);
  if (!clerkAuth?.userId) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  try {
    const claimEmail =
      (clerkAuth.sessionClaims?.["email"] as string | null) ?? null;
    const email = await resolveEmail(claimEmail, clerkAuth.userId);
    const { isAdmin } = await ensureUserProfile(clerkAuth.userId, email);
    req.auth = { userId: clerkAuth.userId, email, isAdmin };
    if (!isAdmin) {
      res.status(403).json({ error: "admin required" });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
};
