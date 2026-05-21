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

  const role = isSeedAdmin ? "admin" : "writer";
  await db
    .insert(userProfilesTable)
    .values({ userId, email, role, brandAccess: [] })
    .onConflictDoNothing();

  return { isAdmin: isSeedAdmin };
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
    const { isAdmin } = await ensureUserProfile(userId, email);
    req.auth = { userId, email, isAdmin };
    next();
  } catch (err) {
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
    const { isAdmin } = await ensureUserProfile(userId, email);
    req.auth = { userId, email, isAdmin };
    if (!isAdmin) {
      res.status(403).json({ error: "admin required" });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
};
