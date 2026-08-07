/**
 * Manual discovery job trigger — run once against a real brand to verify
 * the handler end-to-end without BullMQ scheduling.
 *
 * Usage (from workspace root):
 *   pnpm --filter @workspace/worker exec tsx src/test/manual-discovery-run.ts
 *
 * Environment required: DATABASE_URL, DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD
 * Optional:             DISCOVERY_KD_FILTER_MAX (overrides default 70)
 */
import pino from "pino";
import { handleSeoDiscoveryWeekly, isoWeekLabel } from "../jobs/seo/discovery-weekly.js";

const log = pino({
  level: "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
});

const BRAND_ID = "2d10bb54-ba9a-4444-8a18-a262bca9b2bc"; // TekRevol
const WEEK = isoWeekLabel(new Date());
// Use a test-suffixed idempotency key so this run doesn't block the real Monday schedule.
const IDEM_KEY = `seo-discovery-weekly:${BRAND_ID}-${WEEK}-manual-v2`;

log.info({ brandId: BRAND_ID, week: WEEK, idempotencyKey: IDEM_KEY }, "manual-discovery-run: starting");

const started = Date.now();

try {
  const result = await handleSeoDiscoveryWeekly(
    {
      brandId: BRAND_ID,
      weekLabel: WEEK,
      maxKd: 70,
      seedLimit: 20,
      relatedLimit: 500,
      competitorRankedLimit: 200,
      idempotencyKey: IDEM_KEY,
    },
    log,
  );

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  log.info(
    {
      elapsed_s: elapsed,
      ...result,
    },
    "manual-discovery-run: complete",
  );

  // Human-readable summary for the dispatcher report
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  MANUAL DISCOVERY RUN SUMMARY");
  console.log("═══════════════════════════════════════════════════════════");
  if (result.duplicate) {
    console.log("  Status: DUPLICATE (idempotency guard fired — already ran this week)");
  } else {
    console.log(`  Status:            COMPLETED`);
    console.log(`  Week:              ${result.weekLabel}`);
    console.log(`  Seeds expanded:    ${result.seedsExpanded}`);
    console.log(`  Raw candidates:    ${result.rawCandidates} (from related-keyword expansion)`);
    console.log(`  After KD filter:   ${result.afterKdFilter}`);
    console.log(`  After dedup:       ${result.afterExistingFilter} (new, not yet tracked)`);
    console.log(`  Inserted (related):    ${result.insertedCandidates}`);
    console.log(`  Inserted (competitor): ${result.competitorCandidatesInserted}`);
    console.log(`  Movements written:     ${result.competitorMovementsWritten}`);
    console.log(`  Auto-archived stale:   ${result.archivedStale}`);
    console.log("─────────────────────────────────────────────────────────");
    const s = result.kdFilterStats;
    console.log("  KD Filter Stats:");
    console.log(`    Threshold:          ${s.threshold}`);
    console.log(`    Before (total):     ${s.candidatesBeforeKdFilter}`);
    console.log(`    After  (total):     ${s.candidatesAfterKdFilter}`);
    console.log(`    Dropped (related):  ${s.droppedRelatedKeywordsStep}`);
    console.log(`    Dropped (compet.):  ${s.droppedCompetitorMiningStep}`);
    console.log(`    Drop rate:          ${s.dropRatePct}%${s.dropRatePct > 40 ? " ⚠ HIGH" : ""}`);
    console.log(`  Elapsed:            ${elapsed}s`);
  }
  console.log("═══════════════════════════════════════════════════════════\n");
} catch (err) {
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  log.error({ err, elapsed_s: elapsed }, "manual-discovery-run: FAILED");
  console.error("\n❌ DISCOVERY RUN FAILED:", (err as Error).message);
  process.exit(1);
}
