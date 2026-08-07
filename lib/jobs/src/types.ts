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

/* -------------------------------------------------------------------------- */
/* SEO Intelligence — keyword research, rank tracking, competitor discovery   */
/* -------------------------------------------------------------------------- */

// Execute one crawl batch: for each keyword in the batch, run a SERP
// query, compute the brand's TRUE-organic position (ads / local pack
// excluded — math lives in the handler), and write a `rank_snapshots`
// row. `batchId` is a pre-created `crawl_batches` row the handler drives
// through running → complete/failed. When `keywordIds` is omitted the
// handler runs every keyword for the brand.
// Idempotency: `idempotencyKey` is `seo-crawl:<batchId>`; the handler
// additionally resumes by skipping keywords that already have a snapshot
// for this batch, so a retry never re-bills a keyword already crawled.
export const SeoCrawlRunPayload = BasePayload.extend({
  brandId: z.string().uuid(),
  batchId: z.string().uuid(),
  keywordIds: z.array(z.string().uuid()).optional(),
});

// Fired by a `crawl_schedules` repeatable. Resolves the schedule's
// keyword set (its `listId`, or all brand keywords when null), creates a
// fresh `crawl_batches` row, and enqueues a `seo.crawl.run` for it. Each
// cron tick mints a new batch (unique id → unique downstream idem key).
export const SeoRankCheckScheduledPayload = BasePayload.extend({
  brandId: z.string().uuid(),
  scheduleId: z.string().uuid(),
  // null = all keywords for the brand.
  listId: z.string().uuid().nullable().optional(),
});

// For a keyword set, pull SERP data and record competitor URLs into
// `competitor_pages` (excluding the brand's own primary domain and any
// blacklisted domains). Costs money per keyword — callers bound the set.
export const SeoCompetitorDiscoverPayload = BasePayload.extend({
  brandId: z.string().uuid(),
  keywordIds: z.array(z.string().uuid()).optional(),
});

// Recompute `competitor_insights` for a brand from the accumulated
// `competitor_pages` rows. Pure DB aggregation — no external API cost.
export const SeoCompetitorInsightsComputePayload = BasePayload.extend({
  brandId: z.string().uuid(),
});

/* -------------------------------------------------------------------------- */
/* Shared Data Layer — cross-module linking & context refresh                  */
/* -------------------------------------------------------------------------- */

// Fired when a project transitions published_at null -> non-null. Auto-links
// the project's primary keyword (projects.keyword) to the project via
// content_url_keyword_link and baselines rankings for a newly-tracked keyword.
// Idempotent on the link's unique (project_id, keyword_id) and on jobId
// `content.publish-link-keyword:publish-link:<projectId>`.
export const ContentPublishLinkKeywordPayload = BasePayload.extend({
  brandId: z.string().uuid(),
  projectId: z.string().uuid(),
});

// Per-brief refresh: re-runs getKeywordContext for an in-flight brief and
// writes a NEW keyword_research_briefs snapshot row (the table is immutable in
// practice — never updated in place). Notifies the writer only on a
// meaningful change (volume >20%, ranking >5 positions, new top-5 competitor).
export const SeoRefreshContentContextPayload = BasePayload.extend({
  brandId: z.string().uuid(),
  briefId: z.string().uuid(),
});

// Nightly fan-out (BullMQ repeatable, 0 3 * * *). Enqueues one
// seo.refresh-content-context per in-flight (unpublished) brief whose latest
// snapshot is older than 7 days.
export const SeoRefreshContentContextNightlyPayload = BasePayload.extend({});

// Discovery Engine — weekly keyword candidate discovery.
// Expands a brand's top commercial/transactional seed keywords via
// DataForSEO Labs related_keywords, then mines curated competitor domains
// via ranked_keywords. Surviving candidates (KD < maxKd, not already
// tracked) are inserted as is_discovery_candidate=true / 'pending' review.
// Also writes competitor_movements snapshots and runs the 30-day archive sweep.
// Runs every Monday at 02:00 UTC via a BullMQ repeatable.
export const SeoDiscoveryWeeklyPayload = BasePayload.extend({
  brandId: z.string().uuid(),
  /** ISO week label e.g. "2026-30". Auto-set by scheduler; override for backfill. */
  weekLabel: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "weekLabel must be YYYY-WW")
    .optional(),
  /**
   * Max keyword difficulty score (0–100) accepted as a candidate (exclusive upper bound:
   * drop KD ≥ maxKd). Defaults to 70, matching env var DISCOVERY_KD_FILTER_MAX.
   * Pass explicitly to override for backfill runs. The env var takes precedence over
   * this default at runtime (operator-level tuning without code changes).
   */
  maxKd: z.number().int().min(0).max(100).default(70),
  /** How many seed keywords to pull. Default 20 (aligns with dispatcher-approved seed set). */
  seedLimit: z.number().int().min(1).max(50).default(20),
  /** Max related keywords returned per seed. DataForSEO cap 1000. Default 500. */
  relatedLimit: z.number().int().min(1).max(1000).default(500),
  /** Max ranked keywords pulled per competitor domain. Default 200. */
  competitorRankedLimit: z.number().int().min(1).max(1000).default(200),
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
  "seo.crawl.run": {
    queue: "integrations" as QueueName,
    schema: SeoCrawlRunPayload,
  },
  "seo.rank-check.scheduled": {
    queue: "integrations" as QueueName,
    schema: SeoRankCheckScheduledPayload,
  },
  "seo.competitor.discover": {
    queue: "integrations" as QueueName,
    schema: SeoCompetitorDiscoverPayload,
  },
  "seo.competitor-insights.compute": {
    queue: "integrations" as QueueName,
    schema: SeoCompetitorInsightsComputePayload,
  },
  "content.publish-link-keyword": {
    queue: "integrations" as QueueName,
    schema: ContentPublishLinkKeywordPayload,
  },
  "seo.refresh-content-context": {
    queue: "integrations" as QueueName,
    schema: SeoRefreshContentContextPayload,
  },
  "seo.refresh-content-context-nightly": {
    queue: "integrations" as QueueName,
    schema: SeoRefreshContentContextNightlyPayload,
  },
  // Discovery Engine — weekly keyword candidate discovery + competitor movements.
  "seo.discovery.weekly": {
    queue: "integrations" as QueueName,
    schema: SeoDiscoveryWeeklyPayload,
  },
} as const;

export type JobName = keyof typeof JOB_REGISTRY;

export type JobData<N extends JobName> = z.infer<
  (typeof JOB_REGISTRY)[N]["schema"]
>;
