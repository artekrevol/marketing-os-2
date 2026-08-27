-- Migration 0007: make telemetry attribution explicit.
--
-- Existing NULL brand_id rows in platform telemetry are preserved as
-- explicitly global. AI usage is different: it represents billable work and
-- must resolve to the owning project's brand before the NOT NULL constraint
-- is applied. The migration aborts if an orphaned usage row remains so no
-- cost can be silently assigned to the wrong brand.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'brand';
UPDATE events
  SET scope = 'global'
  WHERE brand_id IS NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_scope_brand_consistency'
  ) THEN
    ALTER TABLE events
      ADD CONSTRAINT events_scope_brand_consistency
      CHECK (
        (scope = 'brand' AND brand_id IS NOT NULL)
        OR (scope = 'global' AND brand_id IS NULL)
      );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS events_brand_created_idx
  ON events (brand_id, created_at DESC);

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'brand';
UPDATE audit_log
  SET scope = 'global'
  WHERE brand_id IS NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_log_scope_brand_consistency'
  ) THEN
    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_scope_brand_consistency
      CHECK (
        (scope = 'brand' AND brand_id IS NOT NULL)
        OR (scope = 'global' AND brand_id IS NULL)
      );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS audit_log_brand_created_idx
  ON audit_log (brand_id, created_at DESC);

UPDATE usage_logs AS usage
  SET brand_id = projects.brand_id
  FROM projects
  WHERE usage.brand_id IS NULL
    AND usage.project_id = projects.id;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM usage_logs WHERE brand_id IS NULL) THEN
    RAISE EXCEPTION
      'Cannot make usage_logs.brand_id required: orphaned usage rows remain';
  END IF;
END $$;
ALTER TABLE usage_logs
  ALTER COLUMN brand_id SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'usage_logs_brand_id_brands_id_fk'
  ) THEN
    ALTER TABLE usage_logs
      ADD CONSTRAINT usage_logs_brand_id_brands_id_fk
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS usage_logs_brand_created_idx
  ON usage_logs (brand_id, created_at DESC);

ALTER TABLE integration_call_log
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'brand';
UPDATE integration_call_log
  SET scope = 'global'
  WHERE brand_id IS NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'integration_call_log_scope_brand_consistency'
  ) THEN
    ALTER TABLE integration_call_log
      ADD CONSTRAINT integration_call_log_scope_brand_consistency
      CHECK (
        (scope = 'brand' AND brand_id IS NOT NULL)
        OR (scope = 'global' AND brand_id IS NULL)
      );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS integration_call_log_brand_occurred_idx
  ON integration_call_log (brand_id, occurred_at DESC);