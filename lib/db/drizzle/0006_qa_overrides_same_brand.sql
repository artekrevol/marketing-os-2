-- Complete the QA child ownership boundary for databases that already
-- applied 0005_brand_isolation. Older preview databases did not yet have
-- qa_run_id; preserve any legacy rows before making the new ownership key
-- required.
CREATE TABLE IF NOT EXISTS qa_overrides_legacy_quarantine (LIKE qa_overrides INCLUDING ALL);
ALTER TABLE qa_overrides
  ADD COLUMN IF NOT EXISTS qa_run_id uuid;
ALTER TABLE qa_overrides_legacy_quarantine
  ADD COLUMN IF NOT EXISTS qa_run_id uuid;
INSERT INTO qa_overrides_legacy_quarantine
SELECT * FROM qa_overrides
WHERE qa_run_id IS NULL
ON CONFLICT DO NOTHING;
DELETE FROM qa_overrides WHERE qa_run_id IS NULL;
ALTER TABLE qa_overrides
  ALTER COLUMN qa_run_id SET NOT NULL;
ALTER TABLE qa_overrides
  ADD CONSTRAINT qa_overrides_run_fk
  FOREIGN KEY (qa_run_id) REFERENCES qa_runs(id) ON DELETE CASCADE;
ALTER TABLE qa_overrides
  ADD CONSTRAINT qa_overrides_run_same_brand_fk
  FOREIGN KEY (qa_run_id, brand_id) REFERENCES qa_runs(id, brand_id) NOT VALID;