import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  withBrandScope,
  brandsTable,
  keywordsTable,
  locationsTable,
  blacklistedDomainsTable,
  competitorPagesTable,
  eventsTable,
  type Keyword,
  type Location,
  type BlacklistedDomain,
} from "@workspace/db";
import type { JobData } from "@workspace/jobs";
import { DataForSEOClient } from "@workspace/integrations-dataforseo";
import type { Logger } from "pino";
import { assertNotDuplicate } from "../idempotency";
import { extractOrganicResults, normalizeDomain } from "./serp-utils";

const SUCCESS_EVENT = "seo.competitor.discovered";

/** Only the top N organic results per keyword are recorded as competitors. */
const TOP_N = 10;

/**
 * For a keyword set, pull SERP data and record competitor URLs into
 * `competitor_pages`, excluding the brand's own primary domain and any
 * blacklisted domains. Costs money per keyword — the caller bounds the
 * set (and Phase 7 smoke tests use a single keyword).
 */
export async function handleSeoCompetitorDiscover(
  payload: JobData<"seo.competitor.discover">,
  log: Logger,
): Promise<{ keywords: number; competitorsRecorded: number; duplicate?: true }> {
  const dup = await assertNotDuplicate(
    SUCCESS_EVENT,
    payload.idempotencyKey,
    log,
  );
  if (dup.duplicate) {
    return { keywords: 0, competitorsRecorded: 0, duplicate: true };
  }

  const client = new DataForSEOClient({ brandId: payload.brandId });

  return withBrandScope(payload.brandId, async ({ db, scoped }) => {
    const brandRows = await db
      .select({ primaryDomain: brandsTable.primaryDomain })
      .from(brandsTable)
      .where(eq(brandsTable.id, payload.brandId))
      .limit(1);
    const ownDomain = normalizeDomain(brandRows[0]?.primaryDomain);

    const blacklist = (await scoped.select(
      blacklistedDomainsTable,
    )) as BlacklistedDomain[];
    const blocked = new Set(
      blacklist
        .map((b) => normalizeDomain(b.domain))
        .filter((d): d is string => d != null),
    );

    // Only process keywords that have been deliberately added to a tracked list
    // (list_id IS NOT NULL) and are active. This prevents orphaned/test keywords
    // from consuming paid DataForSEO SERP credits and polluting competitor_pages.
    const qualityFilter = and(
      eq(keywordsTable.isActive, true),
      isNotNull(keywordsTable.listId),
    );
    const keywords = (await scoped.select(keywordsTable, {
      where: payload.keywordIds?.length
        ? and(qualityFilter, inArray(keywordsTable.id, payload.keywordIds))
        : qualityFilter,
    })) as Keyword[];

    const locations = (await scoped.select(locationsTable)) as Location[];
    const locById = new Map(locations.map((l) => [l.id, l]));

    let competitorsRecorded = 0;

    for (const kw of keywords) {
      const loc = locById.get(kw.locationId);
      if (!loc) {
        log.warn(
          { keywordId: kw.id },
          "seo.competitor.discover: no location — skipping keyword",
        );
        continue;
      }

      const res = await client.serpGoogleOrganicLiveAdvanced({
        keyword: kw.keywordText,
        locationCode: loc.dataforseoLocationCode,
        languageCode: loc.languageCode,
      });
      const items = res.tasks[0]?.result?.[0]?.items ?? [];
      const organic = extractOrganicResults(items).slice(0, TOP_N);

      const rows = organic
        .map((r) => ({ domain: normalizeDomain(r.domain ?? r.url), result: r }))
        .filter(
          (x): x is { domain: string; result: (typeof organic)[number] } =>
            x.domain != null &&
            x.domain !== ownDomain &&
            !blocked.has(x.domain),
        )
        .map((x) => ({
          brandId: payload.brandId,
          competitorDomain: x.domain,
          url: x.result.url ?? "",
          keywordId: kw.id,
          position: x.result.organicPosition,
        }));

      if (rows.length > 0) {
        await scoped.insert(competitorPagesTable, rows);
        competitorsRecorded += rows.length;
      }
    }

    await db.insert(eventsTable).values({
      eventType: SUCCESS_EVENT,
      brandId: payload.brandId,
      subjectType: "competitor_discovery",
      subjectId: payload.brandId,
      payload: {
        idempotencyKey: payload.idempotencyKey,
        keywords: keywords.length,
        competitorsRecorded,
      },
    });

    log.info(
      { keywords: keywords.length, competitorsRecorded },
      "seo.competitor.discover: done",
    );
    return { keywords: keywords.length, competitorsRecorded };
  });
}
