import React from "react";
import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  getRecoveryOverview,
  getSnapshots,
  getInitiatives,
  createInitiative,
  updateInitiative,
  completeInitiative,
  abandonInitiative,
  InitiativeNotFoundError,
  InitiativeNotActiveError,
} from "@workspace/services-recovery";
import { callerHasBrandAccess } from "@workspace/quality-gate";
import { requireAuth } from "../middlewares/auth";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { RecoveryReport } from "../pdf/recovery-report";
import { buildBrandReportData, listAllBrands } from "../pdf/build-report-data";

const router: IRouter = Router();
router.use(requireAuth);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ensureRead(
  req: { auth?: { userId: string }; log: { error: (obj: unknown, msg?: string) => void } },
  brandId: string | undefined,
): Promise<
  | { ok: true; userId: string; brandId: string }
  | { ok: false; status: number; error: string }
> {
  if (!req.auth) return { ok: false, status: 401, error: "unauthenticated" };
  if (!brandId || typeof brandId !== "string" || !UUID_RE.test(brandId)) {
    // Reject bad input deterministically instead of letting the DB
    // raise a 22P02 (`invalid input syntax for type uuid`) deep inside
    // callerHasBrandAccess and bubbling as a 500.
    return { ok: false, status: 400, error: "brandId must be a UUID" };
  }
  try {
    const has = await callerHasBrandAccess(brandId, req.auth.userId);
    if (!has) return { ok: false, status: 403, error: "no access to this brand" };
  } catch (err) {
    req.log.error({ err }, "recovery: brand-access lookup failed");
    return { ok: false, status: 500, error: "brand access lookup failed" };
  }
  return { ok: true, userId: req.auth.userId, brandId };
}

/**
 * Write gate for recovery initiatives. The pack's "admin or lead"
 * wording maps to the existing role enum: `lead` doesn't exist, pod
 * leads carry the `editor` role on `user_profiles`. RLS already
 * enforces this at the DB layer (see `is_admin_or_editor_for_brand`
 * in 0009_recovery.sql); this server-side check returns a 403 with a
 * clean error message before the DB transaction fires.
 */
