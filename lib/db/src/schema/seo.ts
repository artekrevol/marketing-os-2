import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  jsonb,
  timestamp,
  index,
  unique,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";

/**
 * SEO Intelligence module — keyword research, rank tracking, crawl
 * scheduling, and competitor discovery. All tables are brand-scoped
 * (Pattern A): a `brand_id` FK to `brands` with `onDelete: "restrict"`,
 * snake_case column names, and an entry in `BRAND_SCOPED_TABLES`
 * (lib/db/src/brand-scope.ts) so `withBrandScope()` enforces tenancy.
 *
 * These are first-class platform entities — no `seo_*` table prefix.
 * Status columns are plain `text` with an exported const array mirroring
 * the allowed values (same pattern as the Recovery War Room tables);
 * validate against the array in the service layer.
 */

/* -------------------------------------------------------------------------- */
/* locations — geographic targets for SERP queries                             */
/* -------------------------------------------------------------------------- */
export const locationsTable = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    countryCode: text("country_code"),
    region: text("region"),
    city: text("city"),
    dataforseoLocationCode: integer("dataforseo_location_code").notNull(),
    languageCode: text("language_code").notNull().default("en"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("locations_brand_id_idx").on(t.brandId),
    unique("locations_brand_dfsc_uq").on(t.brandId, t.dataforseoLocationCode),
  ],
);

export type Location = typeof locationsTable.$inferSelect;
export type InsertLocation = typeof locationsTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* keyword_lists — collections of keywords (self-referential hierarchy)        */
/* -------------------------------------------------------------------------- */
export const keywordListsTable = pgTable(
  "keyword_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    parentListId: uuid("parent_list_id").references(
      (): AnyPgColumn => keywordListsTable.id,
      { onDelete: "set null" },
    ),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("keyword_lists_brand_id_idx").on(t.brandId),
    index("keyword_lists_parent_idx").on(t.parentListId),
    unique("keyword_lists_brand_name_uq").on(t.brandId, t.name),
  ],
);

export type KeywordList = typeof keywordListsTable.$inferSelect;
export type InsertKeywordList = typeof keywordListsTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* keywords — individual tracked keywords                                      */
/* -------------------------------------------------------------------------- */
export const keywordsTable = pgTable(
  "keywords",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    keywordText: text("keyword_text").notNull(),
    listId: uuid("list_id").references(() => keywordListsTable.id, {
      onDelete: "set null",
    }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locationsTable.id, { onDelete: "restrict" }),
    searchVolume: integer("search_volume"),
    cpc: numeric("cpc", { precision: 12, scale: 4 }),
    competition: numeric("competition", { precision: 6, scale: 4 }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    // Shared Data Layer: denormalized count of content_url_keyword_link
    // rows pointing at this keyword. Maintained by the publish-link worker.
    linkedContentCount: integer("linked_content_count").notNull().default(0),
    // SEO Dashboard migration columns
    targetUrl: text("target_url"),
    languageCode: text("language_code"),
    priority: text("priority"),
    intentHint: text("intent_hint"),
    cluster: text("cluster"),
    isCorePage: boolean("is_core_page").notNull().default(false),
    trackDaily: boolean("track_daily").notNull().default(true),
    difficulty: numeric("difficulty", { precision: 5, scale: 2 }),
    isActive: boolean("is_active").notNull().default(true),
    // Ahrefs Bulk Import — additive columns (Phase 1.1)
    ahrefsBestPosition: integer("ahrefs_best_position"),
    ahrefsKeywordDifficulty: numeric("ahrefs_keyword_difficulty", { precision: 5, scale: 2 }),
    ahrefsSumTraffic: integer("ahrefs_sum_traffic"),
    ahrefsBestPositionUrl: text("ahrefs_best_position_url"),
    /** Intent flags shape: { informational, transactional, commercial, navigational, branded } */
    ahrefsIntentFlags: jsonb("ahrefs_intent_flags").default({}),
    ahrefsCpc: numeric("ahrefs_cpc", { precision: 10, scale: 2 }),
    ahrefsLastUpdated: timestamp("ahrefs_last_updated", { withTimezone: true }),
    /** true if Ahrefs classified this keyword as branded (is_branded = true). Hard-drops to P3. */
    isBranded: boolean("is_branded").notNull().default(false),
    /** true if this keyword is in the top 20% by sum_traffic × cpc across the non-branded corpus. */
    isHighValueTarget: boolean("is_high_value_target").notNull().default(false),
    /** Original priority value before the Ahrefs import overwrote it. Audit trail only. */
    priorityPreAhrefsImport: text("priority_pre_ahrefs_import"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("keywords_brand_id_idx").on(t.brandId),
    index("keywords_brand_list_idx").on(t.brandId, t.listId),
    index("keywords_location_idx").on(t.locationId),
    unique("keywords_brand_text_location_uq").on(
      t.brandId,
      t.keywordText,
      t.locationId,
    ),
    check(
      "keywords_priority_check",
      sql`${t.priority} IS NULL OR ${t.priority} IN ('P0', 'P1', 'P2', 'P3')`,
    ),
  ],
);

export type Keyword = typeof keywordsTable.$inferSelect;
export type InsertKeyword = typeof keywordsTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* crawl_batches — metadata for a single crawl run                             */
/* -------------------------------------------------------------------------- */

/** Allowed values for `crawl_batches.status`. */
export const CRAWL_BATCH_STATUSES = [
  "pending",
  "running",
  "complete",
  "failed",
] as const;
export type CrawlBatchStatus = (typeof CRAWL_BATCH_STATUSES)[number];

export const crawlBatchesTable = pgTable(
  "crawl_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("pending"),
    keywordCount: integer("keyword_count").notNull().default(0),
    completedCount: integer("completed_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("crawl_batches_brand_status_idx").on(
      t.brandId,
      t.status,
      t.createdAt.desc(),
    ),
  ],
);

