import type { Request, Response } from "express";
import { assertBrandAccess, BrandAccessError } from "../../middlewares/auth.js";

/**
 * Inline role check for admin + lead only routes (Discovery Inbox, Competitor
 * Curation). Must be called after `requireAuth` / `requireSeoRole` so
 * `req.auth` is populated. Returns `true` if the caller may proceed; `false`
 * if a 403 has already been written to `res`.
 */
export function requireAdminOrLead(req: Request, res: Response): boolean {
  const role = req.auth?.role;
  if (role !== "admin" && role !== "lead") {
    res.status(403).json({
      error: "forbidden",
      message: "Requires admin or lead role",
    });
    return false;
  }
  return true;
}

/** Canonical UUID matcher — reject bad input before it reaches Postgres. */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BrandGuard =
  | { ok: true; brandId: string; userId: string }
  | { ok: false; status: number; error: string };

/**
 * Resolve and authorize the brand for an SEO request. `brandId` comes
 * from the query string (GET) or the body (writes). Validates it is a
 * UUID, then defers to `assertBrandAccess` (admin OR user has the brand
 * in `user_profiles.brand_access`). Translates `BrandAccessError` into a
 * `{ ok:false, status }` tuple the caller writes as the HTTP response.
 *
 * The `/api/seo` parent mounts `requireSeoRole` first (gating on
 * role ∈ {admin, lead, reviewer}), and each subrouter runs `requireAuth`,
 * so `req.auth` is always populated here.
 */
export async function guardBrand(
  req: Request,
  brandId: unknown,
): Promise<BrandGuard> {
  if (!req.auth) return { ok: false, status: 401, error: "unauthenticated" };
  if (typeof brandId !== "string" || !UUID_RE.test(brandId)) {
    return { ok: false, status: 400, error: "brandId must be a UUID" };
  }
  try {
    await assertBrandAccess(req, brandId);
  } catch (err) {
    if (err instanceof BrandAccessError) {
      return { ok: false, status: err.status, error: err.message };
    }
    throw err;
  }
  return { ok: true, brandId, userId: req.auth.userId };
}

/** Uniform 500 handler — log with context, return a clean body. */
export function fail(
  res: Response,
  req: Request,
  scope: string,
  err: unknown,
): void {
  req.log.error({ err }, `seo: ${scope} failed`);
  res
    .status(500)
    .json({ error: "internal_error", message: (err as Error).message });
}
