/**
 * Phase 3 — Ahrefs bulk organic-keywords pull + classification for TekRevol.
 *
 * What this script does:
 *  1. Fetches all organic keywords for tekrevol.com via Ahrefs REST v3
 *     (auto-paginated, country=us).
 *  2. Classifies every keyword:
 *       is_branded        — Ahrefs' own is_branded flag (covers all branded
 *                           search queries, not just "tekrevol").
 *       is_high_value_target — top 20% by (sum_traffic × cpc) among
 *                              non-branded keywords.
 *       priority          — derived from position + high-value flag:
 *                             P0: pos 1-3 AND high-value
 *                             P1: pos 1-10 OR high-value (non-branded)
 *                             P2: pos 11-20 (non-branded)
 *                             P3: everything else (branded, pos 21+)
 *       ahrefs_intent_flags — jsonb map from the 4 boolean intent columns.
 *  3. Upserts into keywords table in 500-row chunks:
 *       NEW rows:      trackDaily=false (not yet promoted for daily tracking).
 *       EXISTING rows: ahrefs columns + classification updated; trackDaily
 *                      and list/cluster/corePage fields left untouched.
 *       priority_pre_ahrefs_import = COALESCE(existing_snapshot, existing_priority)
 *                      — captures the pre-import priority on first run only.
 *  4. Reports classification distribution and sample rows per tier.
 *
 * Run:
 *   cd scripts && node_modules/.bin/tsx ./src/ahrefs-phase3-keywords.ts
 *
 * Operational rules:
 *   - BASELINE before run: 11,313 units. Dispatcher to verify delta after.
 *   - Idempotent: safe to re-run; ON CONFLICT update is additive.
 *   - trackDaily stays false for new rows; dispatcher promotes selectively.
 *
 * Key constants (pinned — do not change without dispatcher sign-off):
 *   BRAND_ID   = TekRevol
 *   LOCATION_ID = US / en-US (code 2840)
 */

import { db, keywordsTable } from "@workspace/db";
import { getAhrefsRestClient } from "@workspace/ahrefs";
import { sql } from "drizzle-orm";
import type { AhrefsOrganicKeyword } from "@workspace/ahrefs";

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

const BRAND_ID = "2d10bb54-ba9a-4444-8a18-a262bca9b2bc"; // TekRevol
const LOCATION_ID = "29877408-739e-4e78-b4df-08f252ba51b5"; // US / en-US (code 2840)
const TARGET = "tekrevol.com";
const CHUNK_SIZE = 500;
const DISPATCH_CONTEXT = "bulk_pull_phase_3_organic_keywords";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

type Priority = "P0" | "P1" | "P2" | "P3";