async function callerCanWriteInitiative(
  userId: string,
  brandId: string,
  isAdmin: boolean,
): Promise<boolean> {
  if (isAdmin) return true;
  try {
    const result = (await db.execute(
      sql`select 1 from public.user_profiles
          where user_id = ${userId}
            and role = 'editor'::public.app_user_role
            and ${brandId}::uuid = any(brand_access)
          limit 1`,
    )) as unknown as { rows?: unknown[] } | unknown[];
    const rows = Array.isArray(result) ? result : (result.rows ?? []);
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** GET /api/recovery/overview/:brandId */
router.get("/overview/:brandId", async (req, res) => {
  const guard = await ensureRead(req, req.params["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  try {
    const overview = await getRecoveryOverview(guard.brandId);
    res.json(overview);
  } catch (err) {
    req.log.error({ err }, "recovery: overview failed");
    res.status(500).json({ error: "internal_error", message: (err as Error).message });
  }
});

/** GET /api/recovery/snapshots/:brandId?days=90 */
router.get("/snapshots/:brandId", async (req, res) => {
  const guard = await ensureRead(req, req.params["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  const daysRaw = req.query["days"];
  let days = 90;
  if (typeof daysRaw === "string" && daysRaw.length > 0) {
    // Require an integer 1..730. Reject fractional input outright so
    // `?days=0.5` does not silently floor to 0 and skip the window.
    if (!/^[0-9]+$/.test(daysRaw)) {
      res.status(400).json({ error: "days must be an integer between 1 and 730" });
      return;
    }
    const n = Number(daysRaw);
    if (!Number.isInteger(n) || n < 1 || n > 730) {
      res.status(400).json({ error: "days must be an integer between 1 and 730" });
      return;
    }
    days = n;
  }
  try {
    const rows = await getSnapshots(guard.brandId, { days });
    res.json({ snapshots: rows });
  } catch (err) {
    req.log.error({ err }, "recovery: snapshots failed");
    res.status(500).json({ error: "internal_error", message: (err as Error).message });
  }
});

/** GET /api/recovery/initiatives/:brandId */
router.get("/initiatives/:brandId", async (req, res) => {
  const guard = await ensureRead(req, req.params["brandId"]);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  try {
    const rows = await getInitiatives(guard.brandId);
    res.json({ initiatives: rows });
  } catch (err) {
    req.log.error({ err }, "recovery: initiatives failed");
    res.status(500).json({ error: "internal_error", message: (err as Error).message });
  }
});

/**
 * Map a service-layer error into an HTTP response. Returns true if the
 * error was recognised and a response was written.
 */
function handleInitiativeError(
  res: { status: (code: number) => { json: (b: unknown) => void } },
  err: unknown,
): boolean {
  if (err instanceof InitiativeNotFoundError) {
    res.status(404).json({ error: "not_found", message: err.message });
    return true;
  }
  if (err instanceof InitiativeNotActiveError) {
    res
      .status(409)
      .json({ error: "invalid_status", message: err.message });
    return true;
  }
  return false;
}

interface CreateInitiativeBody {
  brandId?: string;
  name?: string;
  type?: string;
  description?: string | null;
  expectedImpactPct?: number | null;
  expectedImpactClicks?: number | null;
  startedAt?: string;
}

/** POST /api/recovery/initiatives */
router.post("/initiatives", async (req, res) => {
  const body = (req.body ?? {}) as CreateInitiativeBody;
  const guard = await ensureRead(req, body.brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  const isAdmin = req.auth?.isAdmin === true;
  if (!(await callerCanWriteInitiative(guard.userId, guard.brandId, isAdmin))) {
    res.status(403).json({ error: "admin or editor role required" });
    return;
  }
  if (!body.name || typeof body.name !== "string") {
    res.status(400).json({ error: "name required" });
    return;
  }
  if (body.name.length < 5 || body.name.length > 100) {
    res.status(400).json({ error: "name must be 5–100 characters" });
    return;
  }
  if (!body.type || typeof body.type !== "string") {
    res.status(400).json({ error: "type required" });
    return;
  }
  if (!body.startedAt || typeof body.startedAt !== "string") {
    res.status(400).json({ error: "startedAt required" });
    return;
  }
  const startedAtDate = new Date(body.startedAt);
  if (Number.isNaN(startedAtDate.getTime())) {
    res.status(400).json({ error: "startedAt must be a valid date" });
    return;
  }
  if (
    body.expectedImpactPct != null &&
    (body.expectedImpactPct < 0 || body.expectedImpactPct > 200)
  ) {
    res.status(400).json({ error: "expectedImpactPct must be between 0 and 200" });
    return;
  }
  try {
    const initiative = await createInitiative({
      brandId: guard.brandId,
      actorId: guard.userId,
      name: body.name,
      type: body.type as Parameters<typeof createInitiative>[0]["type"],
      description: body.description ?? undefined,
      expectedImpactPct: body.expectedImpactPct ?? undefined,
      expectedImpactClicks: body.expectedImpactClicks ?? undefined,
      startedAt: startedAtDate,
    });
    res.status(201).json({ initiative });
  } catch (err) {
    if (err instanceof Error && err.name === "ZodError") {
      res.status(400).json({ error: "validation_failed", message: err.message });
      return;
    }
    req.log.error({ err }, "recovery: create initiative failed");
    res.status(500).json({ error: "internal_error", message: (err as Error).message });
  }
});

interface UpdateInitiativeBody {
  brandId?: string;
  name?: string;
  type?: string;
  description?: string | null;
  expectedImpactPct?: number | null;
  expectedImpactClicks?: number | null;
  startedAt?: string;
  status?: "active" | "abandoned";
}

/** PUT /api/recovery/initiatives/:id */
router.put("/initiatives/:id", async (req, res) => {
  const initiativeId = req.params["id"];
  if (!initiativeId || !UUID_RE.test(initiativeId)) {
    res.status(400).json({ error: "id must be a UUID" });
    return;
  }
  const body = (req.body ?? {}) as UpdateInitiativeBody;
  const guard = await ensureRead(req, body.brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  const isAdmin = req.auth?.isAdmin === true;
  if (!(await callerCanWriteInitiative(guard.userId, guard.brandId, isAdmin))) {
    res.status(403).json({ error: "admin or editor role required" });
    return;
  }
  if (
    body.name != null &&
    (typeof body.name !== "string" || body.name.length < 5 || body.name.length > 100)
  ) {
    res.status(400).json({ error: "name must be 5–100 characters" });
    return;
  }
  if (
    body.expectedImpactPct != null &&
    (body.expectedImpactPct < 0 || body.expectedImpactPct > 200)
  ) {
    res.status(400).json({ error: "expectedImpactPct must be between 0 and 200" });
    return;
  }
  let startedAt: Date | undefined;
  if (body.startedAt != null) {
    const d = new Date(body.startedAt);
    if (Number.isNaN(d.getTime())) {
      res.status(400).json({ error: "startedAt must be a valid date" });
      return;
    }
    startedAt = d;
  }
  try {
    // Build the patch payload as `unknown` and let Zod inside
    // `updateInitiative` validate at runtime — the inferred service
    // type narrows `status` to `undefined` because the underlying
    // RECOVERY_INITIATIVE_STATUSES enum is constructed with a `string`
    // cast and `.exclude(["completed"])` then collapses the union.
    const patch: Record<string, unknown> = {
      brandId: guard.brandId,
      actorId: guard.userId,
      initiativeId,
    };
    if (body.name !== undefined) patch["name"] = body.name;
    if (body.type !== undefined) patch["type"] = body.type;
    if (body.description !== undefined) patch["description"] = body.description;
    if (body.expectedImpactPct !== undefined)
      patch["expectedImpactPct"] = body.expectedImpactPct;
    if (body.expectedImpactClicks !== undefined)
      patch["expectedImpactClicks"] = body.expectedImpactClicks;
    if (startedAt !== undefined) patch["startedAt"] = startedAt;
    if (body.status !== undefined) patch["status"] = body.status;
    const initiative = await updateInitiative(
      patch as Parameters<typeof updateInitiative>[0],
    );
    res.json({ initiative });
  } catch (err) {
    if (handleInitiativeError(res, err)) return;
    if (err instanceof Error && err.name === "ZodError") {
      res.status(400).json({ error: "validation_failed", message: err.message });
      return;
    }
    req.log.error({ err }, "recovery: update initiative failed");
    res.status(500).json({ error: "internal_error", message: (err as Error).message });
  }
});

/** POST /api/recovery/initiatives/:id/complete */
router.post("/initiatives/:id/complete", async (req, res) => {
  const initiativeId = req.params["id"];
  if (!initiativeId || !UUID_RE.test(initiativeId)) {
    res.status(400).json({ error: "id must be a UUID" });
    return;
  }
  const body = (req.body ?? {}) as { brandId?: string; completionNotes?: string };
  const guard = await ensureRead(req, body.brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  const isAdmin = req.auth?.isAdmin === true;
  if (!(await callerCanWriteInitiative(guard.userId, guard.brandId, isAdmin))) {
    res.status(403).json({ error: "admin or editor role required" });
    return;
  }
  if (
    body.completionNotes != null &&
    (typeof body.completionNotes !== "string" || body.completionNotes.length > 2000)
  ) {
    res.status(400).json({ error: "completionNotes must be ≤ 2000 chars" });
    return;
  }
  try {
    const initiative = await completeInitiative({
      brandId: guard.brandId,
      actorId: guard.userId,
      initiativeId,
      ...(body.completionNotes ? { completionNotes: body.completionNotes } : {}),
    });
    res.json({ initiative });
  } catch (err) {
    if (handleInitiativeError(res, err)) return;
    req.log.error({ err }, "recovery: complete initiative failed");
    res.status(500).json({ error: "internal_error", message: (err as Error).message });
  }
});

/**
 * POST /api/recovery/initiatives/:id/abandon — admin-only. The UI
 * hides the affordance for non-admins, but a writer/editor hitting
 * this endpoint directly must get a 403 (not just a hidden button).
 */
router.post("/initiatives/:id/abandon", async (req, res) => {
  const initiativeId = req.params["id"];
  if (!initiativeId || !UUID_RE.test(initiativeId)) {
    res.status(400).json({ error: "id must be a UUID" });
    return;
  }
  const body = (req.body ?? {}) as { brandId?: string; reason?: string };
  const guard = await ensureRead(req, body.brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  if (req.auth?.isAdmin !== true) {
    res.status(403).json({ error: "admin role required to abandon" });
    return;
  }
  if (!body.reason || typeof body.reason !== "string" || body.reason.trim().length === 0) {
    res.status(400).json({ error: "reason required" });
    return;
  }
  if (body.reason.length > 2000) {
    res.status(400).json({ error: "reason must be ≤ 2000 chars" });
    return;
  }
  try {
    const initiative = await abandonInitiative({
      brandId: guard.brandId,
      actorId: guard.userId,
      initiativeId,
      reason: body.reason,
    });
    res.json({ initiative });
  } catch (err) {
    if (handleInitiativeError(res, err)) return;
    req.log.error({ err }, "recovery: abandon initiative failed");
    res.status(500).json({ error: "internal_error", message: (err as Error).message });
  }
});

/** GET /api/recovery/export/all.pdf — admin-only multi-brand PDF. Must be registered BEFORE the :brandId param route. */
router.get("/export/all.pdf", async (req, res) => {
  if (req.auth?.isAdmin !== true) {
    res.status(403).json({ error: "admin required" });
    return;
  }
  try {
    const brands = await listAllBrands();
    const reportData = await Promise.all(
      brands.map((b) => buildBrandReportData(b.id, b.name)),
    );
    const buf = await renderToBuffer(
      React.createElement(RecoveryReport, { brands: reportData }) as unknown as ReactElement<DocumentProps>,
    );
    const date = new Date().toISOString().slice(0, 10);
    res
      .status(200)
      .setHeader("Content-Type", "application/pdf")
      .setHeader(
        "Content-Disposition",
        `attachment; filename="recovery-all-brands-${date}.pdf"`,
      )
      .end(Buffer.from(buf));
  } catch (err) {
    req.log.error({ err }, "recovery: all-brands PDF export failed");
    res.status(500).json({ error: "pdf_generation_failed", message: (err as Error).message });
  }
});

/** GET /api/recovery/export/:brandId.pdf — admin-only single-brand PDF. */
router.get("/export/:brandId.pdf", async (req, res) => {
  const rawId = req.params["brandId"];
  if (!rawId || !UUID_RE.test(rawId)) {
    res.status(400).json({ error: "brandId must be a UUID" });
    return;
  }
  if (req.auth?.isAdmin !== true) {
    res.status(403).json({ error: "admin required" });
    return;
  }
  try {
    const brands = await listAllBrands();
    const brand = brands.find((b) => b.id === rawId);
    if (!brand) {
      res.status(404).json({ error: "brand not found" });
      return;
    }
    const data = await buildBrandReportData(brand.id, brand.name);
    const buf = await renderToBuffer(
      React.createElement(RecoveryReport, { brands: [data] }) as unknown as ReactElement<DocumentProps>,
    );
    res
      .status(200)
      .setHeader("Content-Type", "application/pdf")
      .setHeader(
        "Content-Disposition",
        `attachment; filename="recovery-${brand.name.toLowerCase().replace(/\s+/g, "-")}-${data.generatedDate}.pdf"`,
      )
      .end(Buffer.from(buf));
  } catch (err) {
    req.log.error({ err }, "recovery: PDF export failed");
    res.status(500).json({ error: "pdf_generation_failed", message: (err as Error).message });
  }
});

export default router;
