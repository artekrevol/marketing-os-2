import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";

/**
 * Named projects corpus — first-class table for TekRevol project case evidence.
 *
 * Previously, named project references lived as prose in the playbook (Section 10).
 * Elevating them here makes them queryable by the planner AI at plan-generation
 * time and editable by Rabia through the Rules Dashboard (Named Projects section).
 *
 * Planner queries filter by industry_tags and keyword_tags to select the most
 * relevant project reference(s) for the article being planned. The GIN indexes
 * on those columns were created via raw DDL (cpt_global_version_uq et al.) and
 * back the ?| (any-overlap) operator used in findNamedProjects().
 *
 * All three illustrative seed rows (Healthcare Scheduling, Fintech KYC, Retail
 * Inventory Sync) are marked is_confidential=true — Rabia replaces these with
 * real anonymized entries from client recordings.
 */
export const namedProjectsTable = pgTable(
  "named_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** URL-safe slug unique per brand. Used as a stable identifier in plan_data. */
    slug: text("slug").notNull(),
    problemSummary: text("problem_summary").notNull(),
    approachSummary: text("approach_summary").notNull(),
    outcomeSummary: text("outcome_summary").notNull(),
    /**
     * Industry tags: ['healthcare','fintech','edtech','real_estate','retail',
     *   'manufacturing','hospitality','legal','government','nonprofit']
     * Multi-select jsonb array.
     */
    industryTags: jsonb("industry_tags").notNull().default([]),
    /**
     * Keyword tags: free-form service-topic strings.
     * e.g. ['hipaa_compliance','mobile_apps','api_integration']
     * Rabia adds as needed — no fixed vocabulary.
     */
    keywordTags: jsonb("keyword_tags").notNull().default([]),
    /** Anonymized client name shown in article prose. Null → TekRevol omits client reference. */
    clientDisplayName: text("client_display_name"),
    /** Confidential projects are excluded from published article citations. */
    isConfidential: boolean("is_confidential").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    /**
     * Illustrative seed entries created during onboarding to show the data model.
     * Displayed with an amber "Placeholder" badge in the admin list.
     * Rabia should replace these with real anonymized client project entries.
     */
    isIllustrative: boolean("is_illustrative").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("named_projects_brand_slug_uq").on(t.brandId, t.slug),
    index("named_projects_brand_active_idx").on(t.brandId, t.isActive),
    // GIN indexes on industry_tags and keyword_tags created via raw DDL.
    // named_projects_industry_tags_idx, named_projects_keyword_tags_idx
  ],
);

export type NamedProject = typeof namedProjectsTable.$inferSelect;
export type InsertNamedProject = typeof namedProjectsTable.$inferInsert;
