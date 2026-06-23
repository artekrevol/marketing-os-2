import { eq, inArray, sql } from "drizzle-orm";
import {
  withBrandScope,
  brandsTable,
  crawlBatchesTable,
  keywordsTable,
  locationsTable,
  rankSnapshotsTable,
  eventsTable,
  type Keyword,
  type Location,
} from "@workspace/db";
import type { JobData } from "@workspace/jobs";
import { DataForSEOClient } from "@workspace/integrations-dataforseo";
import type { Logger } from "pino";
import { assertNotDuplicate } from "../idempotency";
import { extractOrganicResults, findDomainPosition } from "./serp-utils";

const SUCCESS_EVENT = "seo.crawl.completed";

/**
 * Execute one crawl batch: run a SERP query per keyword, compute the
 * brand's true-organic position, and write `rank_snapshots`.
 *
 * Cost safety:
 *   - Handler-level dedup via `assertNotDuplicate` short-circuits an
 *     already-completed batch (DataForSEO calls cost real money).
 *   - Resume-aware: keywords that already have a snapshot for THIS batch
 *     are skipped, so a mid-batch crash + BullMQ retry never re-bills a
 *     keyword that was already crawled.
 */
export async function handleSeoCrawlRun(
  payload: JobData<"seo.crawl.run">,
  log: Logger,
): Promise<{ crawled: number; skipped: number; duplicate?: true }> {
  const dup = await assertNotDuplicate(
    SUCCESS_EVENT,
    payload.idempotencyKey,
    log,
  );
  if (dup.duplicate) return { crawled: 0, skipped: 0, duplicate: true };

  const client = new DataForSEOClient({ brandId: payload.brandId });

  return withBrandScope(payload.brandId, async ({ db, scoped }) => {
    // Brand primary domain — needed to detect the brand's own ranking.
    // `brands` is a system lookup table (not brand-scoped), so read it
    // through the guarded tx db directly.
    const brandRows = await db
      .select({ primaryDomain: brandsTable.primaryDomain })
      .from(brandsTable)
      .where(eq(brandsTable.id, payload.brandId))
      .limit(1);
    const primaryDomain = brandRows[0]?.primaryDomain ?? null;

    await scoped.update(
      crawlBatchesTable,
      { status: "running", startedAt: new Date() },
      eq(crawlBatchesTable.id, payload.batchId),
    );

    // Resolve the keyword set for this batch.
    const keywords = (await scoped.select(keywordsTable, {
      where: payload.keywordIds?.length
        ? inArray(keywordsTable.id, payload.keywordIds)
        : undefined,
    })) as Keyword[];

    // Location lookup (dataforseo location/language codes).
    const locations = (await scoped.select(locationsTable)) as Location[];
    const locById = new Map(locations.map((l) => [l.id, l]));

    // Resume: which keywords already have a snapshot for THIS batch?
    const doneRows = (await db.execute(sql`
      select keyword_id from public.rank_snapshots
      where brand_id = ${payload.brandId}::uuid
        and batch_id = ${payload.batchId}::uuid
    `)) as { rows?: Array<{ keyword_id: string }> } | Array<{ keyword_id: string }>;
    const doneList = Array.isArray(doneRows) ? doneRows : (doneRows.rows ?? []);
    const alreadyDone = new Set(doneList.map((r) => r.keyword_id));

    let crawled = 0;
    let skipped = 0;
    let failed = 0;

    for (const kw of keywords) {
      if (alreadyDone.has(kw.id)) {
        skipped += 1;
        continue;
      }
      const loc = locById.get(kw.locationId);
      if (!loc) {
        log.warn(
          { keywordId: kw.id, locationId: kw.locationId },
          "seo.crawl.run: keyword has no resolvable location — skipping",
        );
        skipped += 1;
        continue;
      }

      try {
        const res = await client.serpGoogleOrganicLiveAdvanced({
          keyword: kw.keywordText,
          locationCode: loc.dataforseoLocationCode,
          languageCode: loc.languageCode,
        });
        const items = res.tasks[0]?.result?.[0]?.items ?? [];
        const organic = extractOrganicResults(items);
        const mine = primaryDomain
          ? findDomainPosition(organic, primaryDomain)
          : null;

        await scoped.insert(rankSnapshotsTable, {
          brandId: payload.brandId,
          keywordId: kw.id,
          locationId: kw.locationId,
          batchId: payload.batchId,
          position: mine?.organicPosition ?? null,
          url: mine?.url ?? null,
          foundAtPosition: mine != null,
          serpFeatures: {
            organicCount: organic.length,
            totalItems: items.length,
            rankAbsolute: mine?.rankAbsolute ?? null,
          },
        });

        await scoped.update(
          keywordsTable,
          { lastCheckedAt: new Date() },
          eq(keywordsTable.id, kw.id),
        );

        crawled += 1;
        await scoped.update(
          crawlBatchesTable,
          { completedCount: sql`completed_count + 1` },
          eq(crawlBatchesTable.id, payload.batchId),
        );
      } catch (err) {
        // A single keyword failure should not fail (and re-bill) the
        // whole batch. Record it, keep going; the batch is marked
        // failed only if EVERY keyword errored.
        failed += 1;
        log.error(
          { err, keywordId: kw.id, keyword: kw.keywordText },
          "seo.crawl.run: keyword crawl failed",
        );
      }
    }

    const allFailed = failed > 0 && crawled === 0 && skipped === 0;
    await scoped.update(
      crawlBatchesTable,
      {
        status: allFailed ? "failed" : "complete",
        finishedAt: new Date(),
        keywordCount: keywords.length,
        errorMessage: failed > 0 ? `${failed} keyword(s) failed` : null,
      },
      eq(crawlBatchesTable.id, payload.batchId),
    );

    await db.insert(eventsTable).values({
      eventType: SUCCESS_EVENT,
      brandId: payload.brandId,
      subjectType: "crawl_batch",
      subjectId: payload.batchId,
      payload: {
        idempotencyKey: payload.idempotencyKey,
        crawled,
        skipped,
        failed,
        keywordCount: keywords.length,
      },
    });

    log.info(
      { batchId: payload.batchId, crawled, skipped, failed },
      "seo.crawl.run: batch finished",
    );
    return { crawled, skipped };
  });
}
