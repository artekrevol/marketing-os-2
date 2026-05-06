import type { Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";

/**
 * Typed wrapper around `db.execute()` for ad-hoc raw SQL whose result
 * we only need to inspect by row count or simple key. node-postgres
 * returns `{ rows: T[] }` shaped objects; drizzle's `.execute()` types
 * it as a discriminated union, so we narrow once here instead of
 * scattering `as unknown as { rows: ... }` casts at every call site.
 */
async function execRows<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows?: T[] } | T[];
  if (Array.isArray(result)) return result;
  return result.rows ?? [];
}

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

  // Decode header first (no verification) so we can log the actual algorithm
  // when verification fails — makes production debugging much faster.
  const tokenHeader = jwt.decode(match[1], { complete: true })?.header;
  const tokenAlg = tokenHeader?.alg ?? "unknown";

  let claims: jwt.JwtPayload;
  try {
    // Accept all symmetric HS variants. Supabase projects default to HS256
    // but some configurations use HS384 or HS512. The security guarantee
    // comes from the shared secret — restricting to only HS256 broke
    // production when a Supabase project used a different HS variant.
    const decoded = jwt.verify(match[1], secret, {
      algorithms: ["HS256", "HS384", "HS512"],
    });
    if (typeof decoded === "string" || !decoded.sub) {
      res.status(401).json({ error: "invalid token" });
      return;
    }
    claims = decoded;
  } catch (err) {
    req.log?.warn({ err, tokenAlg }, "auth: jwt verify failed");
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
    const rows = await execRows(
      sql`select 1 as ok from public.user_profiles where user_id = ${userId}::uuid and role = 'admin' limit 1`,
    );
    if (rows.length > 0) isAdmin = true;
  } catch (err) {
    req.log?.warn({ err }, "auth: user_profiles admin lookup failed");
  }
  if (!isAdmin) {
    try {
      const rows = await execRows(
        sql`select 1 as ok from public.user_roles where user_id = ${userId}::uuid and role = 'admin' limit 1`,
      );
      if (rows.length > 0) isAdmin = true;
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
