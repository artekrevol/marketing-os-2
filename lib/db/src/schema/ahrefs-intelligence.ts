import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  numeric,
  boolean,
  jsonb,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";

/**
 * Ahrefs Intelligence — bulk export ingest tables.
 *
 * Five tables populated from weekly manual XLSX uploads:
 *   ahrefs_import_batches  — one row per upload session (delta tracking)
 *   ahrefs_backlinks       — individual backlink rows (12K+ per export)
 *   ahrefs_anchors         — anchor text distribution (30K+)
 *   ahrefs_page_performance — per-page traffic snapshots (854 pages)
 *   ahrefs_content_gap     — keyword gap vs competitor (6K+)
 *
 * All tables are brand-scoped (Pattern A).
 */

/* -------------------------------------------------------------------------- */
/* ahrefs_import_batches — tracks each upload session for delta diffing       */
/* -------------------------------------------------------------------------- */
export const ahrefsImportBatchesTable = pgTable(
  "ahrefs_import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
    /** How many file types were present in this upload. */
    fileCount: integer("file_count").notNull().default(0),
    backlinkCount: integer("backlink_count").notNull().default(0),
    referringDomainCount: integer("referring_domain_count").notNull().default(0),
    anchorCount: integer("anchor_count").notNull().default(0),
    pageCount: integer("page_count").notNull().default(0),
    organicKeywordCount: integer("organic_keyword_count").notNull().default(0),
    contentGapCount: integer("content_gap_count").notNull().default(0),
    /** Delta vs previous batch — positive = gained, negative = lost. */
    deltaNewLinks: integer("delta_new_links"),
    deltaLostLinks: integer("delta_lost_links"),
    deltaNewGapKeywords: integer("delta_new_gap_keywords"),
    deltaPagesRecovered: integer("delta_pages_recovered"),
    deltaPagesCrashed: integer("delta_pages_crashed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ahrefs_import_batches_brand_idx").on(t.brandId, t.importedAt.desc()),
  ],
);

export type AhrefsImportBatch = typeof ahrefsImportBatchesTable.$inferSelect;
export type InsertAhrefsImportBatch = typeof ahrefsImportBatchesTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* ahrefs_backlinks — individual backlink rows from the Backlinks export      */
/* -------------------------------------------------------------------------- */
export const ahrefsBacklinksTable = pgTable(
  "ahrefs_backlinks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    importBatchId: uuid("import_batch_id").references(() => ahrefsImportBatchesTable.id, {
      onDelete: "set null",
    }),
    /** URL of the page linking to us. Natural key for upserts. */
    referringPageUrl: text("referring_page_url").notNull(),
    referringPageTitle: text("referring_page_title"),
    language: text("language"),
    platform: text("platform"),
    referringPageHttpCode: integer("referring_page_http_code"),
    /** Domain Rating of referring domain (0-100). */
    dr: numeric("dr", { precision: 5, scale: 2 }),
    /** URL Rating of referring page. */
    ur: numeric("ur", { precision: 5, scale: 2 }),
    /** Organic traffic to the referring domain (bigint: top domains exceed 2.1B). */
    domainTraffic: bigint("domain_traffic", { mode: "number" }),
    /** Organic traffic to the referring page. */
    pageTraffic: bigint("page_traffic", { mode: "number" }),
    /** Target URL on our site that is being linked to. */
    targetUrl: text("target_url"),
    /**
     * HTTP status of our target page as reported by the Ahrefs BrokenBacklinks
     * export ("Target page HTTP code").  Null for normal backlink rows.
     * Populated by the BrokenBacklinks file type ingestion.
     */
    targetHttpCode: integer("target_http_code"),
    anchor: text("anchor"),
    leftContext: text("left_context"),
    rightContext: text("right_context"),
    /** Link type: text, image, redirect, etc. */
    linkType: text("link_type"),
    isNofollow: boolean("is_nofollow").notNull().default(false),
    isSpam: boolean("is_spam").notNull().default(false),
    isUgc: boolean("is_ugc").notNull().default(false),
    isSponsored: boolean("is_sponsored").notNull().default(false),
    /** true = Ahrefs recorded this as a lost link. */
    isLost: boolean("is_lost").notNull().default(false),
    /** Why the link was lost (Ahrefs "Drop reason" column). */
    dropReason: text("drop_reason"),
    firstSeen: timestamp("first_seen", { withTimezone: true }),
    lastSeen: timestamp("last_seen", { withTimezone: true }),
    lostAt: timestamp("lost_at", { withTimezone: true }),
    pageType: text("page_type"),
    author: text("author"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ahrefs_backlinks_brand_url_uq").on(t.brandId, t.referringPageUrl),
    index("ahrefs_backlinks_brand_dr_idx").on(t.brandId, t.dr),
    index("ahrefs_backlinks_brand_lost_idx").on(t.brandId, t.isLost),
    index("ahrefs_backlinks_brand_spam_idx").on(t.brandId, t.isSpam),
    index("ahrefs_backlinks_brand_target_idx").on(t.brandId, t.targetUrl),
    index("ahrefs_backlinks_batch_idx").on(t.importBatchId),
  ],
);

