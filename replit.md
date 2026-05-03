# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## SEO OS — Tenancy rules (normalized)

Sprint 1 shipped a single trigger named `tenant_brand_inherit()` on every brand-scoped table. The trigger resolves `brand_id` BEFORE INSERT in this order:

1. The caller-supplied `NEW.brand_id` (Pattern A, used by `projects` — the tenant root).
2. Inherited from the parent `projects` row via `project_id` (Pattern B, used by every brand-scoped child table that has `project_id`).
3. The caller's first `brand_access` entry from `user_profiles` (covers writes that have no `project_id` — telemetry, voice library, fetched pages — so they still land in the writer's primary brand).
4. Otherwise raises so the row is never created without tenancy.

This is **one trigger, not two.** The "Pattern A vs Pattern B" framing in pre-Sprint-1 design notes is informational only — at runtime there is one BEFORE INSERT trigger function per brand-scoped table, all sharing the same fallback logic.

Strict RLS + NOT NULL `brand_id` on all 13 brand-scoped tables (post-backfill). RLS predicate everywhere is `is_admin() OR brand_id = ANY(current_user_brand_access())`. Pattern C system tables (`events`, `audit_log`, `dead_jobs`, `integration_call_log`) keep `brand_id` nullable for cross-brand writes; their RLS allows brand-scoped reads only when `brand_id` matches.

## SEO OS — Worker tier (Sprint 2)

- **Packages**: `@workspace/worker` (Railway target), `@workspace/jobs` (BullMQ + typed `enqueue<JobName>`), `@workspace/integrations-dataforseo`, `@workspace/integrations-originality-ai`. New tables: `dead_jobs`, `integration_call_log` (migration 0004).
- **Queues**: five named BullMQ queues — `maintenance`, `integrations`, `projects`, `content`, `scoring` — over a single ioredis connection. Defaults `{ attempts:3, backoff: exponential 30s, removeOnComplete:1000, removeOnFail:1000 }`. Idempotency is enforced via `jobId = "<jobName>:<idempotencyKey>"` and a duplicate-row short-circuit in the handler.
- **Tenancy in the worker**: the worker uses the Supabase service role and bypasses RLS, so brand isolation is enforced in code via `withBrandScope(brandId, fn)` (`lib/db/src/brand-scope.ts`). `withBrandScope` opens a transaction, sets `app.current_brand` and `row_security = off` LOCAL, and returns a typed `scope.db`. Every insert into a brand-scoped table must call `assertBrandScope(scope.brandId, row)` first.
- **API surface**: admin-only routes under `POST /api/admin/system/{heartbeat,test-dataforseo,test-originality}` and `GET /api/admin/system/{queues,events,heartbeat-freshness,dead-jobs}`. JWT verification via `SUPABASE_JWT_SECRET` (`artifacts/api-server/src/middlewares/auth.ts`). Frontend `/admin/system` page (admin-only nav link) shows live cards.
- **Required env (worker only, never frontend)**: `DATABASE_URL`, `REDIS_URL`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `ORIGINALITY_AI_KEY`, `OPENAI_API_KEY`, `SENTRY_DSN`, `SUPABASE_SERVICE_ROLE_KEY`. Worker fails fast at boot via zod env validation if any are missing.
- **Deploy**: `seo-os-worker` on Railway, 2 replicas, Nixpacks. Build `pnpm install --frozen-lockfile && pnpm --filter @workspace/worker run build`. Start `node lib/worker/dist/index.mjs`. Healthcheck `GET /health` port 3001. Smoke-test procedure in `docs/sprint-2-deploy.md`.

## SEO OS — Quality Gate (Sprint 3, part 1)

- **New tables (migration 0005)**: `content_objects` (the unit of review — one per draft handed to the gate), `qa_runs` (one row per automated-checks pass), `qa_check_results` (per-check observation/threshold/passed), `qa_signoffs` (reviewer decisions, append-only audit), `qa_overrides` (admin escape hatch — Sprint 4 wires UI), `qa_check_definitions` (per-brand thresholds, seeded). All brand-scoped via the standard `tenant_brand_inherit()` trigger + RLS.
- **State machine** (`lib/services/quality-gate`): `drafting → submitted → in_review → {approved | rejected}`. Reviewer cannot decide while a `qa_run` is in-flight or any `hard_fail` check has `passed=false` (overrides bypass — admin only). `submitForReview()` is idempotent on `(content_object_id, qa_runs.idempotency_key)` so an enthusiastic double-click never enqueues two runs.
- **Automated checks** (worker handler `content.qa-run-checks`): four runners — `originality-ai` (hard_fail; thresholds per brand: TekRevol/Reverto 20%, ClaimShield/CensusFlow 15%), `brand-voice` (warn — voice-profile diff vs `brands.voice_profile`), `reading-level` (warn — Flesch grade band per brand), `brief-compliance` (warn — heading/word-count parity vs `outlines`). Each runner writes one `qa_check_results` row and the handler stamps `qa_runs.summary`/`finished_at`.
- **API surface** (`/api/quality-gate/*`, JWT-gated, brand-access-checked): `POST /submit`, `POST /decide`, `GET /queue?brandId=`, `GET /review/:id?brandId=`, `POST /start-from-draft`. OpenAPI entries in `lib/api-spec/openapi.yaml` under tag `quality-gate` — regenerate orval hooks with `pnpm --filter @workspace/api-spec run codegen` if a frontend wants typed clients.
- **SEO OS artifact** (`artifacts/seo-os`, slug `seo-os`, previewPath `/seo-os/`) — separate React + Vite app under the same Supabase project as ContentForge. Auth shares the session via the same Supabase storage key (`sb-tekrevol-auth-token`), so a writer signed into ContentForge is signed into SEO OS automatically. Two pages today: `/quality-gate` (queue) and `/quality-gate/:id` (review surface). Both subscribe to Supabase Realtime channels filtered by `brand_id` so cross-brand churn does not retrigger refetches.
  - Auth-lock pattern preserved (sync handler in `onAuthStateChange`, DB lookups deferred via `setTimeout(_, 0)` so the NavigatorLock does not deadlock).
  - Wouter base path matches `BASE_URL` so `<Link to="/quality-gate">` renders as `/seo-os/quality-gate` in dev and prod.
