/**
 * Recovery War Room — Prompt 3 seed script.
 *
 * Locks the pre-October 2025 baseline for TekRevol, Reverto,
 * ClaimShield, and CensusFlow. Two-phase by design:
 *
 *   1. DRY-RUN (default): compute the baseline values from
 *      `rank_snapshots`, write NOTHING to the database, and rewrite
 *      `docs/recovery-baseline-dry-run.md`. Operator (Abeer) reviews.
 *
 *   2. LIVE: pass `--confirm` to flip on the actual `lockBaseline`
 *      action. Each call writes `recovery_baselines` + `audit_log` +
 *      `events` (per the service contract) and overwrites
 *      `docs/recovery-baselines.md` with the locked values.
 *
 * Idempotent: re-running after a successful live lock prints
 * `"already locked"` per brand and exits 0. Per amendments §D.2 the
 * GSC and GA4 fields are intentionally written NULL — the dry-run
 * report carries the explicit operator-facing callout.
 *
 * Usage (from repo root):
 *
 *   pnpm --filter @workspace/services-recovery run lock-baselines
 *   pnpm --filter @workspace/services-recovery run lock-baselines -- --confirm
 *
 * Optional flags:
 *   --locked-by=<uuid>     Override the `locked_by` user_profiles.user_id.
 *                          Defaults to the first admin in user_profiles.
 *   --baseline-date=YYYY-MM-DD
 *                          Override the requested baseline date for ALL
 *                          brands. Defaults to 2025-09-30.
 */

import { sql } from "drizzle-orm";
import { pool, db } from "@workspace/db";
import {
  computeRankingsBaseline,
  findEarliestSnapshotDate,
} from "../src/lib/compute-rankings-baseline";
import { lockBaseline } from "../src/actions/lock-baseline";
import {
  BaselineAlreadyLockedError,
  InsufficientRankingsDataError,
} from "../src/errors";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Per-brand parameters (pack Prompt 3 + amendments §D).
// `nameMatchers` is the case-insensitive list of acceptable values for
// `brands.name` OR `brands.slug` — matches whatever Sprint-1 seeding chose.
// ---------------------------------------------------------------------------
const DEFAULT_BASELINE_DATE = "2025-09-30";

interface BrandPlan {
  key: string;
  nameMatchers: ReadonlyArray<string>;
  baselineDate: string;
  recoveryThresholdPct: number;
  recoveryConsecutiveDays: number;
  notes: string;
  /**
   * If true, the script will fall back to the brand's earliest available
   * `rank_snapshots.snapshot_date` when the requested `baselineDate`
   * window contains no rows ("limited pre-launch data" per pack
   * Prompt 3).
   */
  fallbackToEarliestAvailable: boolean;
}

const BRAND_PLANS: ReadonlyArray<BrandPlan> = [
  {
    key: "TekRevol",
    nameMatchers: ["tekrevol", "tek-revol"],
    baselineDate: DEFAULT_BASELINE_DATE,
    recoveryThresholdPct: 100,
    recoveryConsecutiveDays: 60,
    notes: "Initial lock — pre-content-overhaul baseline",
    fallbackToEarliestAvailable: false,
  },
  {
    key: "Reverto",
    nameMatchers: ["reverto"],
    baselineDate: DEFAULT_BASELINE_DATE,
    recoveryThresholdPct: 100,
    recoveryConsecutiveDays: 60,
    notes: "Initial lock",
    fallbackToEarliestAvailable: false,
  },
  {
    key: "ClaimShield",
    nameMatchers: ["claimshield", "claim-shield"],
    baselineDate: DEFAULT_BASELINE_DATE,
    recoveryThresholdPct: 100,
    recoveryConsecutiveDays: 60,
    notes: "Initial lock — limited pre-launch data",
    fallbackToEarliestAvailable: true,
  },
  {
    key: "CensusFlow",
    nameMatchers: ["censusflow", "census-flow"],
    baselineDate: DEFAULT_BASELINE_DATE,
    recoveryThresholdPct: 100,
    recoveryConsecutiveDays: 60,
    notes: "Initial lock — limited pre-launch data",
    fallbackToEarliestAvailable: true,
  },
];

// Literal lines required by amendments §D.3. Any change here must be
// kept in lockstep with the amendments doc — the dry-run report exists
// to give Abeer this exact context.
const NULL_CALLOUT_LINES = [
  "GSC: not yet ingested — NULL expected. Recovery story uses rankings until GSC ships.",
  "GA4: not yet ingested — NULL expected.",
] as const;

