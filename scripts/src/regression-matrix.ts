/**
 * 24-check regression matrix (dispatch §7.1).
 *
 * Given a projectId, loads the persisted `draft_scores.validation` +
 * `draft_scores.article_schema` and the project's `serp_signals`, maps each of
 * the 24 audit checks to its validator output, and prints a pass/fail table.
 *
 *   pnpm --filter @workspace/scripts run regression-matrix <projectId>
 *
 * Exit code is non-zero when any HARD check fails so it can gate CI.
 */
import { db, draftScoresTable, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

type Status = "PASS" | "FAIL" | "N/A";

interface Row {
  n: number;
  check: string;
  status: Status;
  reason: string;
}

/** Each matrix row maps to a validation key (or a custom evaluator). */
const KEY_MAP: Array<{ n: number; check: string; key?: string; table?: string; signal?: string }> = [
  { n: 1, check: "No duplicate H2s/H3s", key: "heading_hygiene_passes" },
  { n: 2, check: "Primary keyword in title/H1/first-100/meta/H2/closing", key: "keyword_placement_passes" },
  { n: 3, check: "Meta description 150–155 chars", key: "meta_length_passes" },
  { n: 4, check: "FAQ schema 3–5 pairs, 40–60-word answers", key: "faq_passes" },
  { n: 5, check: "Author byline + credentials", key: "author_byline_passes" },
  { n: 6, check: "Cost table", table: "cost_table", signal: "requires_cost_table" },
  { n: 7, check: "Hourly rate comparison", table: "hourly_rate_comparison", signal: "requires_hourly_rate_comparison" },
  { n: 8, check: "Team model comparison", table: "team_model_comparison", signal: "requires_team_model_comparison" },
  { n: 9, check: "Maintenance cost breakdown", table: "maintenance_cost_breakdown", signal: "requires_maintenance_cost_breakdown" },
  { n: 10, check: "Local entity grounding ≥2 city sentences", key: "local_grounding_passes" },
  { n: 11, check: "Enumerated content as list", key: "list_formatting_passes" },
  { n: 12, check: "Brand mention ratio within funnel cap", key: "brand_mention_passes" },
  { n: 13, check: "No aggregate financial data", key: "no_aggregate_financial_data" },
  { n: 14, check: "No per-project dollar figures (case studies)", key: "case_study_narrative_passes" },
  { n: 15, check: "Internal links 3–5, all in link_targets", key: "all_links_in_link_targets" },
  { n: 16, check: "≥2 external authority citations", key: "authority_floor_passes" },
  { n: 17, check: "All stats verified live + content match", key: "all_stats_verified_live" },
  { n: 18, check: "All stats have year, >24mo flagged", key: "stats_freshness_passes" },
  { n: 19, check: "LSI coverage ≥0.60", key: "lsi_coverage_passes" },
  { n: 20, check: "Topic checklist complete", key: "topic_checklist_passes" },
  { n: 21, check: "Stat density ≤1/paragraph", key: "stat_density_passes" },
  { n: 22, check: "No section-spanning repetition", key: "repetition_passes" },
  { n: 23, check: "CTA in single closing block", key: "content_type_integrity_passes" },
  { n: 24, check: "No confidential companies named", key: "no_confidential_companies" },
];

function nonEmpty(v: unknown): boolean {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

async function main() {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error("usage: regression-matrix <projectId>");
    process.exit(2);
  }

  const [scoreRow] = await db
    .select({ validation: draftScoresTable.validation, articleSchema: draftScoresTable.articleSchema })
    .from(draftScoresTable)
    .where(eq(draftScoresTable.projectId, projectId))
    .limit(1);
  const [projRow] = await db
    .select({ keyword: projectsTable.keyword, serpSignals: projectsTable.serpSignals })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!scoreRow) {
    console.error(`No draft_scores row for project ${projectId}. Run final-stitch first.`);
    process.exit(2);
  }

  const validation = (scoreRow.validation as any) || {};
  const passes: Record<string, boolean> = validation.passes || {};
  const reasons: Record<string, string> = validation.reasons || {};
  const schema = (scoreRow.articleSchema as any) || {};
  const signals = (projRow?.serpSignals as any) || {};

  const rows: Row[] = KEY_MAP.map((m) => {
    if (m.table) {
      const required = !!signals[m.signal!];
      if (!required) return { n: m.n, check: m.check, status: "N/A" as Status, reason: "not required by SERP signals" };
      const present = nonEmpty(schema[m.table]);
      return { n: m.n, check: m.check, status: present ? "PASS" : "FAIL", reason: present ? "" : `${m.table} missing` };
    }
    const key = m.key!;
    if (!(key in passes)) return { n: m.n, check: m.check, status: "N/A" as Status, reason: "validator did not run" };
    const ok = passes[key];
    return { n: m.n, check: m.check, status: ok ? "PASS" : "FAIL", reason: ok ? "" : reasons[key] || "" };
  });

  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
  console.log(`\nRegression matrix — project ${projectId} (keyword: ${projRow?.keyword || "?"})`);
  console.log(`Shippable: ${validation.shippable ? "YES" : "NO"}\n`);
  console.log(`${pad("#", 3)} ${pad("Check", 52)} ${pad("Status", 6)} Reason`);
  console.log("-".repeat(96));
  for (const r of rows) {
    console.log(`${pad(String(r.n), 3)} ${pad(r.check, 52)} ${pad(r.status, 6)} ${r.reason}`);
  }

  const failed = rows.filter((r) => r.status === "FAIL");
  console.log("-".repeat(96));
  console.log(`${rows.filter((r) => r.status === "PASS").length} pass, ${failed.length} fail, ${rows.filter((r) => r.status === "N/A").length} n/a\n`);

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
