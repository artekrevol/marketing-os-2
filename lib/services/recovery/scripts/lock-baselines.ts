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
import { fileURLToPath } from "node:url";

/**
 * Anchor doc paths to the workspace root, NOT `process.cwd()`. When
 * invoked via `pnpm --filter @workspace/services-recovery run
 * lock-baselines`, pnpm sets cwd to `lib/services/recovery`, which
 * would otherwise drop the docs under that package instead of the
 * repo-root `docs/`. The script lives at
 * `lib/services/recovery/scripts/lock-baselines.ts` — three levels up
 * from `scripts/` is the workspace root.
 */
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(SCRIPT_DIR, "..", "..", "..", "..");

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
    "| Brand | Date | Daily Clicks | Daily Sessions | Avg Position | Top 10 | Top 3 | Locked By |",
  );
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const { plan, resolved, outcome } of rows) {
    const brandLabel =
      "missing" in resolved ? `${plan.key} (NOT FOUND)` : resolved.brandName;
    if (outcome.kind === "brand_missing") {
      lines.push(
        `| ${brandLabel} | — | — | — | — | — | — | ${args.lockedBy} _(brand missing — will skip on --confirm)_ |`,
      );
      continue;
    }
    if (outcome.kind === "no_data") {
      lines.push(
        `| ${brandLabel} | ${outcome.attemptedDate} | NULL (pending GSC) | NULL (pending GA4) | — | — | — | ${args.lockedBy} _(no rank_snapshots — will skip on --confirm)_ |`,
      );
      continue;
    }
    const fellBack = outcome.fellBackToEarliest
      ? ` (fell back from ${plan.baselineDate})`
      : "";
    lines.push(
      `| ${brandLabel} | ${outcome.effectiveBaselineDate}${fellBack} | NULL (pending GSC) | NULL (pending GA4) | ${fmtNum(outcome.avgPosition, 2)} | ${outcome.keywordsInTop10} | ${outcome.keywordsInTop3} | ${args.lockedBy} |`,
    );
  }
  lines.push("");
  lines.push("### Per-brand context");
  lines.push("");
  for (const { plan, resolved, outcome } of rows) {
    const brandLabel =
      "missing" in resolved ? `${plan.key} (NOT FOUND)` : resolved.brandName;
    if (outcome.kind === "ok") {
      lines.push(
        `- **${brandLabel}** — keywords=${outcome.keywordCount}; notes: ${plan.notes}`,
      );
    } else if (outcome.kind === "no_data") {
      lines.push(
        `- **${brandLabel}** — no rank_snapshots in window; will be skipped on \`--confirm\``,
      );
    } else {
      lines.push(
        `- **${brandLabel}** — brand row not found in \`public.brands\`; will be skipped on \`--confirm\``,
      );
    }
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
    | {
        kind: "already_locked";
        baselineDate: string;
        avgPosition: number;
        keywordsInTop10: number;
        keywordsInTop3: number;
      }
    | { kind: "brand_missing" }
    | { kind: "no_data" }
    | { kind: "error"; message: string };
}

/**
 * Re-read the locked row from the DB so the confirmation doc reflects
 * what is actually persisted, not the dry-run computation. This closes
 * the dry-run/live drift window — if rankings shifted between phases,
 * the doc carries the locked values.
 */
