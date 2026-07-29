import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  date,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { brandsTable } from "./brands";

/**
 * Asset corpora for the ContentForge Quality Fix Dispatch (v2).
 *
 * Three brand-scoped tables that make TekRevol's canonical assets queryable
 * at generation time:
 *  - reviews_bank_entries — the testimonial corpus (Clutch reviews)
 *  - link_targets         — the internal linking corpus
 *  - linking_rules         — precomputed cluster link-selection patterns
 *
 * All three are brand-scoped (Pattern A): a `brand_id` FK to `brands` with
 * `onDelete: "restrict"`, snake_case columns, and an entry in
 * BRAND_SCOPED_TABLES (lib/db/src/brand-scope.ts).
 *
 * Soft-delete / confidentiality gates are enforced via partial indexes so
 * the "safe" query path (is_confidential = false / is_active = true) is the
 * indexed fast path — validator code that forgets the filter takes a slower
 * sequential path rather than silently leaking excluded rows.
 */

/* -------------------------------------------------------------------------- */
/* reviews_bank_entries — the testimonial corpus                              */
/* -------------------------------------------------------------------------- */
export const reviewsBankEntriesTable = pgTable(
  "reviews_bank_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    reviewerName: text("reviewer_name").notNull(),
    reviewerRole: text("reviewer_role"),
    company: text("company").notNull(),
    companyIndustry: text("company_industry"),
    projectName: text("project_name"),
    quoteExcerpt: text("quote_excerpt").notNull(),
    quoteFull: text("quote_full"),
    rating: numeric("rating", { precision: 3, scale: 1 }),
    sourceUrl: text("source_url"),
    datePublished: date("date_published"),
    icp: integer("icp"),
    vertical: text("vertical"),
    costBucket: text("cost_bucket"),
    outcomeMetrics: jsonb("outcome_metrics").notNull().default({}),
    /**
     * Industry tags for planner-driven testimonial selection.
     * Values: 'healthcare','fintech','edtech','real_estate','retail',
     *   'manufacturing','hospitality','legal','government','nonprofit'
     * GIN-indexed (reviews_bank_industry_tags_idx) — query with ?| operator.
     */
    industryTags: jsonb("industry_tags").notNull().default([]),
    /**
     * Free-form service-topic keyword tags.
     * e.g. ['hipaa_compliance','mobile_apps','payment_infrastructure']
     * GIN-indexed (reviews_bank_keyword_tags_idx) — query with ?| operator.
     */
    keywordTags: jsonb("keyword_tags").notNull().default([]),
    isConfidential: boolean("is_confidential").notNull().default(false),
    confidentialReason: text("confidential_reason"),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("reviews_bank_entries_reviewer_company_uq").on(
      t.brandId,
      t.reviewerName,
      t.company,
    ),
    index("rbe_brand_icp_idx")
      .on(t.brandId, t.icp)
      .where(sql`${t.isConfidential} = false`),
    index("rbe_brand_vertical_idx")
      .on(t.brandId, t.vertical)
      .where(sql`${t.isConfidential} = false`),
    index("rbe_brand_confidential_idx").on(t.brandId, t.isConfidential),
  ],
);

export type ReviewsBankEntry = typeof reviewsBankEntriesTable.$inferSelect;
export type InsertReviewsBankEntry =
  typeof reviewsBankEntriesTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* link_targets — the internal linking corpus                                 */
/* -------------------------------------------------------------------------- */
export const linkTargetsTable = pgTable(
  "link_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    url: text("url").notNull(),
    pageTitle: text("page_title"),
    pageType: text("page_type").notNull(),
    contentCluster: text("content_cluster"),
    vertical: text("vertical"),
    funnelStage: text("funnel_stage").notNull(),
    primaryIcp: integer("primary_icp"),
    primaryKeyword: text("primary_keyword"),
    anchorVariations: jsonb("anchor_variations").notNull().default([]),
    useFor: text("use_for"),
    isActive: boolean("is_active").notNull().default(true),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Ahrefs Bulk Import — additive columns (Phase 1.2)
    ahrefsSumTraffic: integer("ahrefs_sum_traffic"),
    ahrefsKeywordsCount: integer("ahrefs_keywords_count"),
    ahrefsTrafficValueUsd: numeric("ahrefs_traffic_value_usd", { precision: 12, scale: 2 }),
    ahrefsReferringDomains: integer("ahrefs_referring_domains"),
    ahrefsUr: numeric("ahrefs_ur", { precision: 5, scale: 2 }),
    /** Ahrefs hierarchical page classification, e.g. /Article/News_Update. Preserved as-is. */
    ahrefsPageType: text("ahrefs_page_type"),
    ahrefsTopKeyword: text("ahrefs_top_keyword"),
    ahrefsLastUpdated: timestamp("ahrefs_last_updated", { withTimezone: true }),
  },
  (t) => [
    unique("link_targets_brand_url_uq").on(t.brandId, t.url),
    index("lt_brand_cluster_idx")
      .on(t.brandId, t.contentCluster)
      .where(sql`${t.isActive} = true`),
    index("lt_brand_funnel_icp_idx")
      .on(t.brandId, t.funnelStage, t.primaryIcp)
      .where(sql`${t.isActive} = true`),
    index("lt_brand_url_lookup_idx")
      .on(t.brandId, t.url)
      .where(sql`${t.isActive} = true`),
  ],
);

export type LinkTarget = typeof linkTargetsTable.$inferSelect;
export type InsertLinkTarget = typeof linkTargetsTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* linking_rules — precomputed cluster link-selection patterns                */
/* -------------------------------------------------------------------------- */
export const linkingRulesTable = pgTable(
  "linking_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    triggerPattern: text("trigger_pattern").notNull(),
    triggerKeywords: jsonb("trigger_keywords").notNull().default([]),
    primaryTargetUrls: jsonb("primary_target_urls").notNull().default([]),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("lr_brand_pattern_idx").on(t.brandId, t.triggerPattern)],
);

export type LinkingRule = typeof linkingRulesTable.$inferSelect;
export type InsertLinkingRule = typeof linkingRulesTable.$inferInsert;
