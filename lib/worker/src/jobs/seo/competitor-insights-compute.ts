import { sql } from "drizzle-orm";
import {
  withBrandScope,
  competitorInsightsTable,
  eventsTable,
} from "@workspace/db";
import type { JobData } from "@workspace/jobs";
import type { Logger } from "pino";

const SUCCESS_EVENT = "seo.competitor-insights.computed";

/** Max keyword texts retained in each insight's `top_keywords`. */
const TOP_KEYWORDS = 10;

interface AggRow {
  competitor_domain: string;
  shared_keyword_count: number;
  average_position: number | null;
}

interface KeywordRow {
  competitor_domain: string;
  keyword_text: string;
  best_pos: number | null;
}

/**
 * Recompute `competitor_insights` for a brand from accumulated
 * `competitor_pages`. Pure DB aggregation — no external API cost.
 *
 * Strategy: full recompute. We aggregate per competitor domain, then
 * wipe the brand's existing insight rows and reinsert. `competitor_pages`
 * reads use raw `db.execute` (with an explicit brand_id filter) because
 * the guarded tx forbids `select().from()` on brand-scoped tables; the
 * writes go through `scoped.*` so tenancy stamping/validation still
 * applies.
 */
export async function handleSeoCompetitorInsightsCompute(
  payload: JobData<"seo.competitor-insights.compute">,
  log: Logger,
): Promise<{ domains: number }> {
  return withBrandScope(payload.brandId, async ({ db, scoped }) => {
    const aggResult = (await db.execute(sql`
      select
        competitor_domain,
        count(distinct keyword_id)::int as shared_keyword_count,
        round(avg(position)::numeric, 2) as average_position
      from public.competitor_pages
      where brand_id = ${payload.brandId}::uuid
      group by competitor_domain
    `)) as unknown as { rows?: AggRow[] } | AggRow[];
    const aggRows = Array.isArray(aggResult) ? aggResult : (aggResult.rows ?? []);

    const kwResult = (await db.execute(sql`
      select
        cp.competitor_domain,
        k.keyword_text,
        min(cp.position) as best_pos
      from public.competitor_pages cp
      join public.keywords k on k.id = cp.keyword_id
      where cp.brand_id = ${payload.brandId}::uuid
      group by cp.competitor_domain, k.keyword_text
    `)) as unknown as { rows?: KeywordRow[] } | KeywordRow[];
    const kwRows = Array.isArray(kwResult) ? kwResult : (kwResult.rows ?? []);

    // Build top-keyword lists per domain (best organic position first).
    const byDomain = new Map<string, KeywordRow[]>();
    for (const r of kwRows) {
      const list = byDomain.get(r.competitor_domain) ?? [];
      list.push(r);
      byDomain.set(r.competitor_domain, list);
    }
    const topKeywordsFor = (domain: string): string[] =>
      (byDomain.get(domain) ?? [])
        .slice()
        .sort(
          (a, b) =>
            (a.best_pos ?? Number.MAX_SAFE_INTEGER) -
            (b.best_pos ?? Number.MAX_SAFE_INTEGER),
        )
        .slice(0, TOP_KEYWORDS)
        .map((r) => r.keyword_text);

    // Full recompute: wipe this brand's insights, then reinsert.
    await scoped.delete(competitorInsightsTable);

    const now = new Date();
    const insertRows = aggRows.map((a) => ({
      brandId: payload.brandId,
      competitorDomain: a.competitor_domain,
      sharedKeywordCount: a.shared_keyword_count,
      averagePosition:
        a.average_position == null ? null : a.average_position.toString(),
      topKeywords: topKeywordsFor(a.competitor_domain),
      lastComputedAt: now,
    }));

    if (insertRows.length > 0) {
      await scoped.insert(competitorInsightsTable, insertRows);
    }

    await db.insert(eventsTable).values({
      eventType: SUCCESS_EVENT,
      brandId: payload.brandId,
      subjectType: "competitor_insights",
      subjectId: payload.brandId,
      payload: {
        idempotencyKey: payload.idempotencyKey,
        domains: insertRows.length,
      },
    });

    log.info(
      { domains: insertRows.length },
      "seo.competitor-insights.compute: done",
    );
    return { domains: insertRows.length };
  });
}
