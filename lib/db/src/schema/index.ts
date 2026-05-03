// Sprint 2 — Drizzle table declarations for the worker tier.
//
// IMPORTANT: this is not a complete mirror of the Supabase schema. It
// covers the subset the worker reads/writes (events, dead_jobs,
// integration_call_log) plus brands/projects to support withBrandScope's
// BRAND_SCOPED_TABLES enforcement and project→brand resolution. The
// full Supabase schema is owned by `artifacts/insight-forge/supabase/migrations/*.sql`
// and consumed by the frontend through the supabase-js client.
//
// Adding a new brand-scoped table to the worker:
//   1. Author its `pgTable(...)` here.
//   2. Add it to BRAND_SCOPED_TABLES in `../brand-scope.ts`.
//   3. Reference it from the worker only inside `withBrandScope(brandId, ...)`.

export * from "./brands";
export * from "./events";
export * from "./dead-jobs";
export * from "./integration-call-log";
export * from "./projects";
