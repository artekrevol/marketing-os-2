/** Thrown when a state transition is illegal. */
export class InvalidTransitionError extends Error {
  constructor(public readonly from: string, public readonly to: string) {
    super(`Quality gate: cannot transition from "${from}" to "${to}"`);
    this.name = "InvalidTransitionError";
  }
}

/** Thrown when the content object referenced doesn't exist or is in the wrong brand. */
export class ContentObjectNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Quality gate: content_object ${id} not found in scope`);
    this.name = "ContentObjectNotFoundError";
  }
}

/** Thrown when a reject decision is missing the required comment. */
export class MissingCommentError extends Error {
  constructor() {
    super("Quality gate: a non-empty comment is required to reject content");
    this.name = "MissingCommentError";
  }
}

/** Thrown by the override path. Override modal is out of scope for Sprint 3 Part 1. */
export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`Quality gate: ${feature} is not implemented yet (Sprint 3 Part 2)`);
    this.name = "NotImplementedError";
  }
}
