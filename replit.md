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

- **insight-forge** (`artifacts/insight-forge`, slug `insight-forge`, previewPath `/`) — ContentForge: research-led drafting tool for tekrevol.com team. React 18 + Vite, Tailwind v3, Supabase auth + edge functions, Lovable cloud auth wrapper. Pinned to React 18 (catalog is React 19; react-day-picker@8 needs 18). Auth gates behind @tekrevol.com Google accounts.
  - Stages: Brief → Research → Outline → Draft → Review.
  - **Drafting interface writer-experience features** (`src/pages/DraftingInterface.tsx`):
    - `WritingMetrics` panel (`src/components/WritingMetrics.tsx`) — live readability stats (Flesch grade, passive voice %, sentence length, jargon, reading time) computed client-side from `src/lib/writingMetrics.ts`. Recomputes on every keystroke.
    - `SelectionToolbar` (`src/components/SelectionToolbar.tsx`) — popover toolbar over selected text in the inline editor. Actions (Tighten / Expand / Active voice / Add example / Counter-argument) route through the existing `draft-section` Supabase edge function via `generate(sectionId, instruction)` with sentinel-wrapped passages (`<PASSAGE>…</PASSAGE>`).
    - Focus mode — hides the right rail and widens the prose column. Persisted in `localStorage["contentforge.focusMode"]`.
  - AI runs in Supabase edge functions (project `kftooefsbronkzkiqpag`); not editable from this repo.
  - Production build requires only Supabase env vars; `vite.config.ts` makes `PORT`/`BASE_PATH` dev-only.
