import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";
import { keywordsTable } from "./seo";

/**
 * LLM Citation Preservation — data migrated from the legacy SEO Dashboard
 * for a future AI Research module. No UI is built against these yet; the
 * tables exist to preserve historical AI-citation / AI-overview data.
 *
 * All tables are brand-scoped (Pattern A): a `brand_id` FK to `brands`
 * with `onDelete: "restrict"`, snake_case column names, and an entry in
 * `BRAND_SCOPED_TABLES` (lib/db/src/brand-scope.ts).
 */

/* -------------------------------------------------------------------------- */
/* llm_citation_runs — a single LLM-citation collection run                    */
/* -------------------------------------------------------------------------- */
export const llmCitationRunsTable = pgTable(
  "llm_citation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    runType: text("run_type").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("llm_citation_runs_brand_idx").on(t.brandId)],
);

export type LlmCitationRun = typeof llmCitationRunsTable.$inferSelect;
export type InsertLlmCitationRun = typeof llmCitationRunsTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* llm_citation_snapshots — per-entity/platform snapshot within a run          */
/* -------------------------------------------------------------------------- */
export const llmCitationSnapshotsTable = pgTable(
  "llm_citation_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    runId: uuid("run_id").references(() => llmCitationRunsTable.id, {
      onDelete: "set null",
    }),
    entityType: text("entity_type").notNull(),
    entityDomain: text("entity_domain").notNull(),
    entityName: text("entity_name"),
    platform: text("platform").notNull(),
    mentionsCount: integer("mentions_count").notNull().default(0),
    aiSearchVolume: integer("ai_search_volume").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    pagesCount: integer("pages_count").notNull().default(0),
    mentionsChange: integer("mentions_change").notNull().default(0),
    aiSearchVolumeChange: integer("ai_search_volume_change").notNull().default(0),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("llm_citation_snapshots_brand_platform_idx").on(t.brandId, t.platform),
    index("llm_citation_snapshots_brand_captured_idx").on(t.brandId, t.capturedAt),
    index("llm_citation_snapshots_brand_entity_domain_idx").on(
      t.brandId,
      t.entityDomain,
    ),
  ],
);

export type LlmCitationSnapshot = typeof llmCitationSnapshotsTable.$inferSelect;
export type InsertLlmCitationSnapshot =
  typeof llmCitationSnapshotsTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* llm_citation_items — individual cited references within a snapshot           */
/* -------------------------------------------------------------------------- */
export const llmCitationItemsTable = pgTable(
  "llm_citation_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => llmCitationSnapshotsTable.id, { onDelete: "cascade" }),
    question: text("question"),
    answerExcerpt: text("answer_excerpt"),
    citedUrl: text("cited_url"),
    citedDomain: text("cited_domain"),
    citedPageTitle: text("cited_page_title"),
    sourceName: text("source_name"),
    snippet: text("snippet"),
    referencePosition: integer("reference_position"),
    aiSearchVolume: integer("ai_search_volume").default(0),
    impressions: integer("impressions").default(0),
    platform: text("platform").notNull(),
    locationCode: integer("location_code"),
    languageCode: text("language_code"),
    citationStatus: text("citation_status").default("new"),
    notes: text("notes"),
    intent: text("intent"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("llm_citation_items_brand_idx").on(t.brandId),
    index("llm_citation_items_snapshot_idx").on(t.snapshotId),
    index("llm_citation_items_brand_cited_domain_idx").on(t.brandId, t.citedDomain),
  ],
);

export type LlmCitationItem = typeof llmCitationItemsTable.$inferSelect;
export type InsertLlmCitationItem = typeof llmCitationItemsTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* llm_citation_top_pages — most-cited pages within a snapshot                 */
/* -------------------------------------------------------------------------- */
export const llmCitationTopPagesTable = pgTable(
  "llm_citation_top_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => llmCitationSnapshotsTable.id, { onDelete: "cascade" }),
    pageUrl: text("page_url").notNull(),
    pageTitle: text("page_title"),
    citationCount: integer("citation_count").notNull().default(0),
    platform: text("platform").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("llm_citation_top_pages_brand_idx").on(t.brandId),
    index("llm_citation_top_pages_brand_platform_idx").on(t.brandId, t.platform),
    index("llm_citation_top_pages_brand_captured_idx").on(t.brandId, t.capturedAt),
  ],
);

export type LlmCitationTopPage = typeof llmCitationTopPagesTable.$inferSelect;
export type InsertLlmCitationTopPage =
  typeof llmCitationTopPagesTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* llm_competitors — competitor domains tracked for LLM-citation analysis      */
/* -------------------------------------------------------------------------- */
export const llmCompetitorsTable = pgTable(
  "llm_competitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    competitorDomain: text("competitor_domain").notNull(),
    competitorName: text("competitor_name"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("llm_competitors_brand_domain_uq").on(t.brandId, t.competitorDomain),
  ],
);

export type LlmCompetitor = typeof llmCompetitorsTable.$inferSelect;
export type InsertLlmCompetitor = typeof llmCompetitorsTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* ai_overview_citations — Google AI Overview citations keyed to keywords      */
/* -------------------------------------------------------------------------- */
export const aiOverviewCitationsTable = pgTable(
  "ai_overview_citations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    snapshotId: uuid("snapshot_id").references(
      () => llmCitationSnapshotsTable.id,
      { onDelete: "set null" },
    ),
    keywordId: uuid("keyword_id").references(() => keywordsTable.id, {
      onDelete: "set null",
    }),
    domain: text("domain").notNull(),
    url: text("url"),
    pageTitle: text("page_title"),
    sourceName: text("source_name"),
    citedText: text("cited_text"),
    aiGeneratedContext: text("ai_generated_context"),
    referencePosition: integer("reference_position"),
    isElementLevel: boolean("is_element_level").notNull().default(false),
    contentType: text("content_type"),
    topicCategory: text("topic_category"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_overview_citations_brand_idx").on(t.brandId),
    index("ai_overview_citations_keyword_idx").on(t.keywordId),
    index("ai_overview_citations_brand_keyword_idx").on(t.brandId, t.keywordId),
    index("ai_overview_citations_brand_domain_idx").on(t.brandId, t.domain),
  ],
);

export type AiOverviewCitation = typeof aiOverviewCitationsTable.$inferSelect;
export type InsertAiOverviewCitation =
  typeof aiOverviewCitationsTable.$inferInsert;
