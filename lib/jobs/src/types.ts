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
} as const;

export type JobName = keyof typeof JOB_REGISTRY;

export type JobData<N extends JobName> = z.infer<
  (typeof JOB_REGISTRY)[N]["schema"]
>;
