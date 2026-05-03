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
