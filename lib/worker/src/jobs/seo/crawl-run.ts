import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
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
import {
  DataForSEOClient,
  type SerpBulkTaskRequest,
} from "@workspace/integrations-dataforseo";
import type { Logger } from "pino";
import { assertNotDuplicate } from "../idempotency";
import { extractOrganicResults, findDomainPosition } from "./serp-utils";

const SUCCESS_EVENT = "seo.crawl.completed";

/**
 * SERP depth per keyword (number of results, billed per 10-result page).
 *
 * TekRevol's observed rank distribution (5,415 snapshots):
 *   P50 = 25, P90 = 57, P95 = 73, max = 118
 *
 * depth=60 captures 90% of rankings at 6 pages × $0.0006 = $0.0036/kw
 * vs depth=100 at $0.0155/kw live/advanced — 77% cost reduction total.
 * Keywords ranked 61–100 (~13% of snapshots) will record "not found".
 * Raise to 80 if deeper coverage becomes a requirement.
 */
const CRAWL_DEPTH = 60;

/** Hard DataForSEO limit: max tasks per task_post call. */
const TASK_POST_BATCH = 100;

/** Milliseconds between tasks_ready polls. */
const POLL_INTERVAL_MS = 15_000;

/**
 * Max poll attempts before abandoning unreturned tasks (~6 min total).
 * Tasks that aren't collected remain in the DataForSEO ready queue for
 * 30 days and can be retried; they do not re-incur a billing charge.
 */
const MAX_POLLS = 24;

