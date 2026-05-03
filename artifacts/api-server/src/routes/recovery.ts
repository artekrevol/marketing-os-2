import { Router, type IRouter } from "express";
import {
  getRecoveryOverview,
  getSnapshots,
  getInitiatives,
} from "@workspace/services-recovery";
import { callerHasBrandAccess } from "@workspace/quality-gate";
import { requireAuth } from "../middlewares/auth";

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

export default router;
