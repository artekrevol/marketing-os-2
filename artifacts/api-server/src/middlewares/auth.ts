import type { Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

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
 * Verify the Supabase access token in `Authorization: Bearer <jwt>` and
 * resolve the caller's admin status from `user_roles` / `user_profiles`.
 * Attaches `req.auth` on success.
 */
export const requireAuth: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const secret = process.env["SUPABASE_JWT_SECRET"];
  if (!secret) {
    res.status(500).json({ error: "server misconfigured: SUPABASE_JWT_SECRET unset" });
    return;
  }

  const header = req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: "missing bearer token" });
    return;
  }

  let claims: jwt.JwtPayload;
  try {
    const decoded = jwt.verify(match[1], secret, { algorithms: ["HS256"] });
    if (typeof decoded === "string" || !decoded.sub) {
      res.status(401).json({ error: "invalid token" });
      return;
    }
    claims = decoded;
  } catch (err) {
    req.log?.warn({ err }, "auth: jwt verify failed");
    res.status(401).json({ error: "invalid or expired token" });
    return;
  }

  const userId = claims.sub as string;
  const email = (claims["email"] as string | undefined) ?? null;

  // Resolve admin status. Check Sprint 1 `user_profiles.role` first, then
  // fall back to the legacy `user_roles` table. Each query is wrapped in
  // its own try/catch so that a missing table on either side never locks
  // legitimate admins out (e.g. environments where `user_roles` was never
  // provisioned).
  let isAdmin = false;
  try {
    const r = await db.execute(
      sql`select 1 as ok from public.user_profiles where user_id = ${userId}::uuid and role = 'admin' limit 1`,
    );
    if ((r as unknown as { rows: unknown[] }).rows.length > 0) isAdmin = true;
  } catch (err) {
    req.log?.warn({ err }, "auth: user_profiles admin lookup failed");
  }
  if (!isAdmin) {
    try {
      const r = await db.execute(
        sql`select 1 as ok from public.user_roles where user_id = ${userId}::uuid and role = 'admin' limit 1`,
      );
      if ((r as unknown as { rows: unknown[] }).rows.length > 0) isAdmin = true;
    } catch (err) {
      req.log?.warn({ err }, "auth: user_roles admin lookup failed");
    }
  }

  req.auth = { userId, email, isAdmin };
  next();
};

/** Composes requireAuth + admin gate. */
export const requireAdmin: RequestHandler = (req, res, next) => {
  void requireAuth(req, res, (err?: unknown) => {
    if (err) return next(err as Error);
    if (!req.auth) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    if (!req.auth.isAdmin) {
      res.status(403).json({ error: "admin required" });
      return;
    }
    next();
  });
};