async function readLockedBaseline(brandId: string): Promise<{
  baselineDate: string;
  avgPosition: number;
  keywordsInTop10: number;
  keywordsInTop3: number;
} | null> {
  const result = (await db.execute(sql`
    select
      baseline_date::text                  as baseline_date,
      avg_position_30d::float8             as avg_position,
      keywords_in_top_10                   as top_10,
      keywords_in_top_3                    as top_3
    from public.recovery_baselines
    where brand_id = ${brandId}::uuid
    limit 1
  `)) as
    | {
        rows?: Array<{
          baseline_date: string;
          avg_position: number;
          top_10: number;
          top_3: number;
        }>;
      }
    | Array<{
        baseline_date: string;
        avg_position: number;
        top_10: number;
        top_3: number;
      }>;
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  const row = rows[0];
  if (!row) return null;
  return {
    baselineDate: row.baseline_date,
    avgPosition: Number(row.avg_position),
    keywordsInTop10: Number(row.top_10),
    keywordsInTop3: Number(row.top_3),
  };
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
        `| ${brand.brandName} | ${outcome.baselineDate} | NULL | NULL | ${fmtNum(outcome.avgPosition, 2)} | ${outcome.keywordsInTop10} | ${outcome.keywordsInTop3} | ${lockedBy} | already_locked |`,
      );
    } else if (outcome.kind === "brand_missing") {
      lines.push(
        `| ${brand.brandName} (NOT FOUND) | — | — | — | — | — | — | ${lockedBy} | brand_missing |`,
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
  const abs = resolve(WORKSPACE_ROOT, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  // Echo the absolute path so the operator can verify location even
  // when the script is invoked from a non-root cwd.
  console.log(`  → ${abs}`);
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
  console.log("✓ wrote docs/recovery-baseline-dry-run.md");
  writeDoc("docs/recovery-baseline-dry-run.md", dryRunMd);

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
      console.log(`  ${row.plan.key}: BRAND NOT FOUND — recording brand_missing`);
      liveRows.push({
        plan: row.plan,
        // brand placeholder — only used for the report cell label.
        brand: { plan: row.plan, brandId: "", brandName: row.plan.key, brandSlug: row.plan.key },
        outcome: { kind: "brand_missing" },
      });
      continue;
    }
    const brand = row.resolved;
    if (row.outcome.kind === "no_data") {
      console.log(`  ${brand.brandName}: no rank_snapshots — recording no_data`);
      liveRows.push({ plan: row.plan, brand, outcome: { kind: "no_data" } });
      continue;
    }
    if (row.outcome.kind === "brand_missing") {
      // Defensive — already handled above.
      continue;
    }
    const baselineDate = row.outcome.effectiveBaselineDate;
    try {
      await lockBaseline({
        brandId: brand.brandId,
        baselineDate,
        lockedBy,
        notes: row.plan.notes,
        recoveryThresholdPct: row.plan.recoveryThresholdPct,
        recoveryConsecutiveDays: row.plan.recoveryConsecutiveDays,
      });
      // Re-read the persisted row so the confirmation doc reflects
      // what is actually in the database, not the (potentially stale)
      // dry-run computation.
      const persisted = await readLockedBaseline(brand.brandId);
      if (!persisted) {
        const message = "lockBaseline returned but recovery_baselines row not found on read-back";
        console.error(`  ${brand.brandName}: ERROR — ${message}`);
        liveRows.push({ plan: row.plan, brand, outcome: { kind: "error", message } });
        continue;
      }
      console.log(
        `  ${brand.brandName}: locked (${persisted.baselineDate}, avg_position=${persisted.avgPosition.toFixed(2)}, top10=${persisted.keywordsInTop10})`,
      );
      liveRows.push({ plan: row.plan, brand, outcome: { kind: "locked", ...persisted } });
    } catch (err) {
      if (err instanceof BaselineAlreadyLockedError) {
        const persisted = await readLockedBaseline(brand.brandId);
        if (!persisted) {
          const message = "BaselineAlreadyLockedError but recovery_baselines row not found on read-back";
          console.error(`  ${brand.brandName}: ERROR — ${message}`);
          liveRows.push({ plan: row.plan, brand, outcome: { kind: "error", message } });
          continue;
        }
        console.log(
          `  ${brand.brandName}: already locked (${persisted.baselineDate}, avg_position=${persisted.avgPosition.toFixed(2)}, top10=${persisted.keywordsInTop10})`,
        );
        liveRows.push({ plan: row.plan, brand, outcome: { kind: "already_locked", ...persisted } });
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ${brand.brandName}: ERROR — ${message}`);
      liveRows.push({ plan: row.plan, brand, outcome: { kind: "error", message } });
    }
  }

  console.log("");
  console.log("✓ wrote docs/recovery-baselines.md");
  writeDoc("docs/recovery-baselines.md", renderLockedDoc(liveRows, lockedBy));

  // Post-run invariant check. The lock is a one-shot, irreversible
  // operation; we MUST end with all four target brands in a terminal
  // success state (`locked` for first run, `already_locked` for
  // re-runs). Any other outcome — brand_missing, no_data, error —
  // exits non-zero so an operator does not mistake a partial run for
  // a successful one. The dry-run report and per-brand error log above
  // give them everything needed to remediate.
  const successful = liveRows.filter(
    (r) => r.outcome.kind === "locked" || r.outcome.kind === "already_locked",
  ).length;
  const failures = liveRows.filter(
    (r) =>
      r.outcome.kind === "brand_missing" ||
      r.outcome.kind === "no_data" ||
      r.outcome.kind === "error",
  );
  console.log("");
  console.log(
    `Summary: ${successful}/${BRAND_PLANS.length} brands in terminal state (locked or already_locked).`,
  );
  if (successful !== BRAND_PLANS.length || failures.length > 0) {
    console.error("");
    console.error("FAIL — invariant violated. Expected all four brands locked or already_locked. Failed:");
    for (const f of failures) {
      const brandLabel =
        "brandName" in f.brand && f.brand.brandName ? f.brand.brandName : f.plan.key;
      console.error(`  - ${brandLabel}: ${f.outcome.kind}` + ("message" in f.outcome ? ` (${f.outcome.message})` : ""));
    }
    console.error(
      "",
    );
    console.error(
      "Remediate (apply migrations, seed rank_snapshots, fix brand row), then re-run with --confirm. The lock action is idempotent.",
    );
    process.exitCode = 1;
    return;
  }
  console.log("✓ all four brands locked or already_locked.");
}

main()
  .catch((err) => {
    console.error("lock-baselines: fatal", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