// ---------------------------------------------------------------------------
// CLI parsing (tiny — keep zero dependencies for the script).
// ---------------------------------------------------------------------------
interface CliArgs {
  confirm: boolean;
  lockedBy: string | null;
  baselineDateOverride: string | null;
}

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  let confirm = false;
  let lockedBy: string | null = null;
  let baselineDateOverride: string | null = null;
  for (const arg of argv) {
    if (arg === "--confirm") confirm = true;
    else if (arg.startsWith("--locked-by=")) lockedBy = arg.slice("--locked-by=".length);
    else if (arg.startsWith("--baseline-date=")) {
      baselineDateOverride = arg.slice("--baseline-date=".length);
    }
  }
  return { confirm, lockedBy, baselineDateOverride };
}

// ---------------------------------------------------------------------------
// Brand resolution.
// ---------------------------------------------------------------------------
interface ResolvedBrand {
  plan: BrandPlan;
  brandId: string;
  brandName: string;
  brandSlug: string;
}

async function resolveBrand(
  plan: BrandPlan,
): Promise<ResolvedBrand | { plan: BrandPlan; missing: true }> {
  const result = (await db.execute(sql`
    select id, slug, name from public.brands
    where lower(name) = any(${plan.nameMatchers as unknown as string[]}::text[])
       or lower(slug) = any(${plan.nameMatchers as unknown as string[]}::text[])
    limit 1
  `)) as
    | { rows?: Array<{ id: string; slug: string; name: string }> }
    | Array<{ id: string; slug: string; name: string }>;
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  const row = rows[0];
  if (!row) return { plan, missing: true };
  return { plan, brandId: row.id, brandName: row.name, brandSlug: row.slug };
}

async function pickDefaultLockedBy(): Promise<string> {
  const result = (await db.execute(sql`
    select user_id from public.user_profiles
    where role = 'admin'::public.app_user_role
    order by created_at asc
    limit 1
  `)) as { rows?: Array<{ user_id: string }> } | Array<{ user_id: string }>;
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  if (!rows[0]) {
    throw new Error(
      "lock-baselines: no admin found in user_profiles; pass --locked-by=<uuid> explicitly",
    );
  }
  return rows[0].user_id;
}

// ---------------------------------------------------------------------------
// Dry-run computation per brand.
// ---------------------------------------------------------------------------
type DryRunOutcome =
  | {
      kind: "ok";
      effectiveBaselineDate: string;
      avgPosition: number;
      keywordsInTop10: number;
      keywordsInTop3: number;
      keywordCount: number;
      fellBackToEarliest: boolean;
    }
  | { kind: "no_data"; attemptedDate: string }
  | { kind: "brand_missing" };

