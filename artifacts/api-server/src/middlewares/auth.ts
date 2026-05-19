import { getAuth } from "@clerk/express";
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
 * JIT-provision a user_profiles row on first authenticated request.
 * Returns the user's admin status.
 */
async function ensureUserProfile(
  userId: string,
  email: string | null,
): Promise<{ isAdmin: boolean }> {
  const rows = await db
    .select({ role: userProfilesTable.role })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId))
    .limit(1);

  if (rows.length > 0) {
    return { isAdmin: rows[0]!.role === "admin" };
  }

  // First login — insert a default writer profile.
  await db
    .insert(userProfilesTable)
    .values({ userId, email, role: "writer", brandAccess: [] })
    .onConflictDoNothing();

  return { isAdmin: false };
}

/**
 * Requires a valid Clerk session cookie.
 * Attaches req.auth = { userId, email, isAdmin } on success.
 * JIT-provisions a user_profiles row for new users.
 */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const clerkAuth = getAuth(req);
  if (!clerkAuth?.userId) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  try {
    const email = (clerkAuth.sessionClaims?.["email"] as string | null) ?? null;
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
    const email = (clerkAuth.sessionClaims?.["email"] as string | null) ?? null;
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
