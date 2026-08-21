/**
 * Resumable production GSC backfill.
 *
 * Usage:
 *   pnpm --filter @workspace/worker run gsc:backfill -- \
 *     <brandId> <dateFrom:YYYY-MM-DD> <dateTo:YYYY-MM-DD>
 *
 * The runner creates one normal GSC sync log per calendar-month chunk. A
 * completed chunk is skipped on rerun; an errored or interrupted chunk is
 * retried. Production is required unless GSC_BACKFILL_ALLOW_NON_PRODUCTION is
 * explicitly set for local smoke tests.
 */
import { sql } from "drizzle-orm";
import { closeDb, guardedDb } from "@workspace/db";
import type { JobData } from "@workspace/jobs";
import { handleSeoSyncGscData } from "./jobs/seo/sync-gsc.js";
import { logger } from "./logger.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type DateRange = { from: string; to: string };

function parseArgs(): { brandId: string; range: DateRange } {
  const [, , brandArg, fromArg, toArg] = process.argv;
  const brandId = brandArg ?? process.env["GSC_BACKFILL_BRAND_ID"];
  const from = fromArg ?? process.env["GSC_BACKFILL_FROM"];
  const to = toArg ?? process.env["GSC_BACKFILL_TO"];
  if (!brandId || !UUID_RE.test(brandId)) {
    throw new Error("Usage: gsc:backfill <brandId UUID> <dateFrom YYYY-MM-DD> <dateTo YYYY-MM-DD>");
  }
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    throw new Error("dateFrom and dateTo are required in YYYY-MM-DD format");
  }
  if (from > to) throw new Error("dateFrom must be on or before dateTo");
  return { brandId, range: { from, to } };
}

function monthChunks(range: DateRange): DateRange[] {
  const chunks: DateRange[] = [];
  const cursor = new Date(`${range.from}T00:00:00.000Z`);
  const end = new Date(`${range.to}T00:00:00.000Z`);
  while (cursor <= end) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const chunkTo = monthEnd < end ? monthEnd : end;
    chunks.push({
      from: cursor.toISOString().slice(0, 10),
      to: chunkTo.toISOString().slice(0, 10),
    });
    cursor.setUTCDate(chunkTo.getUTCDate() + 1);
  }
  return chunks;
}

async function isCompleted(brandId: string, range: DateRange): Promise<boolean> {
  const result = (await guardedDb.execute(sql`
    SELECT 1
    FROM gsc_sync_log
    WHERE brand_id = ${brandId}::uuid
      AND status = 'done'
      AND date_from = ${range.from}::date
      AND date_to = ${range.to}::date
    LIMIT 1
  `)) as unknown as { rows?: Array<{ "?column?": number }> } | Array<{ "?column?": number }>;
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  return rows.length > 0;
}

async function run(): Promise<void> {
  const { brandId, range } = parseArgs();
  if (
    process.env["NODE_ENV"] !== "production" &&
    process.env["GSC_BACKFILL_ALLOW_NON_PRODUCTION"] !== "true"
  ) {
    throw new Error("GSC backfill is production-only; set NODE_ENV=production to run it");
  }

  const chunks = monthChunks(range);
  logger.info({ brandId, range, chunks: chunks.length }, "gsc-backfill: starting");
  let skipped = 0;
  let completed = 0;
  let queryRows = 0;
  let pageRows = 0;

  for (const chunk of chunks) {
    if (await isCompleted(brandId, chunk)) {
      skipped += 1;
      logger.info({ brandId, ...chunk }, "gsc-backfill: chunk already complete");
      continue;
    }

    const result = await handleSeoSyncGscData(
      {
        brandId,
        dateFrom: chunk.from,
        dateTo: chunk.to,
        idempotencyKey: `gsc-backfill:${brandId}-${chunk.from}`,
      } as JobData<"seo.sync-gsc-data">,
      logger,
    );
    completed += 1;
    queryRows += result.queryRowsUpserted;
    pageRows += result.pageRowsUpserted;
    logger.info({ brandId, ...chunk, ...result }, "gsc-backfill: chunk complete");
  }

  logger.info(
    { brandId, range, chunks: chunks.length, completed, skipped, queryRows, pageRows },
    "gsc-backfill: complete",
  );
}

run()
  .catch((error) => {
    logger.error({ err: error }, "gsc-backfill: failed");
    process.exitCode = 1;
  })
  .finally(() => closeDb().catch(() => undefined));