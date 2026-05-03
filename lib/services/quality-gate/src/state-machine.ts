import type { ContentStatus, QaRunStatus } from "./types";
import { InvalidTransitionError } from "./errors";

/**
 * Quality-gate state machine for `content_objects.status`.
 *
 * Allowed transitions:
 *
 *   drafting   → submitted   (writer presses "Submit for Review")
 *   submitted  → in_review   (qa_run reaches a terminal state — passed,
 *                             failed, or error). Hard-failed and errored
 *                             runs LAND in the reviewer queue (not
 *                             auto-bounced to drafting). The reviewer
 *                             can only request revisions for them; the
 *                             approve path is gated in `decide()`.
 *   in_review  → approved    (reviewer approves — only when the latest
 *                             qa_run.status is 'passed'; enforced in
 *                             `decide()`, not the transition table)
 *   in_review  → rejected    (reviewer rejects with a comment; always
 *                             allowed regardless of qa_run outcome)
 *   rejected   → drafting    (writer reopens to revise)
 *
 * Any other transition throws `InvalidTransitionError`. The state
 * machine is pure and side-effect free — actions module wraps it with
 * DB writes inside `withBrandScope`.
 */
const TRANSITIONS: Record<ContentStatus, ReadonlyArray<ContentStatus>> = {
  drafting:  ["submitted"],
  submitted: ["in_review"],
  in_review: ["approved", "rejected"],
  approved:  [],
  rejected:  ["drafting"],
};

export function canTransition(from: ContentStatus, to: ContentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ContentStatus, to: ContentStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/**
 * Map a completed QA run to the next content_object.status. All three
 * terminal qa_run states funnel into `in_review` so the reviewer queue
 * is the single source of truth for "needs human attention". Approve
 * is hard-gated in `decide()` for failed/errored runs — the queue UI
 * surfaces the qa_run status so reviewers know which runs are
 * approve-eligible vs revision-only.
 *
 * `queued` and `running` are non-terminal and never feed this function.
 */
export function statusFromQaRun(qaStatus: QaRunStatus): ContentStatus {
  switch (qaStatus) {
    case "passed":
    case "failed":
    case "error":
      return "in_review";
    default:
      throw new Error(
        `statusFromQaRun: cannot derive content status from qa_run status="${qaStatus}"`,
      );
  }
}

/**
 * Returns true if a reviewer is allowed to approve a content_object
 * whose latest qa_run has the given status. Only `passed` qualifies.
 * `null` (no qa_run yet) and any non-terminal/failed status block
 * approval. Rejection / request-revision is allowed regardless and is
 * not routed through this guard.
 */
export function canApproveForQaStatus(qaStatus: QaRunStatus | null): boolean {
  return qaStatus === "passed";
}
