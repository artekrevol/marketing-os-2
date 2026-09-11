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

    const filename = safeName(file.originalname);

    // Stage the bytes in Postgres. They have to outlive this request: multer
    // takes one file per call, but the ingest job builds a single import batch
    // across every file in the snapshot. The worker deletes them once ingest
    // succeeds.
    const fileId = await withBrandScope(guard.brandId, async ({ db }) => {
      const inserted = (await db.execute(sql`
        INSERT INTO ahrefs_snapshot_files
          (snapshot_id, brand_id, filename, size_bytes, data)
        VALUES (
          ${snapshotId}::uuid,
          ${guard.brandId}::uuid,
          ${filename},
          ${file.size},
          ${file.buffer}
        )
        RETURNING id::text
      `)) as unknown as { rows?: Array<{ id: string }> } | Array<{ id: string }>;
      const rows = Array.isArray(inserted) ? inserted : (inserted.rows ?? []);
      const id = rows[0]?.id;
      if (!id) throw new Error("staging insert returned no row");

      // Keep file_paths as the human-readable manifest the list endpoints show.
      const entry = JSON.stringify([
        { name: file.originalname, fileId: id, size: file.size },
      ]);
      await db.execute(sql`
        UPDATE ahrefs_raw_snapshots
        SET
          file_paths = file_paths || ${entry}::jsonb,
          file_count = file_count + 1
        WHERE id = ${snapshotId}::uuid AND brand_id = ${guard.brandId}::uuid
      `);
      return id;
    });

    res.json({ ok: true, fileId, name: file.originalname });
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
