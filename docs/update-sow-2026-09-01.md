# Statement of Work Update

## Project

**Marketing OS — SEO OS and ContentForge**  
**Update date:** September 1, 2026  
**Status:** In progress; not all tracked work is complete  
**Current branch:** `main`

## Executive status

The brand-tenancy foundation and brand-specific reporting attribution tracks
have been merged. The project is not yet ready for full closeout because eight
implementation tasks remain proposed, one follow-up reporting QA task remains
proposed, and the current branch has two verification blockers:

1. The database isolation test suite has a TypeScript/transform error caused by
   `await` inside non-async test callbacks.
2. The API server typecheck fails in the AI routes with unresolved variables and
   mismatched route logic.

These blockers should be resolved before the remaining work is declared
production-ready.

## Work completed

### Previously completed milestones

- Centralized admin-only brand creation for ContentForge, SEO OS, and future
  modules.
- Isolated ContentForge playbooks and AI context by brand and playbook version.
- Added real Postgres coverage for Playbook isolation.
- Implemented production-oriented GSC synchronization, resumable backfill
  support, fixed worker job IDs, and Scheduled Deployment guidance.

### Newly merged tenancy and reporting work

| Task | Status | Delivered scope |
| --- | --- | --- |
| #69 — Prevent any brand from accessing another brand’s connections, SEO data, or background jobs | **Merged** | API and OAuth brand checks, resource ownership validation, database ownership constraints, worker brand context, brand-aware job identity, cache/storage scoping, and the reusable tenant-isolation checklist. |
| #70 — Make every brand’s activity, AI costs, and performance reporting private and accurate | **Merged** | Explicit telemetry attribution, brand-scoped activity and usage reporting, AI-cost attribution, and reporting route/UI updates for authorized brand views. |

The merged implementation is represented by the current commits:

- `73729b3` — brand isolation across APIs, OAuth, database relationships,
  caches, storage paths, and worker jobs.
- `f12642f` — explicit brand attribution across telemetry and reports.

## Current task ledger

| Task | Current state | SOW disposition |
| --- | --- | --- |
| #69 — Brand isolation across connections, SEO data, and jobs | **Merged** | Delivered; retain the checklist and two-brand test matrix as ongoing acceptance controls. |
| #70 — Brand-private activity, AI costs, and reporting | **Merged** | Delivered; requires the proposed reporting QA follow-up before final closeout. |
| #61 — Populate TekRevol Search Performance and turn on daily automation | **Proposed** | Outstanding production data/backfill and schedule verification. |
| #28 — Fix background-job crashes in AI research and recovery snapshots | **Proposed** | Outstanding worker reliability and recovery-path work. |
| #8 — Add a Postgres-backed health graph for QA error rates | **Proposed** | Outstanding operational visibility work. |
| #2 — Apply Sprint 1 migrations to Supabase preview, then re-export types | **Proposed** | Outstanding environment/schema synchronization work. |
| #73 — Catch cross-brand reporting leaks before they ship | **Proposed** | Outstanding regression and two-brand reporting QA. |
| #9 — Catch upstream timeouts on every AI call, not just brand voice | **Proposed** | Outstanding resilience and timeout coverage. |
| #3 — Tag every existing flow with brand-aware events | **Proposed** | Outstanding event coverage for drafts, briefs, outlines, and reviews. |
| #4 — Sprint 2 background worker and queue | **Proposed** | Outstanding queue/worker deployment work. |
| #74 — Catch cross-brand integration leaks before they ship | **Cancelled** | Superseded by the broader merged isolation implementation in Task #69; no separate delivery is required unless a new gap is found. |

## Verification performed

| Check | Result | Notes |
| --- | --- | --- |
| Content AI tests | **Passed** | 3 test files, 41 tests. |
| Worker tests | **Passed** | 5 test files, 41 tests. |
| Database tests | **Blocked** | 3 suites passed with 53 tests, but `test/brand-scope.test.ts` failed to transform because `await` is used inside non-async callbacks. |
| Workspace typecheck | **Blocked** | `artifacts/api-server/src/routes/ai/index.ts` reports unresolved identifiers and invalid expressions, including `projectRows`, `interviewInstructions`, `section_id`, `resp`, `md`, and final-stitch variables. |
| Browser/end-to-end verification | **Not run** | Workflows are currently stopped, and the typecheck/database blockers should be fixed before a meaningful end-to-end pass. |

## Remaining scope

### 1. Restore a green verification baseline

- Correct the database isolation test callbacks and assertions.
- Repair the API AI route so the workspace typecheck passes.
- Re-run database, Content AI, worker, and full workspace checks.
- Start the relevant API and web workflows and complete a browser pass for the
  changed tenant/reporting flows.

### 2. Complete production SEO operations

- Execute and verify the TekRevol GSC backfill.
- Confirm real Search Performance rows are visible.
- Verify daily GSC automation and the documented Recovery, content-context, and
  Discovery Engine schedules.
- Keep dynamic crawl schedules and delayed-job migration explicitly deferred
  unless separately authorized.

### 3. Harden worker reliability and queue operations

- Fix AI research and recovery snapshot crashes.
- Apply consistent timeout handling to every upstream AI call.
- Complete the Sprint 2 worker/queue deployment path.
- Preserve brand context through enqueue, retry, terminal-failure, and
  idempotency paths.

### 4. Finish telemetry and QA coverage

- Add brand-aware events to all existing content flows.
- Add the Postgres-backed QA health graph.
- Run the two-brand reporting regression matrix from
  `docs/tenant-isolation-checklist.md`, including reads, mutations, exports,
  OAuth, workers, cache/storage, retries, and partial failures.

## Recommended execution sequence

This is the recommended delivery order; it does not change the task board’s
current proposed status:

1. **Unblock validation:** database test and API typecheck repairs.
2. **Synchronize schema/environment:** apply the Sprint 1 preview migrations and
   regenerate types.
3. **Stabilize workers:** AI timeout handling, research/recovery crash fixes,
   then Sprint 2 queue/deployment work.
4. **Complete production GSC operations:** run the backfill and verify the
   Scheduled Deployments and user-visible data.
5. **Complete event and health observability:** brand-aware event coverage and
   the QA health graph.
6. **Run final tenancy/reporting regression:** close the reporting QA follow-up
   only after the two-brand matrix passes in API, worker, cache, storage, and
   reporting paths.

## Acceptance criteria for final closeout

The project can be considered ready for final closeout when all of the
following are true:

- No tracked implementation task remains proposed, unless explicitly accepted
  as deferred scope.
- Workspace typecheck is green.
- Database, Content AI, and worker test suites pass without transform or
  collection errors.
- Browser verification passes for selected-brand behavior, admin reporting,
  integrations, Search Performance, and the relevant ContentForge flows.
- An actor authorized for Brand A cannot read, mutate, enqueue, export, cache,
  or authorize work for Brand B.
- All tenant-owned jobs and telemetry retain explicit brand attribution.
- Production GSC data and fixed schedules are verified from the documented
  handoff.
- No deployment or Reserved VM republish is performed without an explicit
  request.

## Reference documents

- `docs/tenant-isolation-checklist.md`
- `docs/scheduled-deployments.md`
- `.local/tasks/gsc-scheduled-sync.md`
- `.local/tasks/brand-isolation-enforcement.md`
- `replit.md`
