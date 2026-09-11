-- Stage Ahrefs XLSX uploads in Postgres instead of Replit object storage.
--
-- The two-step flow (upload files, then ingest) needs the bytes to survive
-- between requests: multer accepts one file per request, but the ingest job
-- creates a single import batch across ALL files and computes its deltas over
-- that whole batch. Parsing inline at upload time would make every file its
-- own batch and report wrong new/lost-link counts.
--
-- Previously the bytes went to GCS via the Replit sidecar at 127.0.0.1:1106,
-- which does not exist off Replit. They now live in a bytea column, TOASTed
-- out of line, and are DELETED as soon as ingest succeeds — nothing re-reads
-- them (POST /:id/ingest returns 409 unless status = 'pending', and status
-- never returns to pending), so retention would be pure growth.

-- Required so ahrefs_snapshot_files can carry a same-brand composite FK.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ahrefs_raw_snapshots_id_brand_uq') THEN
    ALTER TABLE ahrefs_raw_snapshots
      ADD CONSTRAINT ahrefs_raw_snapshots_id_brand_uq UNIQUE (id, brand_id);
  END IF;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS ahrefs_snapshot_files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES ahrefs_raw_snapshots(id) ON DELETE CASCADE,
  brand_id    uuid NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
  filename    text NOT NULL,
  size_bytes  integer NOT NULL,
  data        bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- A staged file can never belong to another tenant's snapshot.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ahrefs_snapshot_files_same_brand_fk') THEN
    ALTER TABLE ahrefs_snapshot_files
      ADD CONSTRAINT ahrefs_snapshot_files_same_brand_fk
      FOREIGN KEY (snapshot_id, brand_id) REFERENCES ahrefs_raw_snapshots(id, brand_id);
  END IF;
END $$;
--> statement-breakpoint

-- 50 MB per file, matching the multer limit on the upload route.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ahrefs_snapshot_files_size_chk') THEN
    ALTER TABLE ahrefs_snapshot_files
      ADD CONSTRAINT ahrefs_snapshot_files_size_chk
      CHECK (size_bytes > 0 AND size_bytes <= 52428800);
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS ahrefs_snapshot_files_snapshot_idx
  ON ahrefs_snapshot_files (snapshot_id, created_at);
