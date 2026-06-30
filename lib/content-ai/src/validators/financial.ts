/**
 * Financial-suppression validators — the architecturally critical pieces of
 * the dispatch (Phase 5.9 / 6.6 case-study narrative, and 5.10 / 6.5 aggregate
 * financial suppression).
 *
 * The case-study gate enforces the "what we built, not what we billed" rule:
 * a case study can NEVER carry a per-project dollar amount. Defense in depth:
 *   1. The ARTICLE_TOOL schema has no `contract_value` field (Phase 4).
 *   2. This validator re-asserts it — any money key OR `$` in the narrative /
 *      outcome strips the entry, and `project_name` must exist in the playbook
 *      portfolio or the reviews bank.
 */
import type { CaseStudyCited, CheckResult, StrippedItem, ValidatorContext } from "./types.js";
import { DOLLAR_RE, normName, wordCount } from "./text-utils.js";

/** Keys that would smuggle a contract/deal value onto a case study. */
const MONEY_KEYS = [
  "contract_value",
  "contractvalue",
  "deal_value",
  "dealvalue",
  "revenue",
  "budget",
  "price",
  "cost",
  "value_usd",
  "amount",
  "billing",
  "billed",
];

/* 5.9 / 6.6 — case-study narrative validator (THE most important rule) — HARD */
export async function caseStudyNarrative(ctx: ValidatorContext): Promise<CheckResult> {
  const k = "case_study_narrative_passes";
  const studies = ctx.article.case_studies_cited || [];
  const stripped: StrippedItem[] = [];

  // Project-name allow-list = playbook portfolio ∪ reviews-bank project names.
  const [playbook, bank] = await Promise.all([
    ctx.deps.getPlaybookProjectNames(),
    ctx.deps.getReviewsBankProjectNames(),
  ]);
  const allowed = new Set([...playbook, ...bank].map(normName));

  const strip = (cs: CaseStudyCited, reason: string) =>
    stripped.push({ entityType: "case_study", detail: reason, value: cs });

  for (const cs of studies) {
    // (a) No money key may exist on the object at all — defeats any path by
    // which a dollar amount could be reintroduced after the schema layer.
    const rogueKey = Object.keys(cs as unknown as Record<string, unknown>).find((key) =>
      MONEY_KEYS.includes(key.toLowerCase().replace(/[^a-z_]/g, "")),
    );
    if (rogueKey) {
      strip(cs, `prohibited money field "${rogueKey}" present on case study`);
      continue;
    }
    // (b) technical_narrative ≥40 words.
    if (wordCount(cs.technical_narrative || "") < 40) {
      strip(cs, `technical_narrative under 40 words`);
      continue;
    }
    // (c) technical_narrative must NOT contain a dollar amount.
    if (DOLLAR_RE.test(cs.technical_narrative || "")) {
      strip(cs, `technical_narrative contains a dollar amount`);
      continue;
    }
    // (d) outcome, if present, must not be a dollar amount.
    if (cs.outcome && DOLLAR_RE.test(cs.outcome)) {
      strip(cs, `outcome is a dollar amount`);
      continue;
    }
    // (e) project_name must exist in playbook portfolio or reviews bank.
    if (!allowed.has(normName(cs.project_name || ""))) {
      strip(cs, `project_name "${cs.project_name}" not in playbook portfolio or reviews bank`);
      continue;
    }
  }

  return stripped.length === 0
    ? { key: k, passes: true, severity: "hard", reason: `${studies.length} case study/ies validated (no dollar amounts; all in portfolio/bank).` }
    : { key: k, passes: false, severity: "hard", reason: `${stripped.length} case study/ies stripped.`, stripped };
}

/* 5.10 / 6.5 — aggregate financial suppression — HARD */
const AGGREGATE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\$\s?\d[\d,.]*\s?(?:m|mm|k|b|bn|million|billion|thousand)?\b[^.]{0,40}\b(?:total\s+revenue|in\s+revenue|revenue|earned|generated)\b/i, label: "aggregate revenue" },
  { re: /\bwe(?:'ve| have)\s+(?:earned|generated|made|brought in)\s+\$?\s?\d/i, label: "aggregate revenue" },
  { re: /\b\d{1,3}\s?%\s+of\s+our\s+clients\b/i, label: "client concentration" },
  { re: /\bmost\s+of\s+our\s+clients\b/i, label: "client concentration" },
  { re: /\b\d+\s+deals?\s+closed\b/i, label: "deal metadata" },
  { re: /\baverage\s+contract\s+value\b/i, label: "deal metadata" },
  { re: /\bwin\s+rate\b/i, label: "internal BD metric" },
  { re: /\b(?:ARPU|LTV|CAC|MRR|ARR)\b/, label: "internal BD metric" },
];
export function aggregateFinancial(ctx: ValidatorContext): CheckResult {
  const k = "no_aggregate_financial_data";
  const stripped: StrippedItem[] = [];
  for (const { re, label } of AGGREGATE_PATTERNS) {
    const m = re.exec(ctx.fullText);
    if (m) stripped.push({ entityType: "aggregate_financial", detail: `${label}: "${m[0].trim().slice(0, 60)}"`, value: m[0] });
  }
  return stripped.length === 0
    ? { key: k, passes: true, severity: "hard", reason: "No aggregate / BD financial data detected." }
    : { key: k, passes: false, severity: "hard", reason: `${stripped.length} aggregate-financial match(es) must be stripped.`, stripped };
}
