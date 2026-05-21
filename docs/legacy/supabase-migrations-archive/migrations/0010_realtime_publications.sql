-- Migration 0010: Enable Supabase Realtime for all tables that the frontend
-- subscribes to via postgres_changes. Without this, channel subscriptions
-- receive no events even when rows are updated by the service-role worker.
--
-- Tables enabled:
--   insight-forge: projects, outlines, research_briefs, proof_points, drafts
--   seo-os:        content_objects, qa_runs, recovery_initiatives
--
-- REPLICA IDENTITY FULL is required so that filtered subscriptions
-- (e.g. filter: `id=eq.<uuid>`) receive the full OLD/NEW row and
-- RLS can be enforced on the subscriber side.

alter table public.projects          replica identity full;
alter table public.outlines          replica identity full;
alter table public.research_briefs   replica identity full;
alter table public.proof_points      replica identity full;
alter table public.drafts            replica identity full;
alter table public.content_objects   replica identity full;
alter table public.qa_runs           replica identity full;
alter table public.recovery_initiatives replica identity full;

alter publication supabase_realtime add table public.projects;
alter publication supabase_realtime add table public.outlines;
alter publication supabase_realtime add table public.research_briefs;
alter publication supabase_realtime add table public.proof_points;
alter publication supabase_realtime add table public.drafts;
alter publication supabase_realtime add table public.content_objects;
alter publication supabase_realtime add table public.qa_runs;
alter publication supabase_realtime add table public.recovery_initiatives;
