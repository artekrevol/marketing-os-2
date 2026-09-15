-- Tenant isolation hardening.
--
-- fetched_pages used to be a nullable, globally keyed cache. Preserve legacy
-- unowned rows in a private quarantine table instead of guessing which brand
-- owns them, then make all new cache rows brand-owned.
CREATE TABLE IF NOT EXISTS fetched_pages_unowned_quarantine (LIKE fetched_pages INCLUDING ALL);
INSERT INTO fetched_pages_unowned_quarantine
SELECT * FROM fetched_pages WHERE brand_id IS NULL
ON CONFLICT DO NOTHING;
DELETE FROM fetched_pages WHERE brand_id IS NULL;

ALTER TABLE fetched_pages DROP CONSTRAINT IF EXISTS fetched_pages_url_unique;
ALTER TABLE fetched_pages ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE fetched_pages DROP CONSTRAINT IF EXISTS fetched_pages_brand_id_fkey;
ALTER TABLE fetched_pages
  ADD CONSTRAINT fetched_pages_brand_id_fkey
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE RESTRICT;
ALTER TABLE fetched_pages DROP CONSTRAINT IF EXISTS fetched_pages_brand_url_unique;
ALTER TABLE fetched_pages
  ADD CONSTRAINT fetched_pages_brand_url_unique UNIQUE (brand_id, url);

-- Parent/child relationships must include brand_id on both sides. Existing
-- orphaned or mismatched rows are left untouched by this migration and can be
-- validated explicitly before enabling each constraint in environments with
-- legacy data.
--
-- Every ADD CONSTRAINT below is wrapped in a pg_constraint existence check.
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, and this migration must be
-- safe to run twice: once against a legacy database being patched (the
-- original case this migration was written for) and once against a brand
-- new database that `drizzle-kit push` already brought to the current
-- schema — including these exact constraints — before migrations run.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_id_brand_uq') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_id_brand_uq UNIQUE (id, brand_id);
  END IF;
END $$;

