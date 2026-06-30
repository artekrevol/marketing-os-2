/**
 * Structural / pure validators — Phase 5 rules that need only the article
 * schema + body text (no DB, no network). Each returns a CheckResult.
 */
import type { ArticleSchema, CheckResult, ValidatorContext } from "./types.js";
import {
  containsKeyword,
  firstNWords,
  parseHeadings,
  splitParagraphs,
  splitSectionsByH2,
  splitSentences,
  stripMarkdown,
  wordCount,
} from "./text-utils.js";

const pass = (key: string, severity: "hard" | "soft", reason: string): CheckResult => ({ key, passes: true, severity, reason });
const fail = (key: string, severity: "hard" | "soft", reason: string): CheckResult => ({ key, passes: false, severity, reason });

/** TOFU 1:12 · MOFU 1:8 · BOFU 1:5. Default MOFU when unknown. */
export function normalizeFunnel(stage: string | null): "TOFU" | "MOFU" | "BOFU" {
  const s = (stage || "").toLowerCase();
  if (/tofu|awareness|top/.test(s)) return "TOFU";
  if (/bofu|decision|conversion|bottom/.test(s)) return "BOFU";
  return "MOFU";
}

/* 5.1 Brand-mention ratio (funnel-differentiated) — HARD */
const BRAND_PATTERNS = [
  /\btekrevol\b/gi,
  /\bour team\b/gi,
  /\bour work\b/gi,
  /\bour clients?\b/gi,
  /\bwe\b/gi,
];
export function brandMention(ctx: ValidatorContext): CheckResult {
  const maxByFunnel = { TOFU: 12, MOFU: 8, BOFU: 5 } as const;
  const N = maxByFunnel[normalizeFunnel(ctx.funnelStage)];
  const text = stripMarkdown(ctx.fullText);
  let branded = 0;
  for (const re of BRAND_PATTERNS) branded += (text.match(re) || []).length;
  const sentences = splitSentences(ctx.fullText);
  const brandedSentences = sentences.filter((s) =>
    BRAND_PATTERNS.some((re) => new RegExp(re.source, "i").test(s)),
  ).length;
  const nonBranded = Math.max(sentences.length - brandedSentences, 1);
  const ratio = branded / nonBranded;
  const passes = branded * N <= nonBranded;
  const k = "brand_mention_passes";
  return passes
    ? pass(k, "hard", `Brand ratio ${branded}:${nonBranded} within 1:${N} (${normalizeFunnel(ctx.funnelStage)}).`)
    : fail(k, "hard", `Brand ratio ${branded}:${nonBranded} (1:${(1 / ratio).toFixed(1)}) exceeds 1:${N} for ${normalizeFunnel(ctx.funnelStage)}.`);
}

/* 5.2 / matrix #2 — keyword placement across title/H1/first-100/meta/H2/closing — HARD */
export function keywordPlacement(ctx: ValidatorContext): CheckResult {
  const kw = ctx.primaryKeyword;
  const a = ctx.article;
  const k = "keyword_placement_passes";
  if (!kw) return fail(k, "hard", "No primary keyword set on project.");
  const headings = parseHeadings(ctx.fullText);
  const first100 = a.opening_block?.first_100_words || firstNWords(ctx.fullText, 100);
  const closing = a.closing_block?.summary
    || (a.faq_schema || []).map((f) => `${f.question} ${f.answer}`).join(" ")
    || splitSectionsByH2(ctx.fullText).slice(-1)[0]?.body || "";
  const checks: Array<[string, boolean]> = [
    ["title", containsKeyword(a.title_tag || "", kw)],
    ["h1", containsKeyword(a.h1 || headings.find((h) => h.level === 1)?.text || "", kw)],
    ["first_100_words", containsKeyword(first100, kw)],
    ["meta", containsKeyword(a.meta_description || "", kw)],
    ["an_h2", headings.some((h) => h.level === 2 && containsKeyword(h.text, kw))],
    ["closing", containsKeyword(closing, kw)],
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([n]) => n);
  return missing.length === 0
    ? pass(k, "hard", `Primary keyword present in title, H1, first 100 words, meta, an H2, and closing.`)
    : fail(k, "hard", `Primary keyword "${kw}" missing from: ${missing.join(", ")}.`);
}

