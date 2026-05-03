// @workspace/recovery — Recovery War Room service layer. Every write
// runs inside `withBrandScope`; queries return brand-scoped data only.
// The burn-down projection (`lib/projection.ts`) is a pure function
// suitable for unit testing without a DB.

export * from "./types";
export * from "./errors";
export * from "./actions";
export * from "./queries";
export {
  computeProjection,
  MIN_POINTS_FOR_PROJECTION,
  type ProjectionResult,
  type ProjectionInputPoint,
} from "./lib/projection";
