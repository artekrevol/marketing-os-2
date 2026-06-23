import { eq } from "drizzle-orm";
import {
  withBrandScope,
  guardedDb,
  brandsTable,
  crawlSchedulesTable,
  type CrawlSchedule,
} from "@workspace/db";
import { registerCrawlSchedule } from "@workspace/jobs";
import type { Logger } from "pino";

/**
 * Boot-time reconciliation: read every active `crawl_schedules` row and
 * (re)register its repeatable `seo.rank-check.scheduled` job. Safe to run
 * on every worker boot — `registerCrawlSchedule` removes any stale
 * repeatable for the schedule id before re-adding, so cron changes that
 * happened while the worker was down are picked up.
 *
 * Runtime changes (create/update/deactivate via the API) are handled by
 * the API calling the same `registerCrawlSchedule`/`removeCrawlSchedule`
 * primitives directly — the BullMQ queue is the shared channel, so no
 * separate event bus is needed.
 */
export async function registerActiveCrawlSchedules(
  log: Logger,
): Promise<{ registered: number }> {
  // `brands` is the (non-scoped) lookup root; per-brand schedule reads
  // then run inside withBrandScope so tenancy stays enforced.
  const brands = await guardedDb
    .select({ id: brandsTable.id })
    .from(brandsTable);

  let registered = 0;
  for (const { id: brandId } of brands) {
    const schedules = await withBrandScope(brandId, async ({ scoped }) => {
      return (await scoped.select(crawlSchedulesTable, {
        where: eq(crawlSchedulesTable.active, true),
      })) as CrawlSchedule[];
    });

    for (const s of schedules) {
      try {
        await registerCrawlSchedule({
          scheduleId: s.id,
          brandId,
          listId: s.listId ?? null,
          cron: s.cronExpression,
        });
        registered += 1;
      } catch (err) {
        log.error(
          { err, scheduleId: s.id, brandId },
          "seo: failed to register crawl schedule",
        );
      }
    }
  }

  log.info({ registered }, "seo: active crawl schedules registered");
  return { registered };
}