/* 5.2 — explicit 2–3-sentence direct answer in the opening — HARD */
export function directAnswer(ctx: ValidatorContext): CheckResult {
  const k = "direct_answer_passes";
  const ans = ctx.article.opening_block?.direct_answer || "";
  const n = splitSentences(ans).length;
  return n >= 2 && n <= 3 && wordCount(ans) >= 20
    ? pass(k, "hard", `Direct answer present (${n} sentences).`)
    : fail(k, "hard", `Opening direct_answer must be an explicit 2–3-sentence answer (got ${n} sentences).`);
}

/* matrix #3 — meta description 150–155 chars — HARD */
export function metaLength(ctx: ValidatorContext): CheckResult {
  const k = "meta_length_passes";
  const len = (ctx.article.meta_description || "").trim().length;
  return len >= 150 && len <= 155
    ? pass(k, "hard", `Meta description ${len} chars.`)
    : fail(k, "hard", `Meta description must be 150–155 chars (got ${len}).`);
}

/* matrix #4 — FAQ schema 3–5 pairs, 40–60-word answers — HARD */
export function faqSchema(ctx: ValidatorContext): CheckResult {
  const k = "faq_passes";
  const faqs = ctx.article.faq_schema || [];
  if (faqs.length < 3 || faqs.length > 5)
    return fail(k, "hard", `FAQ schema must have 3–5 pairs (got ${faqs.length}).`);
  const bad = faqs.filter((f) => {
    const w = wordCount(f.answer || "");
    return w < 40 || w > 60;
  });
  return bad.length === 0
    ? pass(k, "hard", `${faqs.length} FAQ pairs, all answers 40–60 words.`)
    : fail(k, "hard", `${bad.length} FAQ answer(s) outside 40–60 words.`);
}

/* 5.4 / matrix #1 — heading hygiene — HARD */
export function headingHygiene(ctx: ValidatorContext): CheckResult {
  const k = "heading_hygiene_passes";
  const headings = parseHeadings(ctx.fullText);
  const h1s = headings.filter((h) => h.level === 1);
  if (h1s.length !== 1)
    return fail(k, "hard", `Exactly one H1 required (found ${h1s.length}).`);
  const h2s = headings.filter((h) => h.level === 2).map((h) => h.text.toLowerCase());
  const dupH2 = h2s.filter((t, i) => h2s.indexOf(t) !== i);
  if (dupH2.length)
    return fail(k, "hard", `Duplicate H2(s): ${[...new Set(dupH2)].join(", ")}.`);
  // Duplicate H3 within the same parent H2.
  let parent = "";
  const seen = new Map<string, Set<string>>();
  for (const h of headings) {
    if (h.level === 2) parent = h.text.toLowerCase();
    if (h.level === 3) {
      const set = seen.get(parent) || new Set<string>();
      const t = h.text.toLowerCase();
      if (set.has(t))
        return fail(k, "hard", `Duplicate H3 "${h.text}" under "${parent}".`);
      set.add(t);
      seen.set(parent, set);
    }
  }
  return pass(k, "hard", "Headings unique and well-nested.");
}

/* 5.3 — competitive completeness driven by SERP flags — HARD */
const FLAG_TO_FIELD: Array<[string, keyof ArticleSchema]> = [
  ["requires_cost_table", "cost_table"],
  ["requires_timeline_table", "timeline_table"],
  ["requires_regional_comparison", "regional_rate_comparison"],
  ["requires_hourly_rate_comparison", "hourly_rate_comparison"],
  ["requires_team_model_comparison", "team_model_comparison"],
  ["requires_maintenance_cost_breakdown", "maintenance_cost_breakdown"],
  ["requires_competitor_teardown", "competitor_teardown"],
];
function nonEmpty(v: unknown): boolean {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}
export function competitiveCompleteness(ctx: ValidatorContext): CheckResult {
  const k = "competitive_completeness_passes";
  const sig = ctx.serpSignals || {};
  const missing: string[] = [];
  for (const [flag, field] of FLAG_TO_FIELD) {
    if (sig[flag] && !nonEmpty(ctx.article[field])) missing.push(String(field));
  }
  return missing.length === 0
    ? pass(k, "hard", "All SERP-required comparison tables present.")
    : fail(k, "hard", `SERP flags require missing field(s): ${missing.join(", ")}.`);
}

