/**
 * Validator orchestrator — ContentForge Quality Fix Dispatch v2 (Phases 5 & 6).
 *
 * `runAllValidators(ctx)` runs every Phase-5/6 check and folds them into a
 * {@link ValidationSummary}. The summary's `passes` map and `stripped` list are
 * persisted to `draft_scores.validation`; `shippable` is the ship gate (true
 * iff every HARD check passes). DB- and network-backed checks load through the
 * injected `ctx.deps` so confidentiality (6.4) is FRESH on every call.
 */
import type { CheckResult, ValidationSummary, ValidatorContext } from "./types.js";
import {
  authorByline,
  brandMention,
  competitiveCompleteness,
  contentTypeIntegrity,
  directAnswer,
  faqSchema,
  headingHygiene,
  keywordPlacement,
  listFormatting,
  localGrounding,
  lsiCoverage,
  metaLength,
  repetition,
  statDensity,
  topicChecklist,
} from "./structural.js";
import { aggregateFinancial, caseStudyNarrative } from "./financial.js";
import { confidentiality, internalLinks, testimonialsInBank } from "./assets.js";
import { authorityFloor, staleStats, statsVerifiedLive } from "./citations.js";

export * from "./types.js";
export * from "./text-utils.js";
export * from "./structural.js";
export * from "./financial.js";
export * from "./assets.js";
export * from "./citations.js";

/** Article arrays from which HARD-stripped items are removed before persistence. */
const STRIPPABLE_ARRAYS = [
  "statistics_used",
  "testimonials_used",
  "internal_links",
  "case_studies_cited",
  "external_authority_citations",
] as const;

export async function runAllValidators(ctx: ValidatorContext): Promise<ValidationSummary> {
  // Validators must NOT mutate the caller's article (dispatch invariant). Run
  // every check against a deep clone; the clone — with inline flags applied and
  // HARD-failing items removed — is what we persist as `article_schema`.
  const sanitizedArticle = structuredClone(ctx.article);
  const wctx: ValidatorContext = { ...ctx, article: sanitizedArticle };

  // Pure (synchronous) checks.
  const sync: CheckResult[] = [
    brandMention(wctx),
    keywordPlacement(wctx),
    directAnswer(wctx),
    metaLength(wctx),
    faqSchema(wctx),
    headingHygiene(wctx),
    competitiveCompleteness(wctx),
    contentTypeIntegrity(wctx),
    authorByline(wctx),
    listFormatting(wctx),
    localGrounding(wctx),
    lsiCoverage(wctx),
    statDensity(wctx),
    repetition(wctx),
    topicChecklist(wctx),
    aggregateFinancial(wctx),
    authorityFloor(wctx),
    staleStats(wctx),
  ];

  // Async (DB- / network-backed) checks.
  const async = await Promise.all([
    caseStudyNarrative(wctx),
    testimonialsInBank(wctx),
    internalLinks(wctx),
    confidentiality(wctx),
    statsVerifiedLive(wctx),
  ]);

  const checks = [...sync, ...async];

  const passes: Record<string, boolean> = {};
  const reasons: Record<string, string> = {};
  const softFlags: string[] = [];
  const stripped: ValidationSummary["stripped"] = [];
  let shippable = true;

  // Collect HARD-stripped object references for deterministic removal from the
  // persisted schema. SOFT checks (e.g. staleStats) only flag inline — never remove.
  const toRemove = new Set<unknown>();

  for (const c of checks) {
    passes[c.key] = c.passes;
    reasons[c.key] = c.reason;
    if (c.stripped?.length) {
      stripped.push(...c.stripped);
      if (c.severity === "hard") {
        for (const it of c.stripped) {
          if (it.value && typeof it.value === "object") toRemove.add(it.value);
        }
      }
    }
    if (!c.passes) {
      if (c.severity === "hard") shippable = false;
      else softFlags.push(c.key);
    }
  }

  if (toRemove.size > 0) {
    for (const key of STRIPPABLE_ARRAYS) {
      const arr = (sanitizedArticle as Record<string, unknown>)[key];
      if (Array.isArray(arr)) {
        (sanitizedArticle as Record<string, unknown>)[key] = arr.filter((el) => !toRemove.has(el));
      }
    }
  }

  return { shippable, passes, reasons, softFlags, stripped, checks, sanitizedArticle };
}
