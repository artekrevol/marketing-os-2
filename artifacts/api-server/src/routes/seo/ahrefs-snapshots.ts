/**
 * Ahrefs Snapshot Storage — two-step upload/ingest architecture.
 *
 * Step 1 (HTTP, fast):  Browser uploads XLSX files one-at-a-time to this
 *   API server via multipart. The server stores each file in GCS using a
 *   sidecar-signed presigned PUT URL, then records the object path in the
 *   ahrefs_raw_snapshots row. No parsing, no DB inserts, no risk of timeout.
 *
 * Step 2 (BullMQ, background):  POST /:id/ingest enqueues a worker job that
 *   downloads every file from GCS, parses XLSX, upserts into intelligence
 *   tables, and updates the snapshot status.
 *
 * Snapshots are organised by month ("2026-07") so historical data is
 * permanently stored and re-ingestable without re-uploading from Ahrefs.
 */
import { Router, type IRouter } from "express";
import multer from "multer";
import { sql } from "drizzle-orm";
import { withBrandScope } from "@workspace/db";
import { requireAuth } from "../../middlewares/auth.js";
import { guardBrand, requireAdminOrLead } from "./_shared.js";
import { enqueue } from "@workspace/jobs";

const router: IRouter = Router();
router.use(requireAuth);

/** One file per request — avoids body-size limits entirely. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
});

/* ─── GCS helpers ─────────────────────────────────────────────────────────── */

const SIDECAR = "http://127.0.0.1:1106";

function getBucket(): string {
  const b = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
  if (!b) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
  return b;
}

async function gcsSignUrl(
  objectName: string,
  method: "PUT" | "GET",
  ttlSec: number,
): Promise<string> {
  const res = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: getBucket(),
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`sidecar signUrl ${method} failed (${res.status}): ${text}`);
  }
  const body = (await res.json()) as { signed_url: string };
  return body.signed_url;
}

