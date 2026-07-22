import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "../index";
import { contentPlanTemplatesTable } from "../schema";

/* -------------------------------------------------------------------------- */
/* Raw JSONB shape contracts (mirrors seed data + Phase 2 form binding)       */
/* -------------------------------------------------------------------------- */

type GlobalTemplateData = {
  citation_authority: {
    dr_minimum: number;
    max_age_years: number;
    max_per_article: number;
    /** Plain domain-name strings. All inherit the global dr_minimum unless a
     *  per-type domain_min_dr override is present for that domain. */
    whitelisted_domains: string[];
  };
  brand_voice_global: {
    mentions_per_article_target: number;
    mentions_per_article_max: number;
    mention_styles_vocabulary: string[];
  };
  tone_requirements: {
    affirmative_tone_required: boolean;
    banned_phrases: string[];
  };
  cost_budget: {
    estimated_usd_per_article: number | null;
    daily_brand_cap_usd: number | null;
  };
};

type PerTypeTemplateData = {
  article_structure: {
    target_word_count: number;
    h2_count_target: number;
    section_kinds: string[];
  };
  required_elements: {
    min_named_projects: number;
    min_testimonials: number;
    min_internal_links: number;
    min_external_citations: number;
    [key: string]: boolean | number;
  };
  brand_mention_overrides: {
    mentions_per_article_target: number | null;
    mentions_per_article_max: number | null;
  };
  /**
   * Optional per-type citation authority overrides.
   * All sub-fields are optional and null means "inherit from global".
   *
   * domain_min_dr: sparse map of domain → effective DR minimum for THIS content
   * type only. Used for the domain whitelist deep merge (see getResolvedTemplate).
   */
  citation_authority_overrides?: {
    dr_minimum?: number | null;
    max_age_years?: number | null;
    max_per_article?: number | null;
    /**
     * Per-domain DR minimum overrides. Keys are domain names that appear in the
     * global whitelisted_domains list (or new domains added for this type only).
     * Values are the effective DR minimum for that domain in this content type.
     *
     * Domain whitelist deep merge semantics (per-type wins for conflicts):
     *
     * 1. Start with all domains from the global whitelist. Each gets the
     *    resolved dr_minimum for this type (per-type override ?? global default).
     *
     * 2. Overlay domain_min_dr entries on top:
     *    - Same domain → per-type value replaces the global entry (per-type wins,
     *      lower or higher thresholds are both valid for type-specific standards).
     *    - New domain (not in global list) → appended to the resolved list.
     *
     * 3. The result is deduplicated by domain (Map ensures one entry per domain).
     *    Output is sorted alphabetically for deterministic ordering.
     *
     * Example: global has statista.com at DR 80. Cost Guide has
     *   domain_min_dr: { "statista.com": 75 }. Resolved output: one entry for
     *   statista.com at DR 75. No duplicate statista.com entries.
     */
    domain_min_dr?: Record<string, number>;
  };
};

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Whether a resolved field came from the global template or was explicitly
 * set on the per-type template. Consumed by:
 *  - UI toggles ("Inherit from global" vs "Override")
 *  - Plan provenance map at review time
 *  - Plan compliance checks (distinguish explicit clear from template default)
 */
export type FieldProvenance = "global" | "per_type";

/**
 * Fully resolved template for a given brand + content type.
 *
 * All null per-type overrides have been replaced by the corresponding global
 * cascade value. Every consumer (planner AI, Rules Dashboard preview mode,
 * plan compliance report) MUST use this type rather than reimplementing
 * cascade logic independently.
 *
 * Fail-closed: getResolvedTemplate returns null if no active global template
 * exists for the brand (an article cannot be planned without global rules).
 */
