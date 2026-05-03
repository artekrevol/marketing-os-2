/**
 * Thrown when `lockBaseline` is called for a brand that already has a
 * locked baseline. Override is admin-only and lives in a separate
 * code path (Wave 2); it is not part of the normal lock flow.
 */
export class BaselineAlreadyLockedError extends Error {
  constructor(public readonly brandId: string) {
    super(`Recovery: baseline already locked for brand ${brandId}`);
    this.name = "BaselineAlreadyLockedError";
  }
}

/**
 * Thrown when the rankings data needed to compute a baseline is
 * missing for the requested `baselineDate`. The lock-baseline action
 * refuses to proceed rather than write a baseline with NULL position
 * data — the rankings story is the headline metric for this sprint.
 */
export class InsufficientRankingsDataError extends Error {
  constructor(
    public readonly brandId: string,
    public readonly baselineDate: string,
  ) {
    super(
      `Recovery: rank_snapshots has no rows for brand ${brandId} on ${baselineDate}; cannot compute baseline`,
    );
    this.name = "InsufficientRankingsDataError";
  }
}

/** Thrown when an initiative id resolves outside the active brand scope. */
export class InitiativeNotFoundError extends Error {
  constructor(public readonly initiativeId: string) {
    super(`Recovery: initiative ${initiativeId} not found in scope`);
    this.name = "InitiativeNotFoundError";
  }
}

/** Thrown when completing an initiative that is not in `active` status. */
export class InitiativeNotActiveError extends Error {
  constructor(
    public readonly initiativeId: string,
    public readonly status: string,
  ) {
    super(
      `Recovery: initiative ${initiativeId} is in status "${status}", cannot complete`,
    );
    this.name = "InitiativeNotActiveError";
  }
}
