# TekRevol Content Platform

A unified platform with a single login hub at `/` that routes users into two modules: **ContentForge** (research-led content drafting) and **SEO OS** (quality gate & recovery). Both share the same Supabase auth session.

## Run & Operate

- **Run API server locally**: `pnpm --filter @workspace/api-server run dev`
- **Typecheck all packages**: `pnpm run typecheck`
- **Build all packages**: `pnpm run build`
- **Regenerate API hooks & Zod schemas**: `pnpm --filter @workspace/api-spec run codegen`
- **Push DB schema changes (dev only)**: `pnpm --filter @workspace/db run push`

**Required Environment Variables:**
- `DATABASE_URL`: PostgreSQL connection string.
- `REDIS_URL`: Redis connection string for BullMQ.
- `SUPABASE_JWT_SECRET`: Supabase JWT secret for API server auth.
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key (for worker).
- `SUPABASE_URL`: Supabase project URL.
- `ANTHROPIC_API_KEY`: API key for Anthropic AI.
- `WINSTON_API_KEY`: (Optional) API key for GoWinston AI detection.
- `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`: Credentials for DataforSEO integration.
- `ORIGINALITY_AI_KEY`: API key for Originality.AI.
- `OPENAI_API_KEY`: API key for OpenAI.
- `SENTRY_DSN`: Sentry DSN for error tracking.

## Stack

- **Monorepo**: pnpm workspaces
- **Node.js**: 24
- **Package Manager**: pnpm
- **TypeScript**: 5.9
- **API Framework**: Express 5
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API Codegen**: Orval (from OpenAPI spec)
- **Build Tool**: esbuild (CJS bundle)
- **Frontend**: React 18 + Vite, Tailwind v3
- **Job Queue**: BullMQ

## Where things live

- **Database Migrations**: `artifacts/insight-forge/supabase/migrations/` (apply `0000` first, then 0001-0009 in order)
- **OpenAPI Specification**: `lib/api-spec/openapi.yaml`
- **API Server Routes**: `artifacts/api-server/src/routes/`
- **Worker Jobs & Handlers**: `@workspace/jobs`, `@workspace/worker`
- **Shared AI Library**: `@workspace/content-ai` (`lib/content-ai/`)
- **DB Schema**: See Drizzle ORM schema files within `@workspace/db`.
- **Frontend Source (ContentForge)**: `artifacts/insight-forge/src/`
- **Frontend Source (SEO OS)**: `artifacts/seo-os/src/`
- **Recovery Documentation**: `docs/architecture.md` (Recovery War Room), `docs/recovery-runbook.md`

## Architecture decisions

- **Tenant Isolation**: Strict Row-Level Security (RLS) with `brand_id` on all brand-scoped tables, complemented by a `tenant_brand_inherit()` trigger for automatic `brand_id` resolution on insert. Workers bypass RLS using the service role and enforce brand isolation programmatically via `withBrandScope()`.
- **AI Feature Migration**: Supabase Edge Functions for AI were migrated to Express routes (`POST /api/ai/*`) in the API server, with asynchronous background processing handled by BullMQ jobs. This centralizes AI logic within the application's backend.
- **Embedded Worker (Production)**: In production the BullMQ workers run inside the API server process (`NODE_ENV=production` gates the `startEmbeddedWorkers()` call in `src/index.ts`). This satisfies Replit autoscale's single-port constraint — no second process, no second port. In development the standalone `lib/worker: BullMQ Worker` workflow runs separately. `@workspace/worker` exports `./embedded` with types resolved from `dist/embedded.d.ts` (emitted by `tsc --build --force` after esbuild in `build.mjs`).
- **Idempotent Operations**: Key operations (e.g., submitting for review, recovery snapshot jobs) are designed to be idempotent using unique `jobId`s or database unique constraints to prevent duplicate processing.
- **Realtime Updates**: SEO OS frontend uses Supabase Realtime channels, filtered by `brand_id`, to provide live updates for queues and review surfaces without constant refetching.
- **Monorepo Structure**: A pnpm monorepo is used to manage shared libraries, API server, worker, and multiple frontend applications, promoting code reuse and consistent tooling.

## Product

- **Unified Hub**: Single login at `/` — after auth, users see ContentForge and SEO OS as selectable module cards. Both apps share the same Supabase session (no second login needed).
- **Multi-brand Tenancy**: Supports multiple client brands with isolated data and configurations.
- **AI-Powered Content Generation**: Brief proposals, research generation, outline generation, section drafting, and final stitching via Anthropic AI.
- **Quality Gate Workflow**: Automated checks (Originality.AI, brand voice, reading level, brief compliance) with a state machine (`drafting → submitted → in_review → {approved | rejected}`).
- **SEO Recovery War Room**: Baseline locking, nightly snapshots, projection calculations, initiative tracking, and PDF export (`GET /api/recovery/export/:brandId.pdf`).
- **Rich Drafting Interface**: Live writing metrics, selection-based AI actions, focus mode.
- **Admin Tools**: Brand management, user roles, brand-access grants, audit logging.

## User preferences

- Users log in once at `/` and select which module to enter — do not split auth across apps.

## Gotchas

- **DB Migration Order**: Always apply `0000` (bootstrap) first on a fresh Supabase project, then `0001` through `0009` sequentially.
- **OpenAPI Codegen**: After modifying `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen` to regenerate API client hooks and Zod schemas.
- **Worker Environment Variables**: Worker requires specific environment variables (`DATABASE_URL`, `REDIS_URL`, `DATAFORSEO_LOGIN`, etc.) which are validated at boot. Ensure these are set for deployment.
- **Worker Build Order**: Always build worker before api-server (`pnpm --filter @workspace/worker run build && pnpm --filter @workspace/api-server run build`). The worker build emits `dist/embedded.d.ts` via `tsc --build --force`; the api-server bundles from `dist/embedded.mjs` at build time.
- **Prompt Caching**: For consistent AI model behavior, ensure system blocks used in `buildRoutedSystem` / `buildRoutedSystemWithProject` remain byte-identical between calls.
- **Recovery Baseline Seeding**: The `lock-baselines` script requires `--confirm` to perform live inserts and should be run against the migrated Supabase preview by an operator.
- **PDF Export Dependencies**: `artifacts/api-server`'s `tsconfig.json` needs `"jsx": "react-jsx"` for `@react-pdf/renderer` components.

## Pointers

- **pnpm-workspace skill**: For monorepo structure, TypeScript setup, and package details.
- **Drizzle ORM documentation**: For database schema and query building.
- **BullMQ documentation**: For job queue management.
- **Supabase documentation**: For authentication, RLS, and Realtime features.
- **Anthropic AI documentation**: For Claude API usage and prompt engineering.
- **Orval documentation**: For API client generation from OpenAPI.