- **ContentForge → SEO OS handoff**: `DraftReview.tsx` exposes a "Submit for review" button next to "Send back to draft". It calls `start-from-draft` then `submit`, emits `qualitygate.submitted`, and opens `/seo-os/quality-gate/:id` in a new tab so the writer can watch automated checks land in real time.

## SEO OS — Recovery War Room (Sprint 4)

- **Service**: `@workspace/services-recovery` (`lib/services/recovery`) — actions (`lockBaseline`, `createInitiative`, `updateInitiative`, `completeInitiative`), queries, and `computeProjection`. `lockBaseline` writes `recovery_baselines` + `audit_log` + `events` in one transaction; idempotent via brand-unique constraint and a 23505 catch. GSC/GA4 fields write NULL until ingestion ships (per `.local/recovery-pack-amendments.md` §D.2).
- **Migration 0009**: `recovery_baselines` (UNIQUE per brand, FK to `user_profiles.user_id`), `recovery_initiatives`, `recovery_snapshots` (UNIQUE `(brand_id, snapshot_date)` + `gap_to_baseline_top10_pct` rankings-based headline metric).
- **Nightly snapshot job (Prompt 4)**: `scoring.recovery-snapshot` handler at `lib/worker/src/jobs/scoring/recovery-snapshot.ts`. Computes the trailing-30d `avg_position_30d` / `keywords_in_top_10` / `keywords_in_top_3` from `rank_snapshots` (reuses `computeRankingsBaseline`), then writes `gap_to_baseline_position` (current − baseline) and `gap_to_baseline_top10_pct` (% delta vs baseline top-10 count). GSC/GA4/clicks_pct stay NULL. Idempotent on `(brand_id, snapshot_date)` — re-runs short-circuit. Inserts a `recovery.snapshot_computed` event. Nightly fan-out (`scoring.recovery-snapshot-nightly`) registered as a BullMQ repeatable job at `0 3 * * *` UTC during worker boot via `addRepeatable` (new helper in `lib/jobs/src/queues.ts`); enqueues one snapshot job per brand-with-locked-baseline for yesterday's date.
- **Backfill script**: `pnpm --filter @workspace/worker exec tsx src/scripts/backfill-recovery-snapshots.ts` — for each brand × each date from `baseline_date` through yesterday (UTC), enqueues a `scoring.recovery-snapshot` job with `recovery-snapshot:<brandId>:<YYYY-MM-DD>` as `idempotencyKey`. Producer-side concurrency cap of 50; worker drains the `scoring` queue at concurrency 8. Optional flags: `--dry-run`, `--through=YYYY-MM-DD`. Re-running is a no-op (BullMQ jobId dedup + per-row unique index).
- **Baseline seeding (Prompt 3)**: `pnpm --filter @workspace/services-recovery run lock-baselines` — defaults to dry-run (writes `docs/recovery-baseline-dry-run.md`), `--confirm` flips on the live insert (writes `docs/recovery-baselines.md`). Resolves TekRevol/Reverto/ClaimShield/CensusFlow by case-insensitive name OR slug, falls back to earliest snapshot for ClaimShield/CensusFlow when 2025-09-30 has no data, idempotent on re-run. Optional flags `--locked-by=<uuid>` and `--baseline-date=YYYY-MM-DD`. The script must be run against the migrated Supabase preview by an operator (Abeer); local DB is empty.
- **Recovery overview UI (Prompt 5)**: `/recovery` route in `artifacts/seo-os` (`src/pages/Recovery.tsx`). Sticky header includes an in-page `HeaderBrandSelector` mirroring the AppShell sidebar `BrandSwitcher` via the shared `useActiveBrand()` context (so changes stay in sync). Headline card uses `avg_position_30d` formatted exactly as `"11.1 (was 8.4, gap +2.7)"`, with the gauge driven by position delta (current − baseline): green ≤0, yellow ≤3, red >3 (per Amendments §D.5). Sub-metrics show Top-10 and Top-3 keyword-count deltas vs baseline. Clicks line is the literal `"— (pending GSC ingestion)"` placeholder. 90-day trend chart (Recharts `LineChart`) sign-splits `gap_to_baseline_top10_pct` into a red `gapNeg` series (below baseline) and green `gapPos` series (at or above), with a zero `ReferenceLine`, dashed projection line, and initiative `started_at` markers. Initiative ribbon is a horizontal-scroll, active-only read-only list (completed/paused initiatives still surface as chart markers). Empty states use exact §D.5 copy: "Baseline not yet locked for this brand" with an admin-only "Lock baseline" CTA → `/admin/recovery-baseline`, and "Snapshots not yet computed. Check back tomorrow." Snapshots query uses 1h `staleTime`; overview/initiatives 60s.
- **Recovery API routes**: `GET /api/recovery/{overview,snapshots,initiatives}/:brandId` mounted in `artifacts/api-server/src/routes/recovery.ts`, gated by `requireAuth` + `callerHasBrandAccess`. brandId validated as UUID (400 on malformed); `?days=` parsed as a strict integer 1..730 (400 on fractional/out-of-range). Each route delegates to a query in `@workspace/services-recovery` (new `getSnapshots(brandId, { days })` alongside `getRecoveryOverview` / `getInitiatives`). OpenAPI schemas: `RecoveryBaseline`, `RecoverySnapshot`, `RecoveryInitiative`, `RecoveryProjection`, `RecoveryOverviewBody`, `RecoverySnapshotList`, `RecoveryInitiativeList` under tag `recovery`; getRecoverySnapshots declares both the `brandId` path param and the optional `days` query param. To avoid an orval TS2308 collision (path-`Params` zod const named identically to the merged-params TS type when an op has both path and query), `@workspace/api-zod` package exports map `.` → `./src/generated/api.ts` (zod schemas) and `./types` → `./src/generated/types/index.ts` (TS types); the orval-regenerated `src/index.ts` is excluded from the lib's tsconfig. Re-run `pnpm --filter @workspace/api-spec run codegen` after spec edits.