export type ResolvedTemplate = {
  contentType: string;
  /**
   * Row versions used to construct this view. Planner AI stamps these into
   * plan_data.meta so every plan is auditable back to the exact rule versions
   * that were active when the plan was drafted.
   */
  versions: {
    global: number;
    perType: number | null;
  };

  /* ── Global-only fields (no per-type override supported in v1) ─────────── */
  toneRequirements: {
    affirmativeToneRequired: boolean;
    bannedPhrases: string[];
  };
  costBudget: {
    estimatedUsdPerArticle: number | null;
    dailyBrandCapUsd: number | null;
    /** Always from global — mentionStylesVocabulary has no per-type concept. */
  };

  /* ── Cascadable: global default, overridable per-type ──────────────────── */
  citationAuthority: {
    drMinimum: number;
    maxAgeYears: number;
    maxPerArticle: number;
    /**
     * Merged domain whitelist. Each entry carries its effective DR minimum
     * after applying per-type domain_min_dr overrides (per-type wins for
     * same-domain conflicts; see PerTypeTemplateData.citation_authority_overrides
     * JSDoc for full merge semantics). Sorted alphabetically.
     */
    whitelistedDomains: Array<{ domain: string; effectiveDrMinimum: number }>;
  };
  brandVoice: {
    mentionsPerArticleTarget: number;
    mentionsPerArticleMax: number;
    mentionStylesVocabulary: string[];
  };

  /* ── Per-type only (null = not yet configured for this type) ───────────── */
  articleStructure: {
    targetWordCount: number;
    h2CountTarget: number;
    sectionKinds: string[];
  } | null;
  requiredElements: {
    minNamedProjects: number;
    minTestimonials: number;
    minInternalLinks: number;
    minExternalCitations: number;
    booleanFlags: Record<string, boolean>;
  } | null;

  /**
   * Per-field provenance for every field that can be inherited OR explicitly
   * overridden per-type. Fields with no per-type override concept are omitted.
   *
   * UI toggle contract:
   *   provenance.X === "global"    → show "Inherit from global" toggle (on);
   *                                  display global value greyed-out
   *   provenance.X === "per_type"  → show "Override" toggle (on);
   *                                  field is editable with explicit per-type value
   */
  provenance: {
    mentionsPerArticleTarget: FieldProvenance;
    mentionsPerArticleMax: FieldProvenance;
    drMinimum: FieldProvenance;
    maxAgeYears: FieldProvenance;
    maxPerArticle: FieldProvenance;
  };
};

/** Lightweight version history row (for the version history panel). */
export type TemplateVersionRow = {
  id: string;
  version: number;
  isActive: boolean;
  createdAt: Date;
  createdBy: string | null;
  scope: string;
  contentType: string | null;
};

/* -------------------------------------------------------------------------- */
/* TEMPLATE CASCADE MAP                                                        */
/*                                                                             */
/* Explicit documentation of which per-type JSONB keys cascade to which       */
/* global JSONB keys. Read this table first when modifying getResolvedTemplate */
/* — the merge logic must stay consistent with these mappings.                 */
/*                                                                             */
/* Cascade rule for every entry:                                               */
/*   null per-type value  → inherit the global value (provenance = "global")  */
/*   explicit per-type value → use the override (provenance = "per_type")     */
/* -------------------------------------------------------------------------- */

/**
 * Each entry maps:
 *   perTypePath  — dotted path into PerTypeTemplateData JSONB
 *   globalPath   — dotted path into GlobalTemplateData JSONB (the fallback)
 *   resolvedField — camelCase field on ResolvedTemplate that carries the result
 */