export type CrawlBatch = typeof crawlBatchesTable.$inferSelect;
export type InsertCrawlBatch = typeof crawlBatchesTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* crawl_schedules — recurring rank-check schedules                            */
/* -------------------------------------------------------------------------- */
export const crawlSchedulesTable = pgTable(
  "crawl_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    // null `list_id` means "all keywords for the brand".
    listId: uuid("list_id").references(() => keywordListsTable.id, {
      onDelete: "set null",
    }),
    cronExpression: text("cron_expression").notNull(),
    active: boolean("active").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("crawl_schedules_brand_active_idx").on(t.brandId, t.active),
    index("crawl_schedules_list_idx").on(t.listId),
    index("crawl_schedules_next_run_idx")
      .on(t.nextRunAt)
      .where(sql`active = true`),
  ],
);

export type CrawlSchedule = typeof crawlSchedulesTable.$inferSelect;
export type InsertCrawlSchedule = typeof crawlSchedulesTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* rank_snapshots — point-in-time ranking results                              */
/* -------------------------------------------------------------------------- */
export const rankSnapshotsTable = pgTable(
  "rank_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    keywordId: uuid("keyword_id")
      .notNull()
      .references(() => keywordsTable.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locationsTable.id, { onDelete: "restrict" }),
    batchId: uuid("batch_id").references(() => crawlBatchesTable.id, {
      onDelete: "set null",
    }),
    position: integer("position"),
    url: text("url"),
    foundAtPosition: boolean("found_at_position").notNull().default(false),
    serpFeatures: jsonb("serp_features").notNull().default({}),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("rank_snapshots_keyword_location_idx").on(
      t.keywordId,
      t.locationId,
      t.capturedAt.desc(),
    ),
    index("rank_snapshots_brand_captured_idx").on(t.brandId, t.capturedAt.desc()),
    index("rank_snapshots_batch_idx").on(t.batchId),
  ],
);

export type RankSnapshot = typeof rankSnapshotsTable.$inferSelect;
export type InsertRankSnapshot = typeof rankSnapshotsTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* competitor_pages — competitor URLs surfaced from SERP data                  */
/* -------------------------------------------------------------------------- */
export const competitorPagesTable = pgTable(
  "competitor_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    competitorDomain: text("competitor_domain").notNull(),
    url: text("url").notNull(),
    keywordId: uuid("keyword_id").references(() => keywordsTable.id, {
      onDelete: "cascade",
    }),
    position: integer("position"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("competitor_pages_brand_domain_idx").on(t.brandId, t.competitorDomain),
    index("competitor_pages_keyword_idx").on(t.keywordId),
  ],
);

export type CompetitorPage = typeof competitorPagesTable.$inferSelect;
export type InsertCompetitorPage = typeof competitorPagesTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* competitor_insights — aggregated competitor intelligence                    */
/* -------------------------------------------------------------------------- */
export const competitorInsightsTable = pgTable(
  "competitor_insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    competitorDomain: text("competitor_domain").notNull(),
    sharedKeywordCount: integer("shared_keyword_count").notNull().default(0),
    averagePosition: numeric("average_position", { precision: 6, scale: 2 }),
    topKeywords: jsonb("top_keywords").notNull().default([]),
    lastComputedAt: timestamp("last_computed_at", { withTimezone: true }),
    // SEO Dashboard migration columns
    dateCaptured: timestamp("date_captured", { withTimezone: true }),
    aboveUsKeywordCount: integer("above_us_keyword_count").default(0),
    authorityScore: numeric("authority_score", { precision: 5, scale: 2 }),
    pressureIndex: numeric("pressure_index", { precision: 6, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("competitor_insights_brand_domain_uq").on(t.brandId, t.competitorDomain),
    index("competitor_insights_brand_id_idx").on(t.brandId),
  ],
);

export type CompetitorInsight = typeof competitorInsightsTable.$inferSelect;
export type InsertCompetitorInsight = typeof competitorInsightsTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* blacklisted_domains — domains excluded from competitor discovery            */
/* -------------------------------------------------------------------------- */
export const blacklistedDomainsTable = pgTable(
  "blacklisted_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    domain: text("domain").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("blacklisted_domains_brand_domain_uq").on(t.brandId, t.domain),
  ],
);

export type BlacklistedDomain = typeof blacklistedDomainsTable.$inferSelect;
export type InsertBlacklistedDomain = typeof blacklistedDomainsTable.$inferInsert;