/**
 * Execute one crawl batch using the DataForSEO Standard Queue API:
 *   1. Batch POST all keywords → task_post  (billed: $0.0006/SERP)
 *   2. Poll tasks_ready every 15 s          (free)
 *   3. GET each result → task_get/regular   (free)
 *
 * This replaces the old live/advanced approach ($0.0155/kw sequential)
 * with a batch async flow at $0.0036/kw — a 77% cost reduction.
 *
 * Cost safety:
 *   - Handler-level dedup via `assertNotDuplicate` prevents re-billing
 *     an already-completed batch on BullMQ retry.
 *   - Resume-aware: keywords with an existing snapshot for THIS batch
 *     are skipped before any API call is made.
 *   - Tag-based correlation: each task_post request carries tag=kw.id,
 *     echoed in the response, so results are matched without relying on
 *     response ordering.
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
    const brandRows = await db
      .select({ primaryDomain: brandsTable.primaryDomain })
      .from(brandsTable)
      .where(eq(brandsTable.id, payload.brandId))
      .limit(1);
    const primaryDomain = brandRows[0]?.primaryDomain ?? null;

    const batches = await scoped.select(crawlBatchesTable, {
      where: eq(crawlBatchesTable.id, payload.batchId),
      limit: 1,
    });
    if (!batches[0]) {
      throw new Error(`seo.crawl.run: batch not found for brand: ${payload.batchId}`);
    }

    await scoped.update(
      crawlBatchesTable,
      { status: "running", startedAt: new Date() },
      eq(crawlBatchesTable.id, payload.batchId),
    );

    // Only crawl keywords that have been deliberately added to a tracked list
    // (list_id IS NOT NULL) and are active. Orphaned/test keywords must not
    // consume paid DataForSEO Standard Queue tasks or produce rank snapshots.
    const qualityFilter = and(
      eq(keywordsTable.isActive, true),
      isNotNull(keywordsTable.listId),
    );
    if (payload.keywordIds?.length) {
      const requestedIds = new Set(payload.keywordIds);
      const ownedKeywords = (await scoped.select(keywordsTable, {
        where: inArray(keywordsTable.id, payload.keywordIds),
      })) as Keyword[];
      const ownedIds = new Set(ownedKeywords.map((keyword) => keyword.id));
      const missingIds = [...requestedIds].filter((id) => !ownedIds.has(id));
      if (missingIds.length > 0) {
        throw new Error(
          `seo.crawl.run: keyword IDs are missing or outside brand: ${missingIds.join(", ")}`,
        );
      }
    }
    const keywords = (await scoped.select(keywordsTable, {
      where: payload.keywordIds?.length
        ? and(qualityFilter, inArray(keywordsTable.id, payload.keywordIds))
        : qualityFilter,
    })) as Keyword[];

    const locations = (await scoped.select(locationsTable)) as Location[];
    const locById = new Map(locations.map((l) => [l.id, l]));

    // Resume: skip keywords that already have a snapshot for this batch.
    const doneRows = (await db.execute(sql`
      select keyword_id from public.rank_snapshots
      where brand_id = ${payload.brandId}::uuid
        and batch_id = ${payload.batchId}::uuid
    `)) as { rows?: Array<{ keyword_id: string }> } | Array<{ keyword_id: string }>;
    const doneList = Array.isArray(doneRows) ? doneRows : (doneRows.rows ?? []);
    const alreadyDone = new Set(doneList.map((r) => r.keyword_id));

    const pending = keywords.filter((kw) => !alreadyDone.has(kw.id));

    let crawled = 0;
    let skipped = alreadyDone.size; // already-done count as skipped
    let failed = 0;

    if (pending.length === 0) {
      log.info(
        { batchId: payload.batchId },
        "seo.crawl.run: all keywords already crawled — nothing to post",
      );
    } else {
      // ----------------------------------------------------------------
      // Phase 1: POST all pending keywords in batches of 100.
      // DataForSEO queues them for async processing (Standard Queue).
      // Billing happens here; task_get is free.
      // ----------------------------------------------------------------
      /** taskId → Keyword, built from task_post responses. */
      const taskToKw = new Map<string, Keyword>();

      for (let i = 0; i < pending.length; i += TASK_POST_BATCH) {
        const batch = pending.slice(i, i + TASK_POST_BATCH);

        const requests: SerpBulkTaskRequest[] = [];
        const kwById = new Map<string, Keyword>();

        for (const kw of batch) {
          const loc = locById.get(kw.locationId);
          if (!loc) {
            log.warn(
              { keywordId: kw.id, locationId: kw.locationId },
              "seo.crawl.run: keyword has no resolvable location — skipped",
            );
            skipped++;
            continue;
          }
          requests.push({
            keyword: kw.keywordText,
            locationCode: loc.dataforseoLocationCode,
            languageCode: loc.languageCode,
            depth: CRAWL_DEPTH,
            tag: kw.id, // echoed in task_post response for correlation
          });
          kwById.set(kw.id, kw);
        }

        if (requests.length === 0) continue;

        try {
          const posted = await client.serpGoogleOrganicTaskPost(requests);
          for (const { taskId, tag } of posted) {
            const kw = tag ? kwById.get(tag) : undefined;
            if (kw) {
              taskToKw.set(taskId, kw);
            } else {
              log.warn(
                { taskId, tag },
                "seo.crawl.run: task_post returned unknown tag — cannot correlate",
              );
            }
          }
          log.info(
            { batchStart: i, posted: posted.length },
            "seo.crawl.run: tasks posted to Standard Queue",
          );
        } catch (err) {
          // A billing failure (40200) throws non-retriable here. Bail.
          log.error(
            { err, batchStart: i, count: requests.length },
            "seo.crawl.run: task_post batch failed — stopping",
          );
          failed += requests.length;
          break;
        }
      }

      log.info(
        { queued: taskToKw.size, pending: pending.length },
        "seo.crawl.run: all batches posted — starting poll loop",
      );

      // ----------------------------------------------------------------
      // Phase 2 + 3: Poll tasks_ready, GET each result as it completes.
      // tasks_ready is account-wide; filter to this batch's task IDs.
      // ----------------------------------------------------------------
      const collected = new Set<string>(); // taskIds fetched this run

      for (
        let poll = 0;
        poll < MAX_POLLS && collected.size < taskToKw.size;
        poll++
      ) {
        if (poll > 0) await sleep(POLL_INTERVAL_MS);

        let readyItems: Awaited<
          ReturnType<typeof client.serpGoogleOrganicTasksReady>
        >;
        try {
          readyItems = await client.serpGoogleOrganicTasksReady();
        } catch (err) {
          log.warn(
            { err, poll },
            "seo.crawl.run: tasks_ready poll failed — will retry next tick",
          );
          continue;
        }

        // Only process tasks from this batch; ignore stale account-wide tasks.
        const ours = readyItems.filter(
          (item) => taskToKw.has(item.id) && !collected.has(item.id),
        );

        log.info(
          {
            poll: poll + 1,
            accountReady: readyItems.length,
            ourReady: ours.length,
            collected: collected.size,
            total: taskToKw.size,
          },
          "seo.crawl.run: poll tick",
        );

        for (const item of ours) {
          if (!item.endpoint_regular) {
            log.warn(
              { taskId: item.id },
              "seo.crawl.run: ready task has no endpoint_regular — skipping",
            );
            collected.add(item.id);
            skipped++;
            continue;
          }

          const kw = taskToKw.get(item.id)!;

          try {
            const res = await client.serpGoogleOrganicTaskGetRegular(
              item.endpoint_regular,
            );
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

            crawled++;
            collected.add(item.id);

            await scoped.update(
              crawlBatchesTable,
              { completedCount: sql`completed_count + 1` },
              eq(crawlBatchesTable.id, payload.batchId),
            );
          } catch (err) {
            log.error(
              { err, keywordId: kw.id, keyword: kw.keywordText },
              "seo.crawl.run: task_get/regular failed",
            );
            failed++;
            collected.add(item.id); // don't retry within this run
          }
        }
      }

      const timedOut = taskToKw.size - collected.size;
      if (timedOut > 0) {
        log.warn(
          { timedOut, maxPolls: MAX_POLLS, pollWindowMs: MAX_POLLS * POLL_INTERVAL_MS },
          "seo.crawl.run: tasks still pending after poll window — they remain " +
            "in the DataForSEO ready queue (no re-billing) and will appear on " +
            "the next tasks_ready call",
        );
        skipped += timedOut;
      }
    }

    const allFailed =
      failed > 0 && crawled === 0 && skipped <= alreadyDone.size;
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
        mode: "standard_queue",
        depth: CRAWL_DEPTH,
      },
    });

    log.info(
      { batchId: payload.batchId, crawled, skipped, failed },
      "seo.crawl.run: batch finished",
    );
    return { crawled, skipped };
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