export const TEMPLATE_CASCADE_MAP = [
  {
    perTypePath:   "brand_mention_overrides.mentions_per_article_target",
    globalPath:    "brand_voice_global.mentions_per_article_target",
    resolvedField: "brandVoice.mentionsPerArticleTarget",
  },
  {
    perTypePath:   "brand_mention_overrides.mentions_per_article_max",
    globalPath:    "brand_voice_global.mentions_per_article_max",
    resolvedField: "brandVoice.mentionsPerArticleMax",
  },
  {
    perTypePath:   "citation_authority_overrides.dr_minimum",
    globalPath:    "citation_authority.dr_minimum",
    resolvedField: "citationAuthority.drMinimum",
  },
  {
    perTypePath:   "citation_authority_overrides.max_age_years",
    globalPath:    "citation_authority.max_age_years",
    resolvedField: "citationAuthority.maxAgeYears",
  },
  {
    perTypePath:   "citation_authority_overrides.max_per_article",
    globalPath:    "citation_authority.max_per_article",
    resolvedField: "citationAuthority.maxPerArticle",
  },
] as const;

export type CascadeEntry = (typeof TEMPLATE_CASCADE_MAP)[number];

/* -------------------------------------------------------------------------- */
/* getResolvedTemplate                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Returns the fully resolved template for a brand + content type, with all
 * null per-type overrides replaced by global cascade values and domain
 * whitelists deep-merged (per-type wins for conflicts).
 *
 * Single source of truth for cascade logic. Every consumer MUST use this
 * helper. Never duplicate cascade logic in callers.
 *
 * Returns null if no active global template exists for the brand — treat as
 * a hard blocker (you cannot plan an article without global rules configured).
 */
export async function getResolvedTemplate(
  brandId: string,
  contentType: string,
): Promise<ResolvedTemplate | null> {
  const [globalRows, typeRows] = await Promise.all([
    db
      .select()
      .from(contentPlanTemplatesTable)
      .where(
        and(
          eq(contentPlanTemplatesTable.brandId, brandId),
          eq(contentPlanTemplatesTable.scope, "global"),
          isNull(contentPlanTemplatesTable.contentType),
          eq(contentPlanTemplatesTable.isActive, true),
        ),
      )
      .limit(1),
    db
      .select()
      .from(contentPlanTemplatesTable)
      .where(
        and(
          eq(contentPlanTemplatesTable.brandId, brandId),
          eq(contentPlanTemplatesTable.scope, "content_type"),
          eq(contentPlanTemplatesTable.contentType, contentType),
          eq(contentPlanTemplatesTable.isActive, true),
        ),
      )
      .limit(1),
  ]);

  const globalRow = globalRows[0] ?? null;
  const typeRow = typeRows[0] ?? null;

  if (!globalRow) return null; // fail closed

  const g = globalRow.templateData as unknown as GlobalTemplateData;
  const t = typeRow?.templateData as unknown as PerTypeTemplateData | undefined;

  /* ── Brand voice cascade ─────────────────────────────────────────────── */
  const typeTarget = t?.brand_mention_overrides?.mentions_per_article_target ?? null;
  const typeMax = t?.brand_mention_overrides?.mentions_per_article_max ?? null;

  /* ── Citation authority cascade ──────────────────────────────────────── */
  const citOverride = t?.citation_authority_overrides;
  const typedrMinimum = citOverride?.dr_minimum ?? null;
  const typeMaxAge = citOverride?.max_age_years ?? null;
  const typeMaxPerArticle = citOverride?.max_per_article ?? null;

  const resolvedDrMinimum = typedrMinimum ?? g.citation_authority.dr_minimum;

  /* ── Domain whitelist deep merge (per-type wins for same-domain) ─────── */
  const domainMap = new Map<string, number>();
  for (const domain of g.citation_authority.whitelisted_domains) {
    // Global domain inherits the resolved dr_minimum for this type
    domainMap.set(domain, resolvedDrMinimum);
  }
  const perTypeDomainOverrides = citOverride?.domain_min_dr ?? {};
  for (const [domain, minDr] of Object.entries(perTypeDomainOverrides)) {
    // Per-type entry wins: replaces same-domain global entry or adds new domain
    domainMap.set(domain, minDr);
  }
  const whitelistedDomains = Array.from(domainMap.entries())
    .map(([domain, effectiveDrMinimum]) => ({ domain, effectiveDrMinimum }))
    .sort((a, b) => a.domain.localeCompare(b.domain));

  /* ── Required elements boolean flags ─────────────────────────────────── */
  const booleanFlags: Record<string, boolean> = {};
  if (t?.required_elements) {
    for (const [k, v] of Object.entries(t.required_elements)) {
      if (typeof v === "boolean") booleanFlags[k] = v;
    }
  }

  return {
    contentType,
    versions: {
      global: globalRow.version,
      perType: typeRow?.version ?? null,
    },
    toneRequirements: {
      affirmativeToneRequired: g.tone_requirements.affirmative_tone_required,
      bannedPhrases: g.tone_requirements.banned_phrases,
    },
    costBudget: {
      estimatedUsdPerArticle: g.cost_budget.estimated_usd_per_article,
      dailyBrandCapUsd: g.cost_budget.daily_brand_cap_usd,
    },
    citationAuthority: {
      drMinimum: resolvedDrMinimum,
      maxAgeYears: typeMaxAge ?? g.citation_authority.max_age_years,
      maxPerArticle: typeMaxPerArticle ?? g.citation_authority.max_per_article,
      whitelistedDomains,
    },
    brandVoice: {
      mentionsPerArticleTarget:
        typeTarget ?? g.brand_voice_global.mentions_per_article_target,
      mentionsPerArticleMax:
        typeMax ?? g.brand_voice_global.mentions_per_article_max,
      mentionStylesVocabulary: g.brand_voice_global.mention_styles_vocabulary,
    },
    articleStructure: t?.article_structure
      ? {
          targetWordCount: t.article_structure.target_word_count,
          h2CountTarget: t.article_structure.h2_count_target,
          sectionKinds: t.article_structure.section_kinds,
        }
      : null,
    requiredElements: t?.required_elements
      ? {
          minNamedProjects: t.required_elements.min_named_projects,
          minTestimonials: t.required_elements.min_testimonials,
          minInternalLinks: t.required_elements.min_internal_links,
          minExternalCitations: t.required_elements.min_external_citations,
          booleanFlags,
        }
      : null,
    provenance: {
      mentionsPerArticleTarget: typeTarget !== null ? "per_type" : "global",
      mentionsPerArticleMax: typeMax !== null ? "per_type" : "global",
      drMinimum: typedrMinimum !== null ? "per_type" : "global",
      maxAgeYears: typeMaxAge !== null ? "per_type" : "global",
      maxPerArticle: typeMaxPerArticle !== null ? "per_type" : "global",
    },
  };
}

