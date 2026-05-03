-- 0006: idempotency guard for in-flight QA runs.
--
-- A partial unique index on qa_runs(content_object_id) WHERE status IN
-- ('queued','running') ensures that two concurrent submitForReview()
-- requests for the same content_object cannot both create new runs.
-- The service layer catches the unique-violation (sqlstate 23505) and
-- returns the existing in-flight run instead.
--
-- Safe to apply multiple times via IF NOT EXISTS.

create unique index if not exists qa_runs_inflight_unique
  on public.qa_runs (content_object_id)
  where status in ('queued','running');
