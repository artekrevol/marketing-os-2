import { z } from "zod";

export const ContentStatusSchema = z.enum([
  "drafting",
  "submitted",
  "in_review",
  "approved",
  "rejected",
]);
export type ContentStatus = z.infer<typeof ContentStatusSchema>;

export const QaRunStatusSchema = z.enum([
  "queued",
  "running",
  "passed",
  "failed",
  "error",
]);
export type QaRunStatus = z.infer<typeof QaRunStatusSchema>;

export const CheckSeveritySchema = z.enum(["hard", "warn"]);
export type CheckSeverity = z.infer<typeof CheckSeveritySchema>;

export const CheckOutcomeSchema = z.enum(["pass", "fail", "error"]);
export type CheckOutcome = z.infer<typeof CheckOutcomeSchema>;

/**
 * Canonical check identifiers. Adding a new check requires:
 *   1. Adding it here.
 *   2. Inserting a row in qa_check_definitions for every brand.
 *   3. Implementing the runner in `lib/worker/src/jobs/content/checks/<name>.ts`.
 */
export const CHECK_NAMES = [
  "originality.ai-score",
  "reading-level.flesch-grade",
  "brand-voice.confidence",
  "brief-compliance.coverage",
] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

/** Submit-for-review action payload. */
export const SubmitForReviewInputSchema = z.object({
  contentObjectId: z.string().uuid(),
  actorId: z.string().uuid(),
  brandId: z.string().uuid(),
});
export type SubmitForReviewInput = z.infer<typeof SubmitForReviewInputSchema>;

/** Reviewer decision payload. */
export const DecideInputSchema = z.object({
  contentObjectId: z.string().uuid(),
  reviewerId: z.string().uuid(),
  brandId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().optional(),
});
export type DecideInput = z.infer<typeof DecideInputSchema>;
