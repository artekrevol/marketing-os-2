import { and, eq, isNull } from "drizzle-orm";
import { db } from "../index";
import { contentPlanTemplatesTable } from "../schema";

/* -------------------------------------------------------------------------- */
/* Raw JSONB shape contracts (mirrors the seed + Phase 2 form binding)        */
/* -------------------------------------------------------------------------- */

type GlobalTemplateData = {
  citation_authority: {
    dr_minimum: number;
    max_age_years: number;
    max_per_article: number;
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
};

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Whether a resolved field's value came from the global template or was explicitly
 * set on the per-type template. Consumed by:
 *  - UI toggles ("Inherit from global" vs "Override") — no cascade logic in the browser
 *  - Plan provenance map at review time
 *  - Plan compliance checks (distinguish "Rabia cleared this" from "template default")
 */
export type FieldProvenance = "global" | "per_type";

/**
 * Fully resolved template for a given brand + content type.
 *
 * All null per-type overrides have been replaced by the corresponding global
 * cascade value. Consumers MUST use this type rather than re-implementing
 * cascade logic independently. The `provenance` map records which fields came
 * from global vs. per-type so callers can surface the distinction without
 * accessing raw JSONB.
 *
 * Fail-closed: `getResolvedTemplate` returns null if no global template exists
 * for the brand (an article cannot be planned without global rules).
 */
export type ResolvedTemplate = {
  contentType: string;
  /**
   * Row versions used to construct this resolved view. Planner AI stamps these
   * into plan_data.meta.template_version and plan_data.meta.global_rules_snapshot
   * so every plan is auditable back to the exact rule versions in effect.
   */
  versions: {
    global: number;
    perType: number | null;
  };

  /* ── Always from global (no per-type override supported in v1) ─────────── */
  citationAuthority: {
    drMinimum: number;
    maxAgeYears: number;
    maxPerArticle: number;
    whitelistedDomains: string[];
  };
  toneRequirements: {
    affirmativeToneRequired: boolean;
    bannedPhrases: string[];
  };
  costBudget: {
    estimatedUsdPerArticle: number | null;
    dailyBrandCapUsd: number | null;
  };

  /* ── Cascadable: global default, overridable per-type ──────────────────── */
  brandVoice: {
    mentionsPerArticleTarget: number;
    mentionsPerArticleMax: number;
    /** Always from global — per-type style distribution is planned by AI. */
    mentionStylesVocabulary: string[];
  };

  /* ── Per-type only (null = template not yet configured for this type) ──── */
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
    /** Type-specific boolean flags (e.g. must_include_price_table). */
    booleanFlags: Record<string, boolean>;
  } | null;

  /**
   * Per-field provenance for every field that can be inherited OR explicitly
   * overridden at the per-type level. Fields with no per-type override concept
   * are omitted — they're always "global" and don't need a toggle.
   *
   * UI contract:
   *   provenance.X === "global"   → toggle is "Inherit from global" (on), field
   *                                 shows global value greyed-out / read-only
   *   provenance.X === "per_type" → toggle is "Override" (on), field is editable
   *                                 and shows the explicit per-type value
   */
  provenance: {
    mentionsPerArticleTarget: FieldProvenance;
    mentionsPerArticleMax: FieldProvenance;
  };
};

/* -------------------------------------------------------------------------- */
/* Helper                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Returns the fully resolved template for a brand + content type, with all
 * null per-type overrides replaced by global cascade values.
 *
 * Single source of truth for cascade logic. Every consumer (planner AI,
 * Rules Dashboard preview mode, plan compliance report) MUST use this helper
 * instead of implementing cascade independently.
 *
 * Returns null if no active global template exists for the brand — the caller
 * must treat this as a hard blocker (you cannot plan an article without global
 * rules configured).
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

  // Fail closed — no global template = unresolvable
  if (!globalRow) return null;

  const g = globalRow.templateData as unknown as GlobalTemplateData;
  const t = typeRow?.templateData as unknown as PerTypeTemplateData | undefined;

  const typeTarget =
    t?.brand_mention_overrides?.mentions_per_article_target ?? null;
  const typeMax =
    t?.brand_mention_overrides?.mentions_per_article_max ?? null;

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
    citationAuthority: {
      drMinimum: g.citation_authority.dr_minimum,
      maxAgeYears: g.citation_authority.max_age_years,
      maxPerArticle: g.citation_authority.max_per_article,
      whitelistedDomains: g.citation_authority.whitelisted_domains,
    },
    toneRequirements: {
      affirmativeToneRequired: g.tone_requirements.affirmative_tone_required,
      bannedPhrases: g.tone_requirements.banned_phrases,
    },
    costBudget: {
      estimatedUsdPerArticle: g.cost_budget.estimated_usd_per_article,
      dailyBrandCapUsd: g.cost_budget.daily_brand_cap_usd,
    },
    brandVoice: {
      mentionsPerArticleTarget:
        typeTarget ?? g.brand_voice_global.mentions_per_article_target,
      mentionsPerArticleMax:
        typeMax ?? g.brand_voice_global.mentions_per_article_max,
      mentionStylesVocabulary:
        g.brand_voice_global.mention_styles_vocabulary,
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
      mentionsPerArticleTarget:
        typeTarget !== null ? "per_type" : "global",
      mentionsPerArticleMax:
        typeMax !== null ? "per_type" : "global",
    },
  };
}