/* 5.6 — content-type integrity: CTA only in cta_block — HARD */
const CTA_PATTERNS = [
  /\bcontact us\b/gi,
  /\bget (?:a |your )?(?:free )?quote\b/gi,
  /\bschedule a (?:call|consultation|demo)\b/gi,
  /\bbook a (?:call|demo|consultation)\b/gi,
  /\bget started (?:today|now)?\b/gi,
  /\breach out\b/gi,
  /\blet'?s talk\b/gi,
  /\]\(\/contact\b/gi,
];
export function contentTypeIntegrity(ctx: ValidatorContext): CheckResult {
  const k = "content_type_integrity_passes";
  // Remove the legitimate closing cta_block text before scanning the body.
  let body = ctx.fullText;
  const ctaAnchor = ctx.article.cta_block?.anchor_text;
  if (ctaAnchor) body = body.split(ctaAnchor).join(" ");
  let hits = 0;
  for (const re of CTA_PATTERNS) hits += (body.match(re) || []).length;
  return hits <= 1
    ? pass(k, "hard", `Body is vendor-neutral (${hits} stray CTA phrase).`)
    : fail(k, "hard", `${hits} CTA phrases mid-body; CTAs belong only in cta_block.`);
}

/* 5.7 / matrix #5 — author byline — HARD */
export function authorByline(ctx: ValidatorContext): CheckResult {
  const k = "author_byline_passes";
  const b = ctx.article.author_byline;
  if (!b) return fail(k, "hard", "Missing author_byline.");
  const okName = (b.name || "").trim().toLowerCase() === "by the tekrevol team";
  const okBio = (b.bio_link || "").trim() === "/about";
  const okCreds = !!(b.credentials || "").trim();
  return okName && okBio && okCreds
    ? pass(k, "hard", "Author byline + credentials present.")
    : fail(k, "hard", `Byline invalid (name:${okName} creds:${okCreds} bio_link:${okBio}).`);
}

/* 5.13 / matrix #11 — list formatting: 3+ enumerated items must be a list — HARD */
export function listFormatting(ctx: ValidatorContext): CheckResult {
  const k = "list_formatting_passes";
  const offenders: string[] = [];
  for (const para of splitParagraphs(ctx.fullText)) {
    if (/^\s*(?:[-*+]|\d+\.)\s+/m.test(para)) continue; // already a list
    const ordinals = (para.match(/\b(first|second|third|fourth|fifth|sixth|seventh)\b/gi) || []).map((s) => s.toLowerCase());
    const distinct = new Set(ordinals);
    const seqInline = /\b1\)[^\n]*\b2\)[^\n]*\b3\)/.test(para);
    if (distinct.size >= 3 || seqInline) offenders.push(para.slice(0, 60));
  }
  return offenders.length === 0
    ? pass(k, "hard", "Enumerations rendered as lists.")
    : fail(k, "hard", `${offenders.length} prose enumeration(s) of 3+ items should be lists.`);
}

/* 5.14 / matrix #10 — local entity grounding (if SERP flag) — HARD */
export function localGrounding(ctx: ValidatorContext): CheckResult {
  const k = "local_grounding_passes";
  if (!ctx.serpSignals?.requires_local_context)
    return pass(k, "hard", "Local context not required.");
  const sentences = ctx.article.local_entity_grounding?.local_context_sentences || [];
  const valid = sentences.filter((s) => wordCount(s) >= 5);
  return valid.length >= 2
    ? pass(k, "hard", `${valid.length} local-context sentences present.`)
    : fail(k, "hard", `requires_local_context set but only ${valid.length} local-context sentence(s) (need ≥2).`);
}

