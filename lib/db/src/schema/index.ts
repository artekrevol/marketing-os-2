// Drizzle table declarations. This is a partial mirror of the Supabase
// schema, projecting only what the worker / api-server / quality-gate
// service need to read or write. The canonical schema is owned by
// `artifacts/insight-forge/supabase/migrations/*.sql`.
//
// Adding a new brand-scoped table:
//   1. Author its `pgTable(...)` here.
//   2. Re-export from this file.
//   3. Add to BRAND_SCOPED_TABLES in `../brand-scope.ts`.
//   4. Reference it from worker code only inside `withBrandScope(...)`.

export * from "./brands";
export * from "./events";
export * from "./dead-jobs";
export * from "./integration-call-log";
export * from "./projects";
export * from "./drafts";
// Sprint 3 — Quality Gate
export * from "./content-objects";
export * from "./qa-runs";
export * from "./qa-check-results";
export * from "./qa-signoffs";
export * from "./qa-overrides";
export * from "./qa-check-definitions";
