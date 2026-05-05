import { z } from "zod";
import type { QueueName } from "./queues";

/**
 * Canonical job-name → payload schema map.
 *
 * Adding a new job:
 *   1. Add a key here with `{ queue, schema }`.
 *   2. Implement the handler in `lib/worker/src/jobs/<file>.ts`.
 *   3. Register the handler in `lib/worker/src/jobs/index.ts`.
 *
 * Every payload must include `idempotencyKey: string`. Handlers are
 * required to short-circuit on duplicate keys.
 */

const BasePayload = z.object({
  idempotencyKey: z.string().min(1),
  brandId: z.string().uuid().optional(),
});

export const HeartbeatPayload = BasePayload.extend({
  message: z.string().default("heartbeat"),
});

export const DataForSeoSerpTestPayload = BasePayload.extend({
  query: z.string().default("tekrevol"),
  locationCode: z.number().int().default(2840), // United States
  languageCode: z.string().default("en"),
});

export const OriginalityScanTestPayload = BasePayload.extend({
  text: z.string().default(
    "Original content benchmark used by the SEO OS worker tier to verify the Originality.ai integration is healthy.",
  ),
});

// Sprint 3 — runs the automated check stack against a content_object.
// brandId is required (non-optional override): the QA pipeline must
// not run cross-brand. qaRunId is the pre-created qa_runs row; the
// worker mutates it through the lifecycle.
export const QaRunChecksPayload = BasePayload.extend({
  brandId: z.string().uuid(),
  qaRunId: z.string().uuid(),
  contentObjectId: z.string().uuid(),
});

// Recovery War Room — delayed job (14 days) scheduled by
// `completeInitiative`. Worker computes
// `recovery_initiatives.actual_impact_clicks_14d` from the baseline-vs-
// current delta over the 14 days following completion. Lives on the
// `scoring` queue (amendments §E — already provisioned).
export const RecoveryInitiativeImpactPayload = BasePayload.extend({
  brandId: z.string().uuid(),
  initiativeId: z.string().uuid(),
});

// Recovery War Room — daily roll-up. The handler computes a
// `recovery_snapshots` row for `(brandId, snapshotDate)` from
// `rank_snapshots` over the trailing 30-day window. Idempotent on
// the unique `(brand_id, snapshot_date)` index. Amendments §D.4.
export const RecoverySnapshotPayload = BasePayload.extend({
  brandId: z.string().uuid(),
  // ISO date YYYY-MM-DD (the day the snapshot represents).
  snapshotDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "snapshotDate must be ISO date YYYY-MM-DD"),
});

// Recovery War Room — nightly fan-out scheduler. Runs at 03:00 UTC
// via BullMQ `repeat.pattern`. Iterates every brand with a locked
// baseline and enqueues one `scoring.recovery-snapshot` job for
// yesterday's date.
export const RecoverySnapshotNightlyPayload = BasePayload.extend({});

// AI edge-function background jobs (edge functions migration)
const AI_STAGE_KEY = z.enum([
  "search_intent",
  "benchmark_teardown",
  "competitor_teardown",
  "synergy_map",
  "angle_and_conversion",
  "ai_citation_landscape",
  "atomic_and_entities",
]);

export const AiProposeBriefPayload = BasePayload.extend({
  project_id: z.string().uuid(),
});

export const AiResearchGeneratePayload = BasePayload.extend({
  project_id: z.string().uuid(),
});

export const AiResearchRetryCardPayload = BasePayload.extend({
  project_id: z.string().uuid(),
  stage: AI_STAGE_KEY,
});

export const JOB_REGISTRY = {
  "maintenance.heartbeat-noop": {
    queue: "maintenance" as QueueName,
    schema: HeartbeatPayload,
  },
  "integrations.dataforseo-serp-test": {
    queue: "integrations" as QueueName,
    schema: DataForSeoSerpTestPayload,
  },
  "integrations.originality-ai-scan-test": {
    queue: "integrations" as QueueName,
    schema: OriginalityScanTestPayload,
  },
  "content.qa-run-checks": {
    queue: "content" as QueueName,
    schema: QaRunChecksPayload,
  },
  "scoring.recovery-initiative-impact": {
    queue: "scoring" as QueueName,
    schema: RecoveryInitiativeImpactPayload,
  },
  "scoring.recovery-snapshot": {
    queue: "scoring" as QueueName,
    schema: RecoverySnapshotPayload,
  },
  "scoring.recovery-snapshot-nightly": {
    queue: "scoring" as QueueName,
    schema: RecoverySnapshotNightlyPayload,
  },
  "ai.propose-brief": {
    queue: "ai" as QueueName,
    schema: AiProposeBriefPayload,
  },
  "ai.research-generate": {
    queue: "ai" as QueueName,
    schema: AiResearchGeneratePayload,
  },
  "ai.research-retry-card": {
    queue: "ai" as QueueName,
    schema: AiResearchRetryCardPayload,
  },
} as const;

export type JobName = keyof typeof JOB_REGISTRY;

export type JobData<N extends JobName> = z.infer<
  (typeof JOB_REGISTRY)[N]["schema"]
>;