-- Composite keys below are deliberately NOT VALID: they enforce all future
-- writes immediately while allowing an operator to inspect and remediate
-- legacy mismatches before validation. API and worker lookups are already
-- brand-predicate guarded, so legacy rows cannot become a cross-brand read.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'locations_id_brand_uq') THEN
    ALTER TABLE locations ADD CONSTRAINT locations_id_brand_uq UNIQUE (id, brand_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'keyword_lists_id_brand_uq') THEN
    ALTER TABLE keyword_lists ADD CONSTRAINT keyword_lists_id_brand_uq UNIQUE (id, brand_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'keywords_id_brand_uq') THEN
    ALTER TABLE keywords ADD CONSTRAINT keywords_id_brand_uq UNIQUE (id, brand_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crawl_batches_id_brand_uq') THEN
    ALTER TABLE crawl_batches ADD CONSTRAINT crawl_batches_id_brand_uq UNIQUE (id, brand_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_objects_id_brand_uq') THEN
    ALTER TABLE content_objects ADD CONSTRAINT content_objects_id_brand_uq UNIQUE (id, brand_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qa_runs_id_brand_uq') THEN
    ALTER TABLE qa_runs ADD CONSTRAINT qa_runs_id_brand_uq UNIQUE (id, brand_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'keyword_lists_parent_same_brand_fk') THEN
    ALTER TABLE keyword_lists
      ADD CONSTRAINT keyword_lists_parent_same_brand_fk
      FOREIGN KEY (parent_list_id, brand_id) REFERENCES keyword_lists(id, brand_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'keywords_list_same_brand_fk') THEN
    ALTER TABLE keywords
      ADD CONSTRAINT keywords_list_same_brand_fk
      FOREIGN KEY (list_id, brand_id) REFERENCES keyword_lists(id, brand_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'keywords_location_same_brand_fk') THEN
    ALTER TABLE keywords
      ADD CONSTRAINT keywords_location_same_brand_fk
      FOREIGN KEY (location_id, brand_id) REFERENCES locations(id, brand_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crawl_schedules_list_same_brand_fk') THEN
    ALTER TABLE crawl_schedules
      ADD CONSTRAINT crawl_schedules_list_same_brand_fk
      FOREIGN KEY (list_id, brand_id) REFERENCES keyword_lists(id, brand_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rank_snapshots_keyword_same_brand_fk') THEN
    ALTER TABLE rank_snapshots
      ADD CONSTRAINT rank_snapshots_keyword_same_brand_fk
      FOREIGN KEY (keyword_id, brand_id) REFERENCES keywords(id, brand_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rank_snapshots_location_same_brand_fk') THEN
    ALTER TABLE rank_snapshots
      ADD CONSTRAINT rank_snapshots_location_same_brand_fk
      FOREIGN KEY (location_id, brand_id) REFERENCES locations(id, brand_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rank_snapshots_batch_same_brand_fk') THEN
    ALTER TABLE rank_snapshots
      ADD CONSTRAINT rank_snapshots_batch_same_brand_fk
      FOREIGN KEY (batch_id, brand_id) REFERENCES crawl_batches(id, brand_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitor_pages_keyword_same_brand_fk') THEN
    ALTER TABLE competitor_pages
      ADD CONSTRAINT competitor_pages_keyword_same_brand_fk
      FOREIGN KEY (keyword_id, brand_id) REFERENCES keywords(id, brand_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_target_location_same_brand_fk') THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_target_location_same_brand_fk
      FOREIGN KEY (target_location_id, brand_id) REFERENCES locations(id, brand_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_objects_project_same_brand_fk') THEN
    ALTER TABLE content_objects
      ADD CONSTRAINT content_objects_project_same_brand_fk
      FOREIGN KEY (project_id, brand_id) REFERENCES projects(id, brand_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qa_runs_content_object_same_brand_fk') THEN
    ALTER TABLE qa_runs
      ADD CONSTRAINT qa_runs_content_object_same_brand_fk
      FOREIGN KEY (content_object_id, brand_id) REFERENCES content_objects(id, brand_id) NOT VALID;
  END IF;
END $$;

ALTER TABLE qa_signoffs
  ADD COLUMN IF NOT EXISTS qa_run_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qa_signoffs_run_fk') THEN
    ALTER TABLE qa_signoffs
      ADD CONSTRAINT qa_signoffs_run_fk
      FOREIGN KEY (qa_run_id) REFERENCES qa_runs(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qa_check_results_run_same_brand_fk') THEN
    ALTER TABLE qa_check_results
      ADD CONSTRAINT qa_check_results_run_same_brand_fk
      FOREIGN KEY (qa_run_id, brand_id) REFERENCES qa_runs(id, brand_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qa_signoffs_content_object_same_brand_fk') THEN
    ALTER TABLE qa_signoffs
      ADD CONSTRAINT qa_signoffs_content_object_same_brand_fk
      FOREIGN KEY (content_object_id, brand_id) REFERENCES content_objects(id, brand_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qa_signoffs_run_same_brand_fk') THEN
    ALTER TABLE qa_signoffs
      ADD CONSTRAINT qa_signoffs_run_same_brand_fk
      FOREIGN KEY (qa_run_id, brand_id) REFERENCES qa_runs(id, brand_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_url_keyword_link_project_same_brand_fk') THEN
    ALTER TABLE content_url_keyword_link
      ADD CONSTRAINT content_url_keyword_link_project_same_brand_fk
      FOREIGN KEY (project_id, brand_id) REFERENCES projects(id, brand_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_url_keyword_link_keyword_same_brand_fk') THEN
    ALTER TABLE content_url_keyword_link
      ADD CONSTRAINT content_url_keyword_link_keyword_same_brand_fk
      FOREIGN KEY (keyword_id, brand_id) REFERENCES keywords(id, brand_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'keyword_research_briefs_project_same_brand_fk') THEN
    ALTER TABLE keyword_research_briefs
      ADD CONSTRAINT keyword_research_briefs_project_same_brand_fk
      FOREIGN KEY (project_id, brand_id) REFERENCES projects(id, brand_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'keyword_research_briefs_location_same_brand_fk') THEN
    ALTER TABLE keyword_research_briefs
      ADD CONSTRAINT keyword_research_briefs_location_same_brand_fk
      FOREIGN KEY (location_id, brand_id) REFERENCES locations(id, brand_id) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'google_oauth_states_brand_fk') THEN
    ALTER TABLE google_oauth_states
      ADD CONSTRAINT google_oauth_states_brand_fk
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_plans_id_brand_uq') THEN
    ALTER TABLE content_plans
      ADD CONSTRAINT content_plans_id_brand_uq UNIQUE (id, brand_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_plans_project_same_brand_fk') THEN
    ALTER TABLE content_plans
      ADD CONSTRAINT content_plans_project_same_brand_fk
      FOREIGN KEY (project_id, brand_id) REFERENCES projects(id, brand_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_plans_superseded_same_brand_fk') THEN
    ALTER TABLE content_plans
      ADD CONSTRAINT content_plans_superseded_same_brand_fk
      FOREIGN KEY (superseded_by, brand_id) REFERENCES content_plans(id, brand_id) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'research_briefs_project_same_brand_fk') THEN
    ALTER TABLE research_briefs
      ADD CONSTRAINT research_briefs_project_same_brand_fk
      FOREIGN KEY (project_id, brand_id) REFERENCES projects(id, brand_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drafts_project_same_brand_fk') THEN
    ALTER TABLE drafts
      ADD CONSTRAINT drafts_project_same_brand_fk
      FOREIGN KEY (project_id, brand_id) REFERENCES projects(id, brand_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proof_points_project_same_brand_fk') THEN
    ALTER TABLE proof_points
      ADD CONSTRAINT proof_points_project_same_brand_fk
      FOREIGN KEY (project_id, brand_id) REFERENCES projects(id, brand_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outlines_project_same_brand_fk') THEN
    ALTER TABLE outlines
      ADD CONSTRAINT outlines_project_same_brand_fk
      FOREIGN KEY (project_id, brand_id) REFERENCES projects(id, brand_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'draft_scores_project_same_brand_fk') THEN
    ALTER TABLE draft_scores
      ADD CONSTRAINT draft_scores_project_same_brand_fk
      FOREIGN KEY (project_id, brand_id) REFERENCES projects(id, brand_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_answers_project_same_brand_fk') THEN
    ALTER TABLE interview_answers
      ADD CONSTRAINT interview_answers_project_same_brand_fk
      FOREIGN KEY (project_id, brand_id) REFERENCES projects(id, brand_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voice_library_project_same_brand_fk') THEN
    ALTER TABLE voice_library
      ADD CONSTRAINT voice_library_project_same_brand_fk
      FOREIGN KEY (project_id, brand_id) REFERENCES projects(id, brand_id) NOT VALID;
  END IF;
END $$;