## Artifacts

- **insight-forge** (`artifacts/insight-forge`, slug `insight-forge`, previewPath `/`) — ContentForge: research-led drafting tool. React 18 + Vite, Tailwind v3, Supabase auth + edge functions, Lovable cloud auth wrapper. Pinned to React 18 (catalog is React 19; react-day-picker@8 needs 18). **Sprint 1 (multi-brand foundation)** — now four brand tenants (TekRevol, ClaimShield, Reverto, CensusFlow). New tables: `brands`, `user_profiles` (role/pod/brand_access), `events`, `audit_log`. `brand_id` added to every brand-scoped table with RLS policies (`is_admin() OR brand_id = ANY(current_user_brand_access())`). Auth gate is no longer domain-pinned — any user with brand_access (or admin) is allowed in. SQL lives in `artifacts/insight-forge/supabase/migrations/` (0001 schema + backfill, 0002 RLS, 0003 pen-check). Apply on a Supabase preview branch first; re-export `src/integrations/supabase/types.ts` from the dashboard after applying. See `artifacts/insight-forge/docs/sprint-1-foundation.md`.
  - Brand context: `src/lib/brands.tsx` (`BrandProvider`, `useActiveBrand()`); switcher renders in AppShell sidebar (dropdown for multi-brand users, static label otherwise). Active brand persists in `localStorage["contentforge.activeBrandSlug"]`.
  - Logging helpers: `src/lib/events.ts → emit(...)` for fire-and-forget event log; `src/lib/audit.ts → recordAudit(...)` for admin-sensitive actions (DB enforces non-empty justification).
  - Admin pages: `/admin/brands` (voice profile + thresholds + domain editor), `/admin/users` retrofitted with role/pod/brand-access editors. Both write to `audit_log` with prompted justification.
  - Stages: Brief → Research → Outline → Draft → Review.
  - **Drafting interface writer-experience features** (`src/pages/DraftingInterface.tsx`):
    - `WritingMetrics` panel (`src/components/WritingMetrics.tsx`) — live readability stats (Flesch grade, passive voice %, sentence length, jargon, reading time) computed client-side from `src/lib/writingMetrics.ts`. Recomputes on every keystroke.
    - `SelectionToolbar` (`src/components/SelectionToolbar.tsx`) — popover toolbar over selected text in the inline editor. Actions (Tighten / Expand / Active voice / Add example / Counter-argument) route through the existing `draft-section` Supabase edge function via `generate(sectionId, instruction)` with sentinel-wrapped passages (`<PASSAGE>…</PASSAGE>`).
    - Focus mode — hides the right rail and widens the prose column. Persisted in `localStorage["contentforge.focusMode"]`.
  - AI runs in Supabase edge functions (project `kftooefsbronkzkiqpag`); not editable from this repo.
  - Production build requires only Supabase env vars; `vite.config.ts` makes `PORT`/`BASE_PATH` dev-only.
