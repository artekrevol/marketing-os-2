/**
 * Recovery War Room — backfill script.
 *
 * For every brand with a locked baseline, enqueue one
 * `scoring.recovery-snapshot` job per day from the brand's
 * `baseline_date` through yesterday (UTC). The worker (which must be
 * running) drains the `scoring` queue and writes the rows.
 *
 * Idempotency: every per-day job uses
 * `recovery-snapshot:<brandId>:<YYYY-MM-DD>` as `idempotencyKey`, so
 *
 *   - BullMQ dedupes within the redis attempt-window
 *     (`enqueue` derives `jobId` from the key).
 *   - The handler short-circuits when a `(brand_id, snapshot_date)`
 *     row already exists in `recovery_snapshots`.
 *
 * Re-running the script after a successful backfill is a no-op.
 *
 * Concurrency: BullMQ workers process the `scoring` queue at
 * `concurrency=8` (`lib/worker/src/index.ts`). The script enforces a
 * separate cap of 50 in-flight `enqueue` calls so we don't pile a
 * 4-brand × ~200-day fanout (~800 enqueue requests) onto Redis as a
 * single burst. The work itself is rate-limited by the worker, not
 * this script.
 *
 * Usage (from repo root):
 *
 *   pnpm --filter @workspace/worker exec tsx \
 *     src/scripts/backfill-recovery-snapshots.ts
 *
 * Optional flags:
 *   --through=YYYY-MM-DD   Override the inclusive end date.
 *                          Defaults to yesterday (UTC).
 *   --dry-run              Print the per-brand date ranges and total
 *                          job count without enqueueing.
 */

import { eq } from "drizzle-orm";
import {
  pool,
  guardedDb,
  withBrandScope,
  brandsTable,
  recoveryBaselinesTable,
  type RecoveryBaseline,
} from "@workspace/db";
import { enqueue, closeAllQueues, closeRedisConnection } from "@workspace/jobs";

const ENQUEUE_CONCURRENCY = 50;

interface CliArgs {
  through: string | null;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let through: string | null = null;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("--through=")) {
      through = arg.slice("--through=".length);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) {
        throw new Error(`--through must be YYYY-MM-DD, got ${through}`);
      }
    }
  }
  return { through, dryRun };
}

function isoDateUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Yesterday (UTC) as YYYY-MM-DD. */
function defaultThrough(): string {
  return isoDateUtc(new Date(Date.now() - 24 * 60 * 60 * 1000));
}

/**
 * Inclusive list of YYYY-MM-DD strings from `start` through `end`.
 * Empty when `end < start`.
 */
function eachDateUtcInclusive(start: string, end: string): string[] {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error(`invalid date range: start=${start} end=${end}`);
  }
  const days: string[] = [];
  for (let t = startMs; t <= endMs; t += 24 * 60 * 60 * 1000) {
    days.push(isoDateUtc(new Date(t)));
  }
  return days;
}

interface BrandPlan {
  brandId: string;
  baselineDate: string;
}

async function loadBrandsWithBaselines(): Promise<BrandPlan[]> {
  // System-side enumeration of the brands lookup table (NOT
  // brand-scoped — it's the tenancy root). Per-brand reads of
  // `recovery_baselines` then happen inside `withBrandScope` so the
  // tenancy guard remains active for every brand-scoped read.
  const brandRows = await guardedDb
    .select({ id: brandsTable.id })
    .from(brandsTable);

  const plans: BrandPlan[] = [];
  for (const { id: brandId } of brandRows) {
    const baselineDate = await withBrandScope(brandId, async ({ scoped }) => {
      const rows = (await scoped.select(recoveryBaselinesTable, {
        where: eq(recoveryBaselinesTable.brandId, brandId),
        limit: 1,
      })) as RecoveryBaseline[];
      return rows[0]?.baselineDate ?? null;
    });
    if (baselineDate != null) {
      plans.push({ brandId, baselineDate });
    }
  }
  plans.sort((a, b) => a.brandId.localeCompare(b.brandId));
  return plans;
}

/**
 * Drain `tasks` with at most `cap` promises in flight at a time.
 * Re-throws the first rejection (we want backfill to fail loudly so
 * the operator can re-run after fixing whatever broke).
 */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  cap: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(cap, tasks.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]!();
    }
  });
  await Promise.all(workers);
  return results;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const through = args.through ?? defaultThrough();

  const brands = await loadBrandsWithBaselines();
  if (brands.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      "[recovery-backfill] No brands with locked baselines found. Run lock-baselines first.",
    );
    return;
  }

  const plans: Array<{ brandId: string; dates: string[] }> = [];
  let totalJobs = 0;
  for (const b of brands) {
    const dates = eachDateUtcInclusive(b.baselineDate, through);
    plans.push({ brandId: b.brandId, dates });
    totalJobs += dates.length;
  }

  // eslint-disable-next-line no-console
  console.log(
    `[recovery-backfill] through=${through} brands=${brands.length} jobs=${totalJobs} concurrency=${ENQUEUE_CONCURRENCY}${args.dryRun ? " (DRY-RUN)" : ""}`,
  );
  for (const p of plans) {
    const first = p.dates[0] ?? "<empty>";
    const last = p.dates[p.dates.length - 1] ?? "<empty>";
    // eslint-disable-next-line no-console
    console.log(
      `[recovery-backfill]   brand=${p.brandId} days=${p.dates.length} range=${first}..${last}`,
    );
  }

  if (args.dryRun) return;

  const tasks: Array<() => Promise<unknown>> = [];
  for (const p of plans) {
    for (const d of p.dates) {
      tasks.push(() =>
        enqueue("scoring.recovery-snapshot", {
          brandId: p.brandId,
          snapshotDate: d,
          idempotencyKey: `recovery-snapshot:${p.brandId}:${d}`,
        }),
      );
    }
  }

  const startedAt = Date.now();
  await runWithConcurrency(tasks, ENQUEUE_CONCURRENCY);
  const elapsedMs = Date.now() - startedAt;

  // eslint-disable-next-line no-console
  console.log(
    `[recovery-backfill] enqueued ${tasks.length} jobs in ${elapsedMs}ms. Worker drains the scoring queue.`,
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[recovery-backfill] fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeAllQueues().catch(() => {});
    await closeRedisConnection().catch(() => {});
    await pool.end().catch(() => {});
  });
