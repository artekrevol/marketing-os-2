/**
 * Shared Data Layer — standard result shape for every cross-module read.
 *
 * Design rules (see attached dispatch):
 *  1. Never throw on missing data — return a typed empty state.
 *  2. Consumers handle empty states explicitly (the `reason` discriminator).
 *  3. Attribution is mandatory — every read carries a `DataSource` when data
 *     exists (module + freshness), consumed by <DataSourceTag>.
 *  4. Staleness is data, not error — past-threshold data still returns with
 *     `source.isFresh = false`.
 */

export type DataSourceModule = "content-forge" | "seo-os" | "system";

export type DataSource = {
  module: DataSourceModule;
  /** When the underlying data was last (re)generated/checked. */
  generatedAt: Date;
  /** False when the limiting underlying datum is past its threshold. */
  isFresh: boolean;
  /** The threshold (days) of the limiting category, for UI display. */
  staleAfterDays: number;
  /** What action the UI can offer to refresh, if any. */
  refreshAction?: "crawl" | "manual" | null;
};

export type QueryReason =
  | null
  | "not-yet-tracked"
  | "never-crawled"
  | "not-published"
  | "no-rankings"
  | "no-competitors"
  | "stale"
  | "system-error";

export type QueryResult<T> = {
  data: T;
  source: DataSource | null;
  reason: QueryReason;
};

/**
 * Staleness thresholds (dispatcher-approved). Past threshold: mark stale in
 * UI, still display.
 */
export const STALE_THRESHOLD_DAYS = {
  keywordMetrics: 30,
  rankSnapshot: 7,
  competitorPage: 14,
} as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function ageInDays(from: Date, now: Date = new Date()): number {
  return (now.getTime() - new Date(from).getTime()) / MS_PER_DAY;
}

export function isFreshWithin(
  generatedAt: Date | null | undefined,
  staleAfterDays: number,
  now: Date = new Date(),
): boolean {
  if (!generatedAt) return false;
  return ageInDays(generatedAt, now) <= staleAfterDays;
}
