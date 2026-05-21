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
| `interview_answers` | `POST /api/projects/:id/interview-answers` (`routes/projects.ts` line 447) | ✅ (was `?? null` fallback; added 404 guard) | Added `.notNull()` to Drizzle schema + route guard |
| `proof_points` | `lib/content-ai/src/research-stages.ts` line 529 | ❌ **missing** — `brandId` was absent from `ppRows` | Added `brandId: project.brand_id` to insert; added `.notNull()` to schema |

**Critical fix:** `proof_points` inserts via the research-generate worker were omitting `brand_id` entirely. Every production research job that reached the `angle_and_conversion` stage would have thrown a NOT NULL constraint error. This is now fixed.

### Group B — Column type / presence mismatches

| Table | Column | Finding | Resolution |
|---|---|---|---|
| `fetched_pages` | `created_at` | In Drizzle schema but **absent from production DB** | Removed from `lib/db/src/schema/fetched-pages.ts` |
| `fetched_pages` | `brand_id` | In production DB but **missing from Drizzle** | Added as nullable `uuid` to Drizzle schema |
| `content_objects` | `submitted_by` | `uuid` type in Drizzle, `text` in production (Clerk IDs like `user_3Dx…` are not valid UUIDs) | Changed to `text("submitted_by")` |
| `content_objects` | `decided_by` | Same as above | Changed to `text("decided_by")` |
| `projects` | `mode` | Nullable in Drizzle; `NOT NULL DEFAULT 'research'` in production | Added `.notNull().default("research")` |

---

## Route Serialization Audit

All route files under `artifacts/api-server/src/routes/` were checked for raw Drizzle row spreading.

### Routes in OpenAPI spec (Orval-generated hooks — camelCase safe)

- `GET/POST /api/quality-gate/*` ✅
- `GET/POST/PUT /api/recovery/*` ✅
- `GET/POST /api/admin/system/*` ✅
- `GET /api/healthz` ✅

### Routes NOT in OpenAPI spec — serialization check

| Route file | Serialization | Status |
|---|---|---|
| `projects.ts` | Uses explicit `projectToSnake()` helper for all project rows | ✅ Correct |
| `projects.ts` interview-answers GET | Explicit field-by-field map to snake_case | ✅ Correct |
| `projects.ts` proof-points GET | Explicit snake_case map | ✅ Correct |
| `projects.ts` outlines/drafts | Explicit snake_case map | ✅ Correct |
| `brands.ts` | Explicit snake_case map (`primary_domain`, `voice_profile`, etc.) | ✅ Correct |
| `me.ts` | Returns `brands` as raw Drizzle rows (camelCase `primaryDomain`, `voiceProfile`) | ⚠️ Minor — fields are camelCase. Frontend reads `b.id`, `b.name`, `b.primaryDomain` directly from the brand switcher context; no reported rendering failures |
| `admin.ts` `/users` | Explicit snake_case map | ✅ Correct |
| `admin.ts` `/playbook` | Explicit snake_case map | ✅ Correct |
| `admin.ts` `/activity` | Explicit snake_case map | ✅ Correct |
| `admin.ts` `/usage` | Explicit snake_case map | ✅ Correct |
| `admin.ts` `/dashboard` | **Spreads raw Drizzle rows** (`{ ...p, scores, citations, proofs, minutes }`) — camelCase fields in response | ⚠️ Tracked in Task #22 |
| `voice-library.ts` | Returns `{ ok: true }` only | ✅ Correct |
| `ai/index.ts` | Returns structured response objects (not raw rows) | ✅ Correct |
| `recovery.ts` | In OpenAPI spec; explicit mapping | ✅ Correct |
| `quality-gate.ts` | In OpenAPI spec; explicit mapping | ✅ Correct |

---

## Live Smoke Tests

| Test | Result | Notes |
|---|---|---|
| `GET /api/healthz` | ✅ 200 `{"status":"ok"}` | Verified via curl |
| API server boot | ✅ Clean | Boot migrations ran; `Server listening port=8080` |
| TypeScript typecheck (all packages) | ✅ Pass | `pnpm run typecheck` — 0 errors across 5 packages |

### Flows verified via code audit (not live E2E — requires AI API keys + active project)

| Flow | Code path | Verdict |
|---|---|---|
| Draft section | `brandId: project.brandId` present in insert | ✅ Will not 500 on brand_id constraint |
| Final stitch | `brandId: project.brandId` + null guard | ✅ Will not 500 on brand_id constraint |
| Research job — proof points | `brandId: project.brand_id` added to insert | ✅ Was broken; now fixed |
| Interview answers save | 404 guard on missing project | ✅ Will not 500 on brand_id constraint |
| Quality gate submit / decide | `submitted_by` / `decided_by` now `text` — accepts Clerk IDs | ✅ Type mismatch resolved |
| Recovery overview / snapshots / initiatives | Explicit mapping; UUID guard in `ensureRead()` | ✅ No serialization issues |

### Known remaining gaps (tracked as follow-up tasks)

- **Task #22**: `GET /api/admin/dashboard` spreads raw Drizzle camelCase rows — admin overview table may show undefined for some columns
- **Task #21**: No automated regression tests for schema insert paths — next schema drift will be invisible until it 500s in production

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
- `artifacts/api-server/src/routes/projects.ts` — 404 guard for null brandId in interview-answers; `mode` update cast fix
- `artifacts/api-server/src/routes/ai/index.ts` — null guard for project in final-stitch; `project?.brandId` → `project.brandId`

### Documentation
- `docs/pre-deploy-checklist.md` — new permanent pre-deploy checklist
- `docs/qa-sprint-7-may-2026.md` — this report