interface ClassifiedKeyword {
  row: AhrefsOrganicKeyword;
  isBranded: boolean;
  isHighValueTarget: boolean;
  priority: Priority;
  intentFlags: Record<string, boolean>;
  score: number;
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

console.log("═══════════════════════════════════════════════════════════════");
console.log("  Phase 3 — Ahrefs organic keywords bulk pull + classification");
console.log(`  Target: ${TARGET}  Brand: ${BRAND_ID}`);
console.log(`  Location: ${LOCATION_ID} (US / en-US / code 2840)`);
console.log("═══════════════════════════════════════════════════════════════\n");

/* ── Step 1: Fetch ─────────────────────────────────────────────────────── */

console.log("▶ Fetching organic keywords from Ahrefs REST v3 ...");
const client = getAhrefsRestClient(BRAND_ID);
const t0 = Date.now();
const rows = await client.getOrganicKeywords(TARGET, {
  country: "us",
  dispatchContext: DISPATCH_CONTEXT,
});
const fetchMs = Date.now() - t0;

console.log(`✓ Fetched ${rows.length} keywords in ${(fetchMs / 1000).toFixed(1)}s\n`);

if (rows.length === 0) {
  console.error("✗ No keywords returned — aborting. Check API key and target.");
  process.exit(1);
}

/* ── Step 2: Classify ──────────────────────────────────────────────────── */

console.log("▶ Classifying keywords ...");

// 2a. Score every row: sum_traffic × cpc (raw Ahrefs units, consistent for
//     percentile comparison; cpc=0 rows score 0 but may still rank on traffic)
const scored = rows.map((r) => ({
  row: r,
  isBranded: r.is_branded === true,
  score: (r.sum_traffic ?? 0) * (r.cpc ?? 0),
  intentFlags: {
    informational: r.is_informational === true,
    commercial: r.is_commercial === true,
    transactional: r.is_transactional === true,
    navigational: r.is_navigational === true,
    branded: r.is_branded === true,
  },
}));

// 2b. Compute 80th-percentile score threshold from non-branded corpus only.
const nonBrandedScores = scored
  .filter((k) => !k.isBranded)
  .map((k) => k.score)
  .sort((a, b) => b - a); // descending

const hvtThresholdIdx = Math.floor(nonBrandedScores.length * 0.20); // top 20%
const hvtThreshold =
  nonBrandedScores.length > 0
    ? (nonBrandedScores[hvtThresholdIdx] ?? 0)
    : 0;

console.log(
  `  Non-branded corpus: ${nonBrandedScores.length} keywords  HVT threshold score: ${hvtThreshold} (top 20%)`,
);

// 2c. Assign is_high_value_target and priority.
const classified: ClassifiedKeyword[] = scored.map((k) => {
  const isHighValueTarget = !k.isBranded && k.score >= hvtThreshold && hvtThreshold > 0;
  const pos = k.row.best_position ?? 999;

  let priority: Priority;
  if (k.isBranded) {
    priority = "P3";
  } else if (pos <= 3 && isHighValueTarget) {
    priority = "P0";
  } else if (pos <= 10 || isHighValueTarget) {
    priority = "P1";
  } else if (pos <= 20) {
    priority = "P2";
  } else {
    priority = "P3";
  }

  return { ...k, isHighValueTarget, priority };
});

/* ── Step 3: Distribution report ──────────────────────────────────────── */

const dist: Record<Priority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
let brandedCount = 0;
let hvtCount = 0;

for (const k of classified) {
  dist[k.priority]++;
  if (k.isBranded) brandedCount++;
  if (k.isHighValueTarget) hvtCount++;
}

console.log("\n  ── Classification distribution ──────────────────────────────");
console.log(`  Total keywords : ${classified.length}`);
console.log(`  Branded (P3↓)  : ${brandedCount} (${pct(brandedCount, classified.length)}%)`);
console.log(`  High-value (HVT): ${hvtCount} (${pct(hvtCount, classified.length)}%)`);
console.log(`  P0 (top 1-3 + HVT) : ${dist.P0}`);
console.log(`  P1 (top 10 or HVT) : ${dist.P1}`);
console.log(`  P2 (pos 11-20)     : ${dist.P2}`);
console.log(`  P3 (branded/21+)   : ${dist.P3}\n`);

// Sample 3 keywords per tier
for (const tier of ["P0", "P1", "P2", "P3"] as Priority[]) {
  const sample = classified.filter((k) => k.priority === tier).slice(0, 3);
  if (sample.length === 0) continue;
  console.log(`  ── ${tier} samples ───────────────────────────────────────────`);
  for (const k of sample) {
    const r = k.row;
    console.log(
      `    pos=${String(r.best_position ?? "–").padStart(4)}  vol=${String(r.volume ?? 0).padStart(7)}  kd=${String(r.keyword_difficulty ?? "–").padStart(3)}  cpc=${String(r.cpc ?? 0).padStart(6)}  hvt=${k.isHighValueTarget ? "Y" : "N"}  branded=${k.isBranded ? "Y" : "N"}  "${r.keyword}"`,
    );
  }
  console.log("");
}

/* ── Step 4: Upsert ────────────────────────────────────────────────────── */

console.log("▶ Upserting into keywords table ...");

const now = new Date();
const chunks = chunk(classified, CHUNK_SIZE);
let inserted = 0;
let updated = 0;
let totalProcessed = 0;

for (let i = 0; i < chunks.length; i++) {
  const c = chunks[i]!;
  process.stdout.write(
    `  Chunk ${i + 1}/${chunks.length} (${c.length} rows) ... `,
  );

  const values = c.map((k) => ({
    brandId: BRAND_ID,
    locationId: LOCATION_ID,
    keywordText: k.row.keyword,
    // Volume and CPC — also write to the existing shared columns
    searchVolume: k.row.volume ?? null,
    cpc: k.row.cpc != null ? String(k.row.cpc) : null,
    // Ahrefs bulk import columns
    ahrefsBestPosition: k.row.best_position ?? null,
    ahrefsKeywordDifficulty:
      k.row.keyword_difficulty != null
        ? String(k.row.keyword_difficulty)
        : null,
    ahrefsSumTraffic: k.row.sum_traffic ?? null,
    ahrefsBestPositionUrl: k.row.best_position_url ?? null,
    ahrefsIntentFlags: k.intentFlags,
    ahrefsCpc: k.row.cpc != null ? String(k.row.cpc) : null,
    ahrefsLastUpdated: now,
    // Classification
    isBranded: k.isBranded,
    isHighValueTarget: k.isHighValueTarget,
    priority: k.priority,
    // Audit trail: null on new rows (no pre-existing priority to snapshot)
    priorityPreAhrefsImport: null as string | null,
    // New rows must NOT have trackDaily=true until promoted
    trackDaily: false,
    // Timestamps
    createdAt: now,
    updatedAt: now,
  }));

  const result = await db
    .insert(keywordsTable)
    .values(values)
    .onConflictDoUpdate({
      target: [
        keywordsTable.brandId,
        keywordsTable.keywordText,
        keywordsTable.locationId,
      ],
      set: {
        // Ahrefs data columns — always refresh
        ahrefsBestPosition: sql`excluded.ahrefs_best_position`,
        ahrefsKeywordDifficulty: sql`excluded.ahrefs_keyword_difficulty`,
        ahrefsSumTraffic: sql`excluded.ahrefs_sum_traffic`,
        ahrefsBestPositionUrl: sql`excluded.ahrefs_best_position_url`,
        ahrefsIntentFlags: sql`excluded.ahrefs_intent_flags`,
        ahrefsCpc: sql`excluded.ahrefs_cpc`,
        ahrefsLastUpdated: sql`excluded.ahrefs_last_updated`,
        // Classification — always refresh from latest pull
        isBranded: sql`excluded.is_branded`,
        isHighValueTarget: sql`excluded.is_high_value_target`,
        priority: sql`excluded.priority`,
        // Snapshot: capture existing priority ONCE; never overwrite once set.
        // COALESCE(current snapshot, current priority) preserves the original
        // pre-import priority on subsequent runs.
        priorityPreAhrefsImport: sql`COALESCE(${keywordsTable.priorityPreAhrefsImport}, ${keywordsTable.priority})`,
        // Shared columns — keep in sync
        searchVolume: sql`excluded.search_volume`,
        cpc: sql`excluded.cpc`,
        // trackDaily: intentionally NOT updated on conflict — existing rows
        // keep their tracking preference (dispatcher promotes selectively).
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: keywordsTable.id });

  // Drizzle .returning() returns all affected rows; we can't distinguish
  // INSERT vs UPDATE from the return value alone, so count total processed.
  totalProcessed += result.length;
  console.log(`✓ ${result.length} rows`);
}

console.log(`\n✓ Upsert complete: ${totalProcessed} rows processed in ${chunks.length} chunks.\n`);

/* ── Step 5: Verify spot-check ─────────────────────────────────────────── */

console.log("▶ Spot-check: reading back 5 P0 keywords from DB ...");
const p0Check = await db.query.keywordsTable.findMany({
  where: (t, { and, eq }) =>
    and(eq(t.brandId, BRAND_ID), eq(t.priority, "P0")),
  orderBy: (t, { asc }) => asc(t.ahrefsBestPosition),
  limit: 5,
});

if (p0Check.length === 0) {
  console.log("  (no P0 keywords found — may be expected if none qualify)");
} else {
  for (const kw of p0Check) {
    console.log(
      `  pos=${String(kw.ahrefsBestPosition ?? "–").padStart(4)}  vol=${String(kw.searchVolume ?? 0).padStart(7)}  hvt=${kw.isHighValueTarget ? "Y" : "N"}  "${kw.keywordText}"`,
    );
  }
}

/* ── Final summary ─────────────────────────────────────────────────────── */

console.log("\n═══════════════════════════════════════════════════════════════");
console.log("  Phase 3 complete.");
console.log(`  Keywords fetched  : ${rows.length}`);
console.log(`  Rows upserted     : ${totalProcessed}`);
console.log(`  P0 / P1 / P2 / P3 : ${dist.P0} / ${dist.P1} / ${dist.P2} / ${dist.P3}`);
console.log(`  Branded           : ${brandedCount}`);
console.log(`  High-value targets: ${hvtCount}`);
console.log("═══════════════════════════════════════════════════════════════\n");
console.log("⏸  Pausing for dispatcher classification distribution review.");
console.log("   Verify distribution above before approving Phase 4.\n");

process.exit(0);

/* -------------------------------------------------------------------------- */
/* Utilities                                                                   */
/* -------------------------------------------------------------------------- */

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function pct(n: number, total: number): string {
  if (total === 0) return "0";
  return ((n / total) * 100).toFixed(1);
}
