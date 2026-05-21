# Sprint 7 QA Report — May 21, 2026

## Scope

Full platform schema audit + route serialization audit for ContentForge, SEO OS Quality Gate, and Recovery War Room. Conducted as part of Task #20.

---

## Schema Audit Results

### Group A — `brand_id NOT NULL` in prod, nullable in Drizzle

All 5 tables audited. Insert paths verified by reading the route/worker code.

| Table | Inserting route/worker | `brand_id` passed? | Resolution |
|---|---|---|---|
| `drafts` | `POST /api/ai/draft-section` (`routes/ai/index.ts` line 567) | ✅ `brandId: project.brandId` | Added `.notNull()` to Drizzle schema |
| `draft_scores` | `POST /api/ai/final-stitch` (`routes/ai/index.ts` line 781) | ✅ `brandId: project.brandId` (+ null guard added) | Added `.notNull()` to Drizzle schema |
| `outlines` | `POST /api/ai/outline-generate` | ✅ `brandId: project.brandId` | Added `.notNull()` to Drizzle schema |
| `interview_answers` | `POST /api/projects/:id/interview-answers` (`routes/projects.ts`) | ✅ (was `?? null` fallback; added 404 guard) | Added `.notNull()` + route guard |
| `proof_points` | `lib/content-ai/src/research-stages.ts` `angle_and_conversion` stage | ❌ **was missing** — `brandId` absent from `ppRows` | Added `brandId: project.brand_id`; added `.notNull()` |

**Critical fix:** `proof_points` inserts via the research worker omitted `brand_id` entirely. Every production research job reaching the `angle_and_conversion` stage would have thrown a NOT NULL constraint error. Fixed.

### Group B — Column type / presence mismatches

