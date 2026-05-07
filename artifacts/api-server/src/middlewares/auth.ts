import type { Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import * as jose from "jose";
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
 * Cached JWKS set for asymmetric algorithms (ES256, RS256, PS256, …).
 * Lazily created on first asymmetric verification request.
 * jose's createRemoteJWKSet internally caches and auto-rotates keys.
 */
let _jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;

function getJwks(): ReturnType<typeof jose.createRemoteJWKSet> {
  if (_jwks) return _jwks;
  const supabaseUrl = process.env["SUPABASE_URL"];
  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL is required for ES256/RS256 JWT verification");
  }
  _jwks = jose.createRemoteJWKSet(
    new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`),
  );
  return _jwks;
}

/**
 * Verify the Supabase access token in `Authorization: Bearer <jwt>` and
 * resolve the caller's admin status from `user_roles` / `user_profiles`.
 * Attaches `req.auth` on success.
 *
 * Supports both symmetric (HS256/384/512, verified with SUPABASE_JWT_SECRET)
 * and asymmetric (ES256, RS256, PS256, verified via Supabase JWKS endpoint)
 * signing algorithms. Supabase projects can be configured to use either.
 */
export const requireAuth: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const header = req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: "missing bearer token" });
    return;
  }

  const token = match[1];

  // Decode header first (no verification) to determine the signing algorithm.
  const tokenHeader = jwt.decode(token, { complete: true })?.header;
  const tokenAlg = tokenHeader?.alg ?? "unknown";

  // Asymmetric algorithms — ES256, RS256, PS256, etc. — require the
  // Supabase public key fetched from the JWKS endpoint, not the shared secret.
  const isAsymmetric =
    tokenAlg.startsWith("ES") ||
    tokenAlg.startsWith("RS") ||
    tokenAlg.startsWith("PS");

  let sub: string | undefined;
  let email: string | undefined;

  if (isAsymmetric) {
    try {
      const { payload } = await jose.jwtVerify(token, getJwks());
      sub = payload.sub;
      email = payload["email"] as string | undefined;
    } catch (err) {
      req.log?.warn({ err, tokenAlg }, "auth: jwt verify failed (asymmetric)");
      res.status(401).json({ error: "invalid or expired token" });
      return;
    }
  } else {
    // Symmetric HS* — verify with the shared SUPABASE_JWT_SECRET.
    const secret = process.env["SUPABASE_JWT_SECRET"];
    if (!secret) {
      res.status(500).json({ error: "server misconfigured: SUPABASE_JWT_SECRET unset" });
      return;
    }
    try {
      const decoded = jwt.verify(token, secret, {
        algorithms: ["HS256", "HS384", "HS512"],
      });
      if (typeof decoded === "string" || !decoded.sub) {
        res.status(401).json({ error: "invalid token" });
        return;
      }
      sub = decoded.sub;
      email = decoded["email"] as string | undefined;
    } catch (err) {
      req.log?.warn({ err, tokenAlg }, "auth: jwt verify failed (symmetric)");
      res.status(401).json({ error: "invalid or expired token" });
      return;
    }
  }

  if (!sub) {
    res.status(401).json({ error: "invalid token: missing sub" });
    return;
  }

  const userId = sub;

  // Resolve admin status. Check `user_profiles.role` first, then fall back
  // to the legacy `user_roles` table. Each query is wrapped in its own
  // try/catch so that a missing table never locks legitimate admins out.
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

  req.auth = { userId, email: email ?? null, isAdmin };
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