export type AhrefsBacklink = typeof ahrefsBacklinksTable.$inferSelect;
export type InsertAhrefsBacklink = typeof ahrefsBacklinksTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* ahrefs_anchors — anchor text distribution from the Anchors export          */
/* -------------------------------------------------------------------------- */
export const ahrefsAnchorsTable = pgTable(
  "ahrefs_anchors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    importBatchId: uuid("import_batch_id").references(() => ahrefsImportBatchesTable.id, {
      onDelete: "set null",
    }),
    /** Anchor text string — natural key. */
    anchorText: text("anchor_text").notNull(),
    /** Number of referring domains using this anchor. */
    refDomainsCount: integer("ref_domains_count"),
    topDr: integer("top_dr"),
    refPagesCount: integer("ref_pages_count"),
    linksToTarget: integer("links_to_target"),
    newLinks: integer("new_links"),
    lostLinks: integer("lost_links"),
    dofollowLinks: integer("dofollow_links"),
    firstSeen: timestamp("first_seen", { withTimezone: true }),
    isLost: boolean("is_lost").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ahrefs_anchors_brand_text_uq").on(t.brandId, t.anchorText),
    index("ahrefs_anchors_brand_ref_domains_idx").on(t.brandId, t.refDomainsCount),
    index("ahrefs_anchors_batch_idx").on(t.importBatchId),
  ],
);

export type AhrefsAnchor = typeof ahrefsAnchorsTable.$inferSelect;
export type InsertAhrefsAnchor = typeof ahrefsAnchorsTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* ahrefs_page_performance — per-URL traffic from the TopPages export         */
/* -------------------------------------------------------------------------- */
export const ahrefsPagePerformanceTable = pgTable(
  "ahrefs_page_performance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    importBatchId: uuid("import_batch_id").references(() => ahrefsImportBatchesTable.id, {
      onDelete: "set null",
    }),
    /** Full page URL — natural key. */
    url: text("url").notNull(),
    /** 'Active', 'Lost', or 'New' — from Ahrefs status column. */
    status: text("status"),
    ur: numeric("ur", { precision: 5, scale: 2 }),
    prevTraffic: integer("prev_traffic"),
    currTraffic: integer("curr_traffic"),
    trafficChange: integer("traffic_change"),
    prevTrafficValue: numeric("prev_traffic_value", { precision: 12, scale: 2 }),
    currTrafficValue: numeric("curr_traffic_value", { precision: 12, scale: 2 }),
    currRefDomains: integer("curr_ref_domains"),
    prevKeywords: integer("prev_keywords"),
    currKeywords: integer("curr_keywords"),
    pageType: text("page_type"),
    prevTopKeyword: text("prev_top_keyword"),
    currTopKeyword: text("curr_top_keyword"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ahrefs_page_perf_brand_url_uq").on(t.brandId, t.url),
    index("ahrefs_page_perf_brand_change_idx").on(t.brandId, t.trafficChange),
    index("ahrefs_page_perf_brand_status_idx").on(t.brandId, t.status),
    index("ahrefs_page_perf_batch_idx").on(t.importBatchId),
  ],
);

