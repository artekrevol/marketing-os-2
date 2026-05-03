import { sql } from "drizzle-orm";
import { InsufficientRankingsDataError } from "../errors";

/**
 * Aggregated 30-day rolling slice of `rank_snapshots` ending on the
 * baseline date. Per amendments §D.2 baselines are computed from
 * rankings only; GSC/GA4 stay NULL.
 */
export interface RankingsBaseline {
  avgPosition: number;
  keywordsInTop10: number;
  keywordsInTop3: number;
  keywordCount: number;
}

/** Subset of the Drizzle DB / tx interface this helper needs. */
type DbExecutor = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

/**
 * Compute the rankings portion of a baseline against `rank_snapshots`.
 * Read via raw SQL — `rank_snapshots` is owned by Sprint 1 and not
 * mirrored in Drizzle. Columns assumed: `brand_id uuid`, `keyword text`,
 * `position numeric`, `snapshot_date date`.
 *
 * Methodology (amendments §D.2):
 *   - Take the most-recent position per keyword within the 30-day
 *     window ending on `baselineDate`. This collapses noisy daily
 *     readings to one snapshot per keyword — the value the pack
 *     describes as "the baseline-day position."
 *   - `avg_position` = mean across those keywords.
 *   - `keywords_in_top_10` / `keywords_in_top_3` = counts at <= 10 / <= 3.
 *
 * Throws `InsufficientRankingsDataError` when no rows exist in the
 * window — refusing to compute is safer than producing a misleading
 * baseline with zero keywords.
 *
 * Exported so the seed script (`scripts/lock-baselines.ts`) can run
 * the computation in dry-run mode without writing to the database.
 */
export async function computeRankingsBaseline(
  db: DbExecutor,
  brandId: string,
  baselineDate: string,
): Promise<RankingsBaseline> {
  const result = (await db.execute(sql`
    with latest_per_keyword as (
      select distinct on (keyword)
        keyword,
        position
      from public.rank_snapshots
      where brand_id = ${brandId}::uuid
        and snapshot_date <= ${baselineDate}::date
        and snapshot_date > (${baselineDate}::date - interval '30 days')
      order by keyword, snapshot_date desc
    )
    select
      avg(position)::numeric                           as avg_position,
      count(*) filter (where position <= 10)::integer  as top_10,
      count(*) filter (where position <= 3)::integer   as top_3,
      count(*)::integer                                as keyword_count
    from latest_per_keyword
  `)) as { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;

  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  const row = rows[0];
  const keywordCount = Number(row?.keyword_count ?? 0);
  if (!row || keywordCount === 0) {
    throw new InsufficientRankingsDataError(brandId, baselineDate);
  }
  return {
    avgPosition: Number(row.avg_position),
    keywordsInTop10: Number(row.top_10),
    keywordsInTop3: Number(row.top_3),
    keywordCount,
  };
}

/**
 * Earliest snapshot_date for a brand. Used by the seed script as a
 * fallback for ClaimShield / CensusFlow when the requested
 * `baseline_date` predates their data ("limited pre-launch data" per
 * pack Prompt 3). Returns `null` when the brand has no snapshots.
 */
export async function findEarliestSnapshotDate(
  db: DbExecutor,
  brandId: string,
): Promise<string | null> {
  const result = (await db.execute(sql`
    select min(snapshot_date)::text as min_date
    from public.rank_snapshots
    where brand_id = ${brandId}::uuid
  `)) as { rows?: Array<{ min_date: string | null }> } | Array<{ min_date: string | null }>;
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  return rows[0]?.min_date ?? null;
}