async function gcsUploadBuffer(
  objectName: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  const url = await gcsSignUrl(objectName, "PUT", 300);
  // Node 18+ fetch supports Buffer bodies; cast to satisfy TS
  const res = await fetch(url, {
    method: "PUT",
    body: buffer as unknown as BodyInit,
    headers: { "Content-Type": contentType },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GCS upload failed (${res.status}): ${text}`);
  }
}

/* ─── Utility ─────────────────────────────────────────────────────────────── */

function safeName(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/* ─── POST / — create a new pending snapshot ──────────────────────────────── */

router.post("/", async (req, res) => {
  if (!requireAdminOrLead(req, res)) return;
  const { brandId, snapshotMonth } = req.body as {
    brandId?: string;
    snapshotMonth?: string;
  };

  if (!brandId || !snapshotMonth || !/^\d{4}-\d{2}$/.test(snapshotMonth)) {
    res.status(400).json({ error: "brandId and snapshotMonth (YYYY-MM) required" });
    return;
  }

  const guard = await guardBrand(req, brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }

  try {
    const result = await withBrandScope(guard.brandId, async ({ db }) => {
      const r = (await db.execute(sql`
        INSERT INTO ahrefs_raw_snapshots
          (brand_id, snapshot_month, status, file_count, file_paths, created_at)
        VALUES
          (${guard.brandId}::uuid, ${snapshotMonth}, 'pending', 0, '[]'::jsonb, now())
        RETURNING id::text
      `)) as unknown as { rows?: Array<{ id: string }> } | Array<{ id: string }>;
      const rows = Array.isArray(r) ? r : (r.rows ?? []);
      return rows[0]?.id ?? null;
    });
    if (!result) throw new Error("INSERT returned no id");
    res.json({ snapshotId: result });
  } catch (err) {
    res.status(500).json({ error: "Failed to create snapshot", detail: String(err) });
  }
});

/* ─── POST /:id/files — upload one XLSX file → GCS ───────────────────────── */

router.post("/:id/files", upload.single("file"), async (req, res) => {
  if (!requireAdminOrLead(req, res)) return;
  const snapshotId = req.params["id"]!;
  const brandId = (req.body as Record<string, string>)["brandId"];

  const guard = await guardBrand(req, brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }

  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }

  try {
    // Verify snapshot belongs to this brand and is still pending
    const snap = await withBrandScope(guard.brandId, async ({ db }) => {
      const r = (await db.execute(sql`
        SELECT snapshot_month, status
        FROM ahrefs_raw_snapshots
        WHERE id = ${snapshotId}::uuid AND brand_id = ${guard.brandId}::uuid
        LIMIT 1
      `)) as unknown as { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
      const rows = Array.isArray(r) ? r : (r.rows ?? []);
      return rows[0] ?? null;
    });

    if (!snap) {
      res.status(404).json({ error: "Snapshot not found" });
      return;
    }
    if (snap["status"] !== "pending") {
      res.status(409).json({ error: `Cannot add files to a ${snap["status"]} snapshot` });
      return;
    }

    const snapshotMonth = String(snap["snapshot_month"]);
    const objectName = `ahrefs/${guard.brandId}/${snapshotMonth}/${safeName(file.originalname)}`;
    const mime = file.mimetype || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    // Server-side GCS upload
    await gcsUploadBuffer(objectName, file.buffer, mime);

    // Append object path to snapshot.file_paths[]
    const entry = JSON.stringify([{ name: file.originalname, objectName, size: file.size }]);
    await withBrandScope(guard.brandId, async ({ db }) => {
      await db.execute(sql`
        UPDATE ahrefs_raw_snapshots
        SET
          file_paths = file_paths || ${entry}::jsonb,
          file_count = file_count + 1
        WHERE id = ${snapshotId}::uuid AND brand_id = ${guard.brandId}::uuid
      `);
    });

    res.json({ ok: true, objectName, name: file.originalname });
  } catch (err) {
    res.status(500).json({ error: "File upload failed", detail: String(err) });
  }
});

/* ─── POST /:id/ingest — enqueue background ingest job ──────────────────── */

router.post("/:id/ingest", async (req, res) => {
  if (!requireAdminOrLead(req, res)) return;
  const snapshotId = req.params["id"]!;
  const { brandId } = req.body as { brandId?: string };

  const guard = await guardBrand(req, brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }

  try {
    const snap = await withBrandScope(guard.brandId, async ({ db }) => {
      const r = (await db.execute(sql`
        SELECT status, file_count
        FROM ahrefs_raw_snapshots
        WHERE id = ${snapshotId}::uuid AND brand_id = ${guard.brandId}::uuid
        LIMIT 1
      `)) as unknown as { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
      const rows = Array.isArray(r) ? r : (r.rows ?? []);
      return rows[0] ?? null;
    });

    if (!snap) {
      res.status(404).json({ error: "Snapshot not found" });
      return;
    }
    if (Number(snap["file_count"]) === 0) {
      res.status(400).json({ error: "No files uploaded to this snapshot yet" });
      return;
    }
    if (snap["status"] !== "pending") {
      res.status(409).json({ error: `Snapshot is already ${snap["status"]}` });
      return;
    }

    const { jobId, queueName } = await enqueue("seo.ingest-ahrefs-snapshot", {
      idempotencyKey: `ingest-ahrefs:${snapshotId}`,
      brandId: guard.brandId,
      snapshotId,
    });

    res.json({ ok: true, jobId, queueName, snapshotId });
  } catch (err) {
    res.status(500).json({ error: "Failed to enqueue ingest job", detail: String(err) });
  }
});

/* ─── GET / — list snapshots for a brand ────────────────────────────────── */

router.get("/", async (req, res) => {
  const brandId = req.query["brandId"] as string | undefined;
  const guard = await guardBrand(req, brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }

  try {
    const rows = await withBrandScope(guard.brandId, async ({ db }) => {
      const r = (await db.execute(sql`
        SELECT
          s.id::text,
          s.snapshot_month,
          s.status,
          s.file_count,
          s.file_paths,
          s.row_counts,
          s.error_message,
          s.created_at,
          s.ingest_started_at,
          s.ingest_completed_at,
          b.backlink_count,
          b.page_count,
          b.content_gap_count,
          b.delta_new_links,
          b.delta_lost_links
        FROM ahrefs_raw_snapshots s
        LEFT JOIN ahrefs_import_batches b ON b.id = s.batch_id
        WHERE s.brand_id = ${guard.brandId}::uuid
        ORDER BY s.created_at DESC
        LIMIT 50
      `)) as unknown as { rows?: unknown[] } | unknown[];
      return Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? []);
    });
    res.json({ snapshots: rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to list snapshots", detail: String(err) });
  }
});

/* ─── GET /:id — get snapshot status (for polling) ──────────────────────── */

router.get("/:id", async (req, res) => {
  const snapshotId = req.params["id"]!;
  const brandId = req.query["brandId"] as string | undefined;
  const guard = await guardBrand(req, brandId);
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }

  try {
    const rows = await withBrandScope(guard.brandId, async ({ db }) => {
      const r = (await db.execute(sql`
        SELECT
          s.id::text,
          s.snapshot_month,
          s.status,
          s.file_count,
          s.file_paths,
          s.row_counts,
          s.error_message,
          s.created_at,
          s.ingest_started_at,
          s.ingest_completed_at
        FROM ahrefs_raw_snapshots s
        WHERE s.id = ${snapshotId}::uuid AND s.brand_id = ${guard.brandId}::uuid
        LIMIT 1
      `)) as unknown as { rows?: unknown[] } | unknown[];
      return Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? []);
    });
    const snapshot = rows[0] ?? null;
    if (!snapshot) {
      res.status(404).json({ error: "Snapshot not found" });
      return;
    }
    res.json({ snapshot });
  } catch (err) {
    res.status(500).json({ error: "Failed to get snapshot", detail: String(err) });
  }
});

export default router;
