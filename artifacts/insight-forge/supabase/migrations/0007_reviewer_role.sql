-- Sprint 3 — Quality Gate Part 1
--
-- Adds the `reviewer` value to the `public.app_user_role` enum so the
-- /api/quality-gate/decide route's reviewer-or-admin gate
-- (`role IN ('admin','reviewer')`) can resolve without an
-- "invalid input value for enum" error.
--
-- `ALTER TYPE ... ADD VALUE` cannot run inside an explicit transaction
-- block in Postgres < 12; Supabase runs each migration file in its own
-- transaction, so we keep this single statement isolated and use the
-- IF NOT EXISTS clause (Postgres 12+) to make the migration idempotent.

alter type public.app_user_role add value if not exists 'reviewer';
