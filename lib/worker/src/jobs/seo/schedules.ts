import { eq } from "drizzle-orm";
import {
  withBrandScope,
  guardedDb,
  brandsTable,
  crawlSchedulesTable,
  type CrawlSchedule,
} from "@workspace/db";
import { registerCrawlSchedule, addRepeatable } from "@workspace/jobs";
import type { Logger } from "pino";

/**
 * Register the weekly Discovery Engine repeatable for a brand.
 * Fires every Monday at 02:00 UTC ("0 2 * * 1").
 *
 * The idempotencyKey encodes brand + a fixed "weekly" segment so BullMQ
 * dedupes re-registrations on every boot. The week label is intentionally
 * NOT embedded in the repeatable payload — it is computed at runtime by
 * the handler from `new Date()`, so a missed Monday run that fires on
 * Tuesday still records the correct ISO week.
 *
 * `addRepeatable` is idempotent (BullMQ keys by name+pattern+jobId), so
 * calling this on every worker boot is safe.
 */
export async function registerDiscoveryWeeklySchedule(
  brandId: string,
  log: Logger,
): Promise<void> {
  try {
    await addRepeatable(
      "integrations",
      "seo.discovery.weekly",
      {
        brandId,
        idempotencyKey: `${brandId}-weekly`,
        maxKd: 70,
        seedLimit: 20,
        relatedLimit: 500,
        competitorRankedLimit: 200,
      },
      "0 2 * * 1", // Monday 02:00 UTC
    );
    log.info({ brandId }, "seo: discovery weekly schedule registered");
  } catch (err) {
    log.error({ err, brandId }, "seo: failed to register discovery weekly schedule");
  }
}

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
