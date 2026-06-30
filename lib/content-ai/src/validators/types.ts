/**
 * Validator types — ContentForge Quality Fix Dispatch v2 (Phases 5 & 6).
 *
 * The validators run at final-stitch against the article-level structured
 * schema (ARTICLE_TOOL output, Phase 4) plus the stitched markdown body. Each
 * returns a {@link CheckResult}; the orchestrator (`runAllValidators`)
 * aggregates them into the `validation` object persisted on `draft_scores`.
 *
 * DB- and network-backed validators receive their data through injected
 * {@link ValidatorDeps} callbacks (pre-bound to a brandId by the caller). This
 * keeps two invariants the dispatch demands:
 *   - Confidentiality / asset lookups load FRESH on every generation (the
 *     caller invokes the query inside the dep, never a module-level cache) —
 *     dispatch §6.4 freshness.
 *   - The validators stay unit-testable with plain mocks (no live DB / HTTP).
 */

export type Severity = "hard" | "soft";

/** An item a validator removed or flagged out of the article. */
export interface StrippedItem {
  /** "testimonial" | "internal_link" | "case_study" | "statistic" | ... */
  entityType: string;
  detail: string;
  value?: unknown;
}

export interface CheckResult {
  /** Stable key, e.g. "brand_mention_passes". */
  key: string;
  passes: boolean;
  severity: Severity;
  reason: string;
  stripped?: StrippedItem[];
}

/* ── Article schema (Phase 4 §4.1) ───────────────────────────────────────── */

export interface CaseStudyCited {
  project_name: string;
  // PROHIBITED at schema layer: there is intentionally NO contract_value field.
  technical_narrative: string;
  outcome?: string;
  in_playbook_or_bank?: boolean;
}

export interface TestimonialUsed {
  reviewer_name: string;
  company: string;
  quote_excerpt: string;
  source_url?: string;
  in_bank?: boolean;
}

export interface InternalLink {
  target_url: string;
  anchor_text: string;
  section?: string;
  in_link_targets?: boolean;
}

export interface StatisticUsed {
  claim: string;
  source_url?: string;
  source_name?: string;
  year?: number;
  verified_live?: boolean;
  flagged_as_stale?: boolean;
}

export interface AuthorityCitation {
  domain: string;
  url: string;
  purpose?: string;
}

export interface FaqPair {
  question: string;
  answer: string;
}

export interface ArticleSchema {
  title_tag?: string;
  h1?: string;
  meta_description?: string;
  opening_block?: { first_100_words?: string; direct_answer?: string };
  closing_block?: { summary?: string };
  headings?: { h2?: string[]; h3?: string[] };
  list_blocks?: Array<{ section?: string; type?: string; items?: string[] }>;

  cost_table?: unknown;
  timeline_table?: unknown;
  regional_rate_comparison?: unknown;
  hourly_rate_comparison?: unknown;
  team_model_comparison?: unknown;
  maintenance_cost_breakdown?: unknown;
  competitor_teardown?: { competitors?: Array<Record<string, unknown>> };

  case_studies_cited?: CaseStudyCited[];
  local_entity_grounding?: { city?: string; local_context_sentences?: string[] };

  author_byline?: { name?: string; credentials?: string; bio_link?: string };
  statistics_used?: StatisticUsed[];
  external_authority_citations?: AuthorityCitation[];

  testimonials_used?: TestimonialUsed[];
  internal_links?: InternalLink[];

  faq_schema?: FaqPair[];
  cta_block?: { placement?: string; anchor_text?: string; target_url?: string };

  visual_prompts?: string[];

  lsi_retrieved?: string[];
  lsi_used_in_body?: string[];
  lsi_coverage_ratio?: number;

  validation?: Record<string, unknown>;
  [k: string]: unknown;
}

/* ── SERP signals (Phase 3.1) ────────────────────────────────────────────── */

export interface SerpSignals {
  requires_cost_table?: boolean;
  requires_timeline_table?: boolean;
  requires_regional_comparison?: boolean;
  requires_hourly_rate_comparison?: boolean;
  requires_team_model_comparison?: boolean;
  requires_maintenance_cost_breakdown?: boolean;
  requires_competitor_teardown?: boolean;
  requires_local_context?: boolean;
  [k: string]: boolean | undefined;
}

/* ── Injected dependencies ───────────────────────────────────────────────── */

export interface FetchedPage {
  ok: boolean;
  status: number;
  text: string;
}

export interface ValidatorDeps {
  /** dispatch §6.1 — must return true for the testimonial to be kept. */
  isReviewInBank(
    reviewerName: string,
    company: string,
    quoteExcerpt: string,
  ): Promise<boolean>;
  /** dispatch §6.4 — MUST read fresh from DB on every call (no app-start cache). */
  getConfidentialCompanies(): Promise<string[]>;
  /** dispatch §6.2 — must return true for the link to be kept. */
  isUrlInLinkTargets(url: string): Promise<boolean>;
  /** dispatch §6.2 — approved anchor variations for a target url. */
  getAnchorVariations(url: string): Promise<string[]>;
  /** dispatch §6.6 — named projects from the playbook portfolio. */
  getPlaybookProjectNames(): Promise<string[]>;
  /** dispatch §6.6 — reviews_bank_entries.project_name values for the brand. */
  getReviewsBankProjectNames(): Promise<string[]>;
  /** dispatch §6.3 — fetch a URL (api-server wires DataForSEO OnPage, cached 24h). */
  fetchUrl(url: string): Promise<FetchedPage>;
}

export interface ValidatorContext {
  article: ArticleSchema;
  /** The stitched markdown article body. */
  fullText: string;
  primaryKeyword: string;
  funnelStage: string | null;
  contentType: string | null;
  serpSignals: SerpSignals | null;
  lsiRetrieved: string[];
  currentYear: number;
  deps: ValidatorDeps;
}

/** Aggregate result persisted to `draft_scores.validation`. */
export interface ValidationSummary {
  /** True iff every HARD gate passes. */
  shippable: boolean;
  passes: Record<string, boolean>;
  reasons: Record<string, string>;
  softFlags: string[];
  stripped: StrippedItem[];
  checks: CheckResult[];
  /**
   * A deep copy of the input article with HARD-stripped items removed and
   * inline flags (verified_live / flagged_as_stale) applied. The caller's
   * input article is never mutated — persist THIS as `draft_scores.article_schema`.
   */
  sanitizedArticle: ArticleSchema;
}