/* 5.15 / matrix #19 — LSI coverage ≥0.60 — SOFT */
export function lsiCoverage(ctx: ValidatorContext): CheckResult {
  const k = "lsi_coverage_passes";
  const ratio = typeof ctx.article.lsi_coverage_ratio === "number" ? ctx.article.lsi_coverage_ratio : null;
  if (ratio == null) return pass(k, "soft", "No LSI terms retrieved; coverage not applicable.");
  return ratio >= 0.6
    ? pass(k, "soft", `LSI coverage ${(ratio * 100).toFixed(0)}%.`)
    : fail(k, "soft", `LSI coverage ${(ratio * 100).toFixed(0)}% below 60% target.`);
}

/* 5.11 / matrix #21 — stat density ≤1 per paragraph — SOFT */
export function statDensity(ctx: ValidatorContext): CheckResult {
  const k = "stat_density_passes";
  let offenders = 0;
  for (const para of splitParagraphs(stripMarkdown(ctx.fullText))) {
    const stats = (para.match(/\$\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?%|\b\d[\d,]{2,}\b/g) || [])
      .filter((t: string) => !/^\d{4}$/.test(t.replace(/[^\d]/g, ""))); // drop bare years
    if (stats.length > 1) offenders++;
  }
  return offenders === 0
    ? pass(k, "soft", "≤1 supporting number per paragraph.")
    : fail(k, "soft", `${offenders} paragraph(s) carry >1 statistic.`);
}

/* 5.12 / matrix #22 — cross-section repetition of 8+ word phrases — SOFT */
export function repetition(ctx: ValidatorContext): CheckResult {
  const k = "repetition_passes";
  const sections = splitSectionsByH2(ctx.fullText);
  const phraseToSections = new Map<string, Set<number>>();
  sections.forEach((sec, idx) => {
    const words = stripMarkdown(sec.body).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
    for (let i = 0; i + 8 <= words.length; i++) {
      const gram = words.slice(i, i + 8).join(" ");
      const set = phraseToSections.get(gram) || new Set<number>();
      set.add(idx);
      phraseToSections.set(gram, set);
    }
  });
  const repeated = [...phraseToSections.entries()].filter(([, s]) => s.size >= 2);
  return repeated.length === 0
    ? pass(k, "soft", "No section-spanning repetition.")
    : fail(k, "soft", `${repeated.length} phrase(s) repeat across sections (e.g. "${repeated[0]![0].slice(0, 40)}…").`);
}

/* 5.16 / matrix #20 — topic-coverage checklist — HARD (cost guide) / SOFT (others) */
const TOPIC_CHECKLISTS: Record<string, string[]> = {
  cost: ["cost range", "driver", "regional", "team model", "maintenance", "timeline", "exclusion"],
  comparison: ["feature", "cost compar", "use case", "use-case", "migration", "recommend"],
  howto: ["prerequisite", "step", "pitfall", "tool", "outcome"],
};
function checklistKind(contentType: string | null, keyword: string): { kind: keyof typeof TOPIC_CHECKLISTS; hard: boolean } | null {
  const t = `${contentType || ""} ${keyword}`.toLowerCase();
  if (/cost|price|pricing|how much/.test(t)) return { kind: "cost", hard: true };
  if (/compar|vs\b|versus|alternative/.test(t)) return { kind: "comparison", hard: false };
  if (/how to|how-to|guide|tutorial|step/.test(t)) return { kind: "howto", hard: false };
  return null;
}
export function topicChecklist(ctx: ValidatorContext): CheckResult {
  const k = "topic_checklist_passes";
  const cfg = checklistKind(ctx.contentType, ctx.primaryKeyword);
  if (!cfg) return pass(k, "soft", "No topic checklist for this content type.");
  const hay = stripMarkdown(ctx.fullText).toLowerCase();
  const missing = TOPIC_CHECKLISTS[cfg.kind]!.filter((sub) => !hay.includes(sub));
  const severity = cfg.hard ? "hard" : "soft";
  return missing.length === 0
    ? pass(k, severity, `All ${cfg.kind}-guide sub-topics present.`)
    : fail(k, severity, `${cfg.kind}-guide missing sub-topic(s): ${missing.join(", ")}.`);
}
