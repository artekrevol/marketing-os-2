# TekRevol Content Platform

A unified platform with a single login hub at `/` that routes users into two modules: **ContentForge** (research-led content drafting) and **SEO OS** (quality gate & recovery). Both share the same Clerk auth session.

## Run & Operate

- **Run API server locally**: `pnpm --filter @workspace/api-server run dev`
- **Typecheck all packages**: `pnpm run typecheck`
- **Build all packages**: `pnpm run build`
- **Regenerate API hooks & Zod schemas**: `pnpm --filter @workspace/api-spec run codegen`
- **Push DB schema changes (dev only)**: `pnpm --filter @workspace/db run push`

**Required Environment Variables:**
- `DATABASE_URL`: Replit PostgreSQL connection string.
- `REDIS_URL`: Redis connection string for BullMQ.
- `CLERK_SECRET_KEY`: Clerk secret key for API server auth middleware.
- `CLERK_PUBLISHABLE_KEY`: Clerk publishable key (set in frontend `.env`).
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
- **Auth**: Clerk (cookie-based session shared across all frontends)
- **Database**: Replit PostgreSQL (provisioned via Replit DB)
- **ORM**: Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API Codegen**: Orval (from OpenAPI spec)
- **Build Tool**: esbuild (CJS bundle)
- **Frontend**: React 18 + Vite, Tailwind v3
- **Job Queue**: BullMQ

## Where things live

- **DB Schema**: See Drizzle ORM schema files within `@workspace/db` (`lib/db/src/schema/`)
- **DB Migrations**: `lib/db/drizzle/` — managed by Drizzle Kit (`pnpm --filter @workspace/db run push`)
- **OpenAPI Specification**: `lib/api-spec/openapi.yaml`
- **API Server Routes**: `artifacts/api-server/src/routes/`
- **API Auth Middleware**: `artifacts/api-server/src/middlewares/auth.ts` (Clerk `getAuth()` cookie-based)
- **Worker Jobs & Handlers**: `@workspace/jobs`, `@workspace/worker`
- **Shared AI Library**: `@workspace/content-ai` (`lib/content-ai/`)
- **Frontend Source (ContentForge)**: `artifacts/insight-forge/src/`
- **Frontend Source (SEO OS)**: `artifacts/seo-os/src/`
- **Recovery Documentation**: `docs/architecture.md` (Recovery War Room), `docs/recovery-runbook.md`

## Architecture decisions

- **Auth**: Clerk handles all authentication. The API server validates Clerk session cookies via `@clerk/express` `getAuth()`. Frontends use `@clerk/react`. JIT user provisioning occurs on first authenticated API request (`user_profiles` row created from Clerk `userId`).
- **Tenant Isolation**: All brand-scoped tables carry `brand_id`. Workers enforce brand isolation programmatically via `withBrandScope()`. No Supabase RLS — isolation is enforced at the application layer.
- **AI Feature Architecture**: All AI routes live in Express (`POST /api/ai/*`) with asynchronous background processing via BullMQ jobs.
- **Embedded Worker (Production)**: In production the BullMQ workers run inside the API server process (`NODE_ENV=production` gates the `startEmbeddedWorkers()` call in `src/index.ts`). This satisfies Replit autoscale's single-port constraint. In development the standalone `lib/worker: BullMQ Worker` workflow runs separately.
- **Idempotent Operations**: Key operations use unique `jobId`s or database unique constraints to prevent duplicate processing.
- **Monorepo Structure**: A pnpm monorepo manages shared libraries, API server, worker, and multiple frontend applications.

## Product

- **Unified Hub**: Single login at `/` — after auth, users see ContentForge and SEO OS as selectable module cards. Both apps share the same Clerk session (no second login needed).
- **Multi-brand Tenancy**: Supports multiple client brands with isolated data and configurations.
- **AI-Powered Content Generation**: Brief proposals, research generation, outline generation, section drafting, and final stitching via Anthropic AI.
- **Quality Gate Workflow**: Automated checks (Originality.AI, brand voice, reading level, brief compliance) with a state machine (`drafting → submitted → in_review → {approved | rejected}`).
- **SEO Recovery War Room**: Baseline locking, nightly snapshots, projection calculations, initiative tracking, and PDF export (`GET /api/recovery/export/:brandId.pdf`).
- **Rich Drafting Interface**: Live writing metrics, selection-based AI actions, focus mode.
- **Admin Tools**: Brand management, user roles, brand-access grants, audit logging.

## User preferences

- Users log in once at `/` and select which module to enter — do not split auth across apps.

## Gotchas

- **OpenAPI Codegen**: After modifying `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen` to regenerate API client hooks and Zod schemas.
- **Worker Environment Variables**: Worker requires specific environment variables (`DATABASE_URL`, `REDIS_URL`, `DATAFORSEO_LOGIN`, etc.) which are validated at boot. Ensure these are set for deployment.
- **Worker Build Order**: Always build worker before api-server (`pnpm --filter @workspace/worker run build && pnpm --filter @workspace/api-server run build`). The worker build emits `dist/embedded.d.ts` via `tsc --build --force`; the api-server bundles from `dist/embedded.mjs` at build time.
- **Prompt Caching**: For consistent AI model behavior, ensure system blocks used in `buildRoutedSystem` / `buildRoutedSystemWithProject` remain byte-identical between calls.
- **PDF Export Dependencies**: `artifacts/api-server`'s `tsconfig.json` needs `"jsx": "react-jsx"` for `@react-pdf/renderer` components.
- **Clerk Cookie Auth**: All API calls from frontends must use `credentials: "include"` — the Clerk session is cookie-based, not Bearer token.
- **Admin Check**: `requireAdmin` middleware checks `user_profiles.role === 'admin'`. Seed at least one admin user in `user_profiles` after first login.

## Pointers

- **pnpm-workspace skill**: For monorepo structure, TypeScript setup, and package details.
- **Drizzle ORM documentation**: For database schema and query building.
- **BullMQ documentation**: For job queue management.
- **Clerk documentation**: For authentication, session management, and middleware.
- **Anthropic AI documentation**: For Claude API usage and prompt engineering.
- **Orval documentation**: For API client generation from OpenAPI.