export type AhrefsPagePerformance = typeof ahrefsPagePerformanceTable.$inferSelect;
export type InsertAhrefsPagePerformance = typeof ahrefsPagePerformanceTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* ahrefs_content_gap — keyword gap vs competitors (ContentGap export)        */
/* -------------------------------------------------------------------------- */
export const ahrefsContentGapTable = pgTable(
  "ahrefs_content_gap",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    importBatchId: uuid("import_batch_id").references(() => ahrefsImportBatchesTable.id, {
      onDelete: "set null",
    }),
    /** Gap keyword text — natural key (with competitor). */
    keyword: text("keyword").notNull(),
    /** Ahrefs intent tags, e.g. ['Informational', 'Commercial']. */
    intents: text("intents").array(),
    volume: integer("volume"),
    kd: integer("kd"),
    cpc: numeric("cpc", { precision: 10, scale: 2 }),
    /** Our current URL for this keyword (null = we don't rank). */
    ourUrl: text("our_url"),
    ourPosition: integer("our_position"),
    ourTraffic: integer("our_traffic"),
    /** Competitor domain this gap was detected against. */
    competitorDomain: text("competitor_domain").notNull(),
    competitorUrl: text("competitor_url"),
    competitorPosition: integer("competitor_position"),
    competitorTraffic: integer("competitor_traffic"),
    /**
     * Priority score = round(volume × (1 − kd/100)).
     * Stored for fast sorting; recomputed on import.
     */
    priorityScore: integer("priority_score"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ahrefs_content_gap_brand_kw_comp_uq").on(t.brandId, t.keyword, t.competitorDomain),
    index("ahrefs_content_gap_brand_priority_idx").on(t.brandId, t.priorityScore),
    index("ahrefs_content_gap_brand_volume_idx").on(t.brandId, t.volume),
    index("ahrefs_content_gap_batch_idx").on(t.importBatchId),
  ],
);

export type AhrefsContentGap = typeof ahrefsContentGapTable.$inferSelect;

/* -------------------------------------------------------------------------- */
/* ahrefs_raw_snapshots — GCS-backed snapshot store for the two-step upload   */
/*                                                                             */
/* Step 1 (HTTP): XLSX files are stored in GCS one-at-a-time, organised by    */
/*   month ("2026-07"). No parsing happens during upload.                     */
/* Step 2 (BullMQ): worker downloads files, parses, upserts intelligence     */
/*   tables, and marks the snapshot 'done'.                                   */
/*                                                                             */
/* Historical snapshots remain in GCS indefinitely and can be re-ingested.   */
/* -------------------------------------------------------------------------- */
export const ahrefsRawSnapshotsTable = pgTable(
  "ahrefs_raw_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    /** "2026-07" — month label used as the GCS folder name. */
    snapshotMonth: text("snapshot_month").notNull(),
    /** pending → ingesting → done | error */
    status: text("status").notNull().default("pending"),
    /** [{name, objectName, size}] — one entry per uploaded XLSX file. */
    filePaths: jsonb("file_paths")
      .$type<Array<{ name: string; objectName: string; size: number }>>()
      .notNull()
      .default([]),
    /** Set once ingestion completes — FK to the created import batch. */
    batchId: uuid("batch_id").references(() => ahrefsImportBatchesTable.id, {
      onDelete: "set null",
    }),
    errorMessage: text("error_message"),
    /** {backlinks, referringDomains, anchors, …} row counts from the ingest run. */
    rowCounts: jsonb("row_counts").$type<Record<string, number>>(),
    fileCount: integer("file_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    ingestStartedAt: timestamp("ingest_started_at", { withTimezone: true }),
    ingestCompletedAt: timestamp("ingest_completed_at", { withTimezone: true }),
  },
  (t) => [
    index("ahrefs_raw_snapshots_brand_month_idx").on(t.brandId, t.snapshotMonth),
    index("ahrefs_raw_snapshots_status_idx").on(t.status),
  ],
);

export type AhrefsRawSnapshot = typeof ahrefsRawSnapshotsTable.$inferSelect;
export type InsertAhrefsRawSnapshot = typeof ahrefsRawSnapshotsTable.$inferInsert;
export type InsertAhrefsContentGap = typeof ahrefsContentGapTable.$inferInsert;
