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
