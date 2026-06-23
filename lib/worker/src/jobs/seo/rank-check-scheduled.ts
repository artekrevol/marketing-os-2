import { eq } from "drizzle-orm";
import {
  withBrandScope,
  crawlBatchesTable,
  crawlSchedulesTable,
  keywordsTable,
  type Keyword,
} from "@workspace/db";
import { enqueue, type JobData } from "@workspace/jobs";
import type { Logger } from "pino";

/**
 * Fired by a `crawl_schedules` repeatable (one per active schedule).
 * Resolves the schedule's keyword set, creates a fresh `crawl_batches`
 * row, and enqueues a `seo.crawl.run` to do the (paid) SERP work.
 *
 * Each cron tick mints a new batch with a unique id, so the downstream
 * `seo.crawl.run` idempotency key (`seo-crawl:<batchId>`) is unique per
 * tick — re-firing the same minute is deduped by BullMQ's repeatable
 * key, and the crawl itself is resume-safe.
 */
export async function handleSeoRankCheckScheduled(
  payload: JobData<"seo.rank-check.scheduled">,
  log: Logger,
): Promise<{ enqueued: false } | { enqueued: true; batchId: string; keywords: number }> {
  const listId = payload.listId ?? null;

  const prepared = await withBrandScope(payload.brandId, async ({ scoped }) => {
    const keywords = (await scoped.select(keywordsTable, {
      where: listId ? eq(keywordsTable.listId, listId) : undefined,
    })) as Keyword[];

    if (keywords.length === 0) {
      return null;
    }

    const inserted = (await scoped.insert(
      crawlBatchesTable,
      {
        brandId: payload.brandId,
        status: "pending",
        keywordCount: keywords.length,
      },
      { returning: true },
    )) as Array<{ id: string }>;
    const batchId = inserted[0]?.id;

    // Stamp last_run_at so the UI/schedule list reflects the tick.
    await scoped.update(
      crawlSchedulesTable,
      { lastRunAt: new Date() },
      eq(crawlSchedulesTable.id, payload.scheduleId),
    );

    return { batchId, keywordIds: keywords.map((k) => k.id) };
  });

  if (!prepared || !prepared.batchId) {
    log.info(
      { scheduleId: payload.scheduleId, listId },
      "seo.rank-check.scheduled: no keywords for schedule — nothing to crawl",
    );
    return { enqueued: false };
  }

  await enqueue("seo.crawl.run", {
    brandId: payload.brandId,
    batchId: prepared.batchId,
    keywordIds: prepared.keywordIds,
    idempotencyKey: `seo-crawl:${prepared.batchId}`,
  });

  log.info(
    {
      scheduleId: payload.scheduleId,
      batchId: prepared.batchId,
      keywords: prepared.keywordIds.length,
    },
    "seo.rank-check.scheduled: enqueued crawl",
  );
  return {
    enqueued: true,
    batchId: prepared.batchId,
    keywords: prepared.keywordIds.length,
  };
}