async function dryRunBrand(
  resolved: ResolvedBrand | { plan: BrandPlan; missing: true },
  baselineDateOverride: string | null,
): Promise<DryRunOutcome> {
  if ("missing" in resolved) return { kind: "brand_missing" };
  const requestedDate = baselineDateOverride ?? resolved.plan.baselineDate;
  try {
    const r = await computeRankingsBaseline(db, resolved.brandId, requestedDate);
    return {
      kind: "ok",
      effectiveBaselineDate: requestedDate,
      avgPosition: r.avgPosition,
      keywordsInTop10: r.keywordsInTop10,
      keywordsInTop3: r.keywordsInTop3,
      keywordCount: r.keywordCount,
      fellBackToEarliest: false,
    };
  } catch (err) {
    if (!(err instanceof InsufficientRankingsDataError)) throw err;
    if (!resolved.plan.fallbackToEarliestAvailable) {
      return { kind: "no_data", attemptedDate: requestedDate };
    }
    const earliest = await findEarliestSnapshotDate(db, resolved.brandId);
    if (!earliest) return { kind: "no_data", attemptedDate: requestedDate };
    // The earliest-available row is single-day data; the 30-day window
    // ending on that date is sparse but still the best we can do.
    const r = await computeRankingsBaseline(db, resolved.brandId, earliest);
    return {
      kind: "ok",
      effectiveBaselineDate: earliest,
      avgPosition: r.avgPosition,
      keywordsInTop10: r.keywordsInTop10,
      keywordsInTop3: r.keywordsInTop3,
      keywordCount: r.keywordCount,
      fellBackToEarliest: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Doc rendering (markdown).
// ---------------------------------------------------------------------------
function fmtNum(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function renderDryRunDoc(
  rows: ReadonlyArray<{
    plan: BrandPlan;
    resolved: ResolvedBrand | { plan: BrandPlan; missing: true };
    outcome: DryRunOutcome;
  }>,
  args: { baselineDateOverride: string | null; lockedBy: string },
): string {
  const lines: string[] = [];
  lines.push("# Recovery Baseline Dry-Run");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Default baseline_date: ${args.baselineDateOverride ?? DEFAULT_BASELINE_DATE}`);
  lines.push(`Will be locked_by: ${args.lockedBy}`);
  lines.push("");
  lines.push("## Methodology");
  lines.push("");
  lines.push(
    "Per `.local/recovery-pack-amendments.md` §D.2: distinct-on-keyword over the 30-day window ending on `baseline_date`, mean position across keywords, top-10/top-3 counts. GSC and GA4 fields write NULL.",
  );
  lines.push("");
  lines.push("## Per-brand callout");
  lines.push("");
  lines.push("The following lines apply to every brand below:");
  lines.push("");
  for (const line of NULL_CALLOUT_LINES) lines.push(`> ${line}`);
  lines.push("");
  lines.push("## Computed values (NOT YET WRITTEN)");
  lines.push("");
  lines.push(
    "| Brand | Effective Date | Daily Clicks | Daily Sessions | Avg Position | Top 10 | Top 3 | Keywords | Notes |",
  );
  lines.push(
    "|---|---|---|---|---|---|---|---|---|",
  );
  for (const { plan, resolved, outcome } of rows) {
    const brandLabel =
      "missing" in resolved ? `${plan.key} (NOT FOUND)` : resolved.brandName;
    if (outcome.kind === "brand_missing") {
      lines.push(
        `| ${brandLabel} | — | — | — | — | — | — | — | brand missing from \`brands\` table; skipped |`,
      );
      continue;
    }
    if (outcome.kind === "no_data") {
      lines.push(
        `| ${brandLabel} | ${outcome.attemptedDate} | NULL (pending GSC) | NULL (pending GA4) | — | — | — | 0 | no rank_snapshots — script will skip on \`--confirm\` |`,
      );
      continue;
    }
    const fellBack = outcome.fellBackToEarliest
      ? ` (fell back from ${plan.baselineDate})`
      : "";
    lines.push(
      `| ${brandLabel} | ${outcome.effectiveBaselineDate}${fellBack} | NULL (pending GSC) | NULL (pending GA4) | ${fmtNum(outcome.avgPosition, 2)} | ${outcome.keywordsInTop10} | ${outcome.keywordsInTop3} | ${outcome.keywordCount} | ${plan.notes} |`,
    );
  }
  lines.push("");
  lines.push("## How to lock");
  lines.push("");
  lines.push(
    "After Abeer reviews the values above, re-run with `--confirm` to perform the live insert:",
  );
  lines.push("");
  lines.push("```");
  lines.push(
    "pnpm --filter @workspace/services-recovery run lock-baselines -- --confirm",
  );
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

interface LiveRow {
  plan: BrandPlan;
  brand: ResolvedBrand;
  outcome:
    | {
        kind: "locked";
        baselineDate: string;
        avgPosition: number;
        keywordsInTop10: number;
        keywordsInTop3: number;
      }
    | { kind: "already_locked"; baselineDate: string }
    | { kind: "no_data" }
    | { kind: "error"; message: string };
}

function renderLockedDoc(rows: ReadonlyArray<LiveRow>, lockedBy: string): string {
  const lines: string[] = [];
  lines.push("# Recovery Baselines — Locked");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Locked by user_profile: ${lockedBy}`);
  lines.push("");
  for (const line of NULL_CALLOUT_LINES) lines.push(`> ${line}`);
  lines.push("");
  lines.push(
    "| Brand | Date | Daily Clicks | Daily Sessions | Avg Position | Top 10 | Top 3 | Locked By | Status |",
  );
  lines.push(
    "|---|---|---|---|---|---|---|---|---|",
  );
  for (const { plan, brand, outcome } of rows) {
    if (outcome.kind === "locked") {
      lines.push(
        `| ${brand.brandName} | ${outcome.baselineDate} | NULL | NULL | ${fmtNum(outcome.avgPosition, 2)} | ${outcome.keywordsInTop10} | ${outcome.keywordsInTop3} | ${lockedBy} | locked |`,
      );
    } else if (outcome.kind === "already_locked") {
      lines.push(
        `| ${brand.brandName} | ${outcome.baselineDate} | (existing) | (existing) | (existing) | (existing) | (existing) | ${lockedBy} | already_locked |`,
      );
    } else if (outcome.kind === "no_data") {
      lines.push(
        `| ${brand.brandName} | — | — | — | — | — | — | ${lockedBy} | no_rank_snapshots — skipped |`,
      );
    } else {
      lines.push(
        `| ${brand.brandName} | — | — | — | — | — | — | ${lockedBy} | error: ${outcome.message} |`,
      );
    }
    void plan;
  }
  lines.push("");
  return lines.join("\n");
}

function writeDoc(relPath: string, content: string): void {
  const abs = resolve(process.cwd(), relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const lockedBy = args.lockedBy ?? (await pickDefaultLockedBy());

  // Resolve all four brands up front so the dry-run report flags
  // missing brands instead of throwing partway through.
  const resolved = await Promise.all(BRAND_PLANS.map((p) => resolveBrand(p)));

  const dryRunRows = await Promise.all(
    resolved.map(async (r) => {
      const plan = "missing" in r ? r.plan : r.plan;
      const outcome = await dryRunBrand(r, args.baselineDateOverride);
      return { plan, resolved: r, outcome };
    }),
  );

  const dryRunMd = renderDryRunDoc(dryRunRows, {
    baselineDateOverride: args.baselineDateOverride,
    lockedBy,
  });
  writeDoc("docs/recovery-baseline-dry-run.md", dryRunMd);
  console.log("✓ wrote docs/recovery-baseline-dry-run.md");

  if (!args.confirm) {
    console.log("");
    console.log("DRY RUN — no rows written. Review the report above, then re-run with --confirm.");
    return;
  }

  // Live phase. Iterate sequentially — each lockBaseline runs in its
  // own transaction, and ordered output makes the operator log
  // easier to read than a Promise.all race.
  console.log("");
  console.log("LIVE — running lockBaseline for each brand...");
  const liveRows: LiveRow[] = [];
  for (const row of dryRunRows) {
    if ("missing" in row.resolved) {
      console.log(`  ${row.plan.key}: BRAND NOT FOUND — skipping`);
      continue;
    }
    const brand = row.resolved;
    if (row.outcome.kind === "no_data") {
      console.log(`  ${brand.brandName}: no rank_snapshots — skipping`);
      liveRows.push({ plan: row.plan, brand, outcome: { kind: "no_data" } });
      continue;
    }
    if (row.outcome.kind === "brand_missing") {
      // Already handled above, but keeps the union exhaustive.
      continue;
    }
    const baselineDate = row.outcome.effectiveBaselineDate;
    try {
      const baseline = await lockBaseline({
        brandId: brand.brandId,
        baselineDate,
        lockedBy,
        notes: row.plan.notes,
        recoveryThresholdPct: row.plan.recoveryThresholdPct,
        recoveryConsecutiveDays: row.plan.recoveryConsecutiveDays,
      });
      console.log(
        `  ${brand.brandName}: locked (${baselineDate}, avg_position=${row.outcome.avgPosition.toFixed(2)}, top10=${row.outcome.keywordsInTop10})`,
      );
      liveRows.push({
        plan: row.plan,
        brand,
        outcome: {
          kind: "locked",
          baselineDate: baseline.baselineDate,
          avgPosition: row.outcome.avgPosition,
          keywordsInTop10: row.outcome.keywordsInTop10,
          keywordsInTop3: row.outcome.keywordsInTop3,
        },
      });
    } catch (err) {
      if (err instanceof BaselineAlreadyLockedError) {
        console.log(`  ${brand.brandName}: already locked`);
        liveRows.push({
          plan: row.plan,
          brand,
          outcome: { kind: "already_locked", baselineDate },
        });
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ${brand.brandName}: ERROR — ${message}`);
      liveRows.push({ plan: row.plan, brand, outcome: { kind: "error", message } });
    }
  }

  writeDoc("docs/recovery-baselines.md", renderLockedDoc(liveRows, lockedBy));
  console.log("");
  console.log("✓ wrote docs/recovery-baselines.md");
}

main()
  .catch((err) => {
    console.error("lock-baselines: fatal", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