| Table | Column | Finding | Resolution |
|---|---|---|---|
| `fetched_pages` | `created_at` | In Drizzle but **absent from prod DB** | Removed from schema |
| `fetched_pages` | `brand_id` | In prod but **missing from Drizzle** | Added as nullable `uuid` |
| `content_objects` | `submitted_by` | `uuid` in Drizzle, `text` in prod (Clerk IDs aren't valid UUIDs) | Changed to `text` |
| `content_objects` | `decided_by` | Same | Changed to `text` |
| `projects` | `mode` | Nullable in Drizzle; `NOT NULL DEFAULT 'research'` in prod | Added `.notNull().default("research")` |

### Additional fix — project creation mode

`POST /api/projects` hard-coded `mode: "composition"` while the schema default, the production DB column default, and the product architecture (research-led pipeline) all use `"research"`. The route was changed to `mode: "research"`.

---

## Route Serialization Audit

### Routes in OpenAPI spec (Orval-generated hooks — camelCase safe)

- `GET/POST /api/quality-gate/*` ✅
- `GET/POST/PUT /api/recovery/*` ✅
- `GET/POST /api/admin/system/*` ✅
- `GET /api/healthz` ✅

### Routes NOT in OpenAPI spec

| Route | Before | After | Status |
|---|---|---|---|
| `GET /api/projects` + sub-routes | `projectToSnake()` helper | No change | ✅ Already correct |
| `GET /api/brands` | Explicit snake_case map | No change | ✅ Already correct |
| `GET /api/me` | Returns `brands` as raw Drizzle rows | No change — frontend accesses camelCase fields on brands directly from context hook | ✅ No consumer mismatch found |
| `GET /api/admin/users` | Explicit snake_case map | No change | ✅ Already correct |
| `GET /api/admin/playbook` | Explicit snake_case map | No change | ✅ Already correct |
| `GET /api/admin/activity` | Explicit snake_case map | No change | ✅ Already correct |
| `GET /api/admin/usage` | Explicit snake_case map | No change | ✅ Already correct |
| `GET /api/admin/dashboard` | **Spread raw Drizzle rows** | **Fixed** — `voiceMapped` defined before early-return; both empty and non-empty paths return consistent snake_case | ✅ Fixed |
| `POST /api/voice-library` | Returns `{ ok: true }` | No change | ✅ Correct |
| All `/api/ai/*` routes | Return structured AI output (not raw rows) | No change | ✅ Correct |

---

## Live Automated Smoke Tests — May 21, 2026

All tests run against the local dev server via `localhost:80` (shared proxy).

> **Note on E2E scope:** The production URL (`tr-marketing-os.replit.app`) requires an active Clerk browser session. The agent execution environment cannot obtain a browser Clerk token or carry cookies across HTTP clients. The tests below are the maximum automated coverage achievable without a human-operated browser session. Flows requiring AI API keys and authenticated sessions are listed separately with code-audit verdicts.

### Auth enforcement (unauthenticated → 401) — 16/16 pass

| Endpoint | Expected | Result |
|---|---|---|
| `GET /api/healthz` | 200 | ✅ `{"status":"ok"}` |
| `GET /api/me` | 401 | ✅ `{"error":"unauthenticated"}` |
| `GET /api/brands` | 401 | ✅ 401 |
| `GET /api/projects` | 401 | ✅ 401 |
| `GET /api/admin/dashboard` | 401 | ✅ 401 |
| `GET /api/admin/users` | 401 | ✅ 401 |
| `GET /api/quality-gate/queue` | 401 | ✅ 401 |
| `GET /api/recovery/overview/:id` | 401 | ✅ 401 |
| `GET /api/admin/system/queues` | 401 | ✅ 401 |
| `POST /api/ai/playbook-upload` | 401 | ✅ 401 |
| `POST /api/quality-gate/submit` | 401 | ✅ 401 |
| `POST /api/quality-gate/decide` | 401 | ✅ 401 |
| `GET /api/recovery/initiatives/:id` | 401 | ✅ 401 |
| `POST /api/ai/draft-section` | 401 | ✅ 401 |
| `POST /api/ai/final-stitch` | 401 | ✅ 401 |
| `POST /api/ai/research-generate` | 401 | ✅ 401 |

### TypeScript compilation

| Check | Result |
|---|---|
| `pnpm run typecheck` (all 5 packages) | ✅ 0 errors |

### API server boot

| Check | Result |
|---|---|
| Boot migrations ran | ✅ `boot-migration: playbook.brand_id is now nullable` |
| Server listening | ✅ `port: 8080` |
| No ERROR logs at boot | ✅ Clean |

---

## Code-Audit Verification (requires live Clerk session to run E2E)

The following flows were verified by reading the insert/query paths and confirming correctness. A live E2E run requires an authenticated Clerk session + active AI API keys and must be performed manually by the platform operator before the next production deploy.

| Flow | Code audit verdict | Manual E2E required |
|---|---|---|
| New project creation (`POST /api/projects`) | ✅ `mode = "research"` (fixed), `brand_id` passed, `status = "proposing_brief"` | Yes |
| Draft section (`brand_id` constraint) | ✅ `brandId: project.brandId` present in insert | Yes |
| Final stitch (`brand_id` + null guard) | ✅ `brandId: project.brandId` after `!project` guard | Yes |
| Research job — proof points insert | ✅ `brandId: project.brand_id` now included (was missing) | Yes |
| Interview answers save | ✅ 404 guard prevents null `brand_id` insert | Yes |
| Quality gate submit/decide | ✅ `submitted_by`/`decided_by` now `text` — Clerk IDs accepted | Yes |
| Admin dashboard render | ✅ All fields now explicitly snake_case; both code paths (empty + non-empty) consistent | Yes |
| Recovery overview / snapshots / initiatives | ✅ Explicit mapping; UUID guard; no serialization issues | Yes |

---

## Outstanding Items

| Task | Description |
|---|---|
| #21 | Add schema insert-path smoke tests to CI to catch future NOT NULL drift before it hits production |
| ~~#22~~ | ~~Admin dashboard camelCase spread~~ — resolved inline in this task |

---

## Files Changed

### Schema files (`lib/db/src/schema/`)
- `drafts.ts` — `brandId` → `.notNull()`
- `draft-scores.ts` — `brandId` → `.notNull()`
- `outlines.ts` — `brandId` → `.notNull()`
- `interview-answers.ts` — `brandId` → `.notNull()`
- `proof-points.ts` — `brandId` → `.notNull()`
- `content-objects.ts` — `submittedBy/decidedBy`: `uuid` → `text`
- `fetched-pages.ts` — removed `createdAt`; added nullable `brandId`
- `projects.ts` — `mode` → `.notNull().default("research")`

### Route / worker files
- `lib/content-ai/src/research-stages.ts` — added `brandId: project.brand_id` to proof_points insert
- `artifacts/api-server/src/routes/projects.ts` — `mode: "composition"` → `mode: "research"`; 404 guard for null brandId; `mode` update cast fix
- `artifacts/api-server/src/routes/ai/index.ts` — null guard for project in final-stitch; `project?.brandId` → `project.brandId`
- `artifacts/api-server/src/routes/admin.ts` — `/dashboard` voiceMapped moved before early-return; both paths return consistent snake_case

### Documentation
- `docs/pre-deploy-checklist.md` — permanent 6-step pre-deploy checklist
- `docs/qa-sprint-7-may-2026.md` — this report