/* -------------------------------------------------------------------------- */
/* getTemplateVersionHistory                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Returns all versions of a template (active and inactive) for the version
 * history panel in the Rules Dashboard. Ordered newest-first.
 */
export async function getTemplateVersionHistory(opts: {
  brandId: string;
  scope: "global" | "content_type";
  contentType: string | null;
}): Promise<TemplateVersionRow[]> {
  const { brandId, scope, contentType } = opts;
  const rows = await db
    .select({
      id: contentPlanTemplatesTable.id,
      version: contentPlanTemplatesTable.version,
      isActive: contentPlanTemplatesTable.isActive,
      createdAt: contentPlanTemplatesTable.createdAt,
      createdBy: contentPlanTemplatesTable.createdBy,
      scope: contentPlanTemplatesTable.scope,
      contentType: contentPlanTemplatesTable.contentType,
    })
    .from(contentPlanTemplatesTable)
    .where(
      and(
        eq(contentPlanTemplatesTable.brandId, brandId),
        eq(contentPlanTemplatesTable.scope, scope),
        scope === "global"
          ? isNull(contentPlanTemplatesTable.contentType)
          : eq(contentPlanTemplatesTable.contentType, contentType!),
      ),
    )
    .orderBy(desc(contentPlanTemplatesTable.version));
  return rows;
}
