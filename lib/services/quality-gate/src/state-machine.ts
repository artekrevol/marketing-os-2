import type { ContentStatus, QaRunStatus } from "./types";
import { InvalidTransitionError } from "./errors";

/**
 * Quality-gate state machine for `content_objects.status`.
 *
 * Allowed transitions:
 *
 *   drafting   → submitted   (writer presses "Submit for Review")
 *   submitted  → in_review   (qa_run completes with status='passed')
 *   submitted  → drafting    (qa_run completes with status='failed' — auto-bounce)
 *   in_review  → approved    (reviewer approves)
 *   in_review  → rejected    (reviewer rejects with comment)
 *   rejected   → drafting    (writer reopens to revise)
 *
 * Any other transition throws `InvalidTransitionError`. The state
 * machine is pure and side-effect free — actions module wraps it with
 * DB writes inside `withBrandScope`.
 */
const TRANSITIONS: Record<ContentStatus, ReadonlyArray<ContentStatus>> = {
  drafting:  ["submitted"],
  submitted: ["in_review", "drafting"],
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
 * Map a completed QA run to the next content_object.status.
 *
 *   passed → in_review
 *   failed → drafting       (auto-bounce, writer fixes and resubmits)
 *   error  → drafting       (handler crashed — surface to writer)
 *
 * `queued` and `running` are non-terminal and never feed this function.
 */
export function statusFromQaRun(qaStatus: QaRunStatus): ContentStatus {
  switch (qaStatus) {
    case "passed":
      return "in_review";
    case "failed":
    case "error":
      return "drafting";
    default:
      throw new Error(
        `statusFromQaRun: cannot derive content status from qa_run status="${qaStatus}"`,
      );
  }
}
