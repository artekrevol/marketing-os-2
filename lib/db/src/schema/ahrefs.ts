import { sql } from "drizzle-orm";
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
import { projectsTable } from "./projects";

/**
 * Ahrefs REST Bulk Import — referring domains corpus and per-call usage tracking.
 *
 * referring_domains  — per-domain backlink profile for a brand target (seeded from bulk pull)
 * ahrefs_rest_usage  — every REST API call logged with unit consumption and dispatch context
 */

/**
 * Ahrefs MCP Integration — cache and usage tracking tables.
 * Both tables are brand-scoped (Pattern A): a `brand_id` FK to `brands`
 * with `onDelete: "restrict"`, snake_case column names, and entries in
 * `BRAND_SCOPED_TABLES` (lib/db/src/brand-scope.ts).
 *
 * domain_authority_cache  — persistent DR/UR cache, 7-day staleness threshold
 * ahrefs_mcp_usage        — per-call unit consumption log for budget tracking
 */

/* -------------------------------------------------------------------------- */
/* domain_authority_cache — DR/UR cache for citation authority checks         */
/* -------------------------------------------------------------------------- */
export const domainAuthorityCacheTable = pgTable(
  "domain_authority_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    domain: text("domain").notNull(),
    dr: numeric("dr", { precision: 5, scale: 2 }),
    ur: numeric("ur", { precision: 5, scale: 2 }),
    refDomainsCount: integer("ref_domains_count"),
    backlinksCount: integer("backlinks_count"),
    lastMeasured: timestamp("last_measured", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sourceProvider: text("source_provider").notNull().default("ahrefs_mcp"),
    sourceMetadata: jsonb("source_metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("domain_authority_cache_brand_domain_idx").on(t.brandId, t.domain),
    index("domain_authority_cache_last_measured_idx").on(t.lastMeasured),
    unique("domain_authority_cache_brand_domain_uq").on(t.brandId, t.domain),
  ],
);

export type DomainAuthorityCache =
  typeof domainAuthorityCacheTable.$inferSelect;
export type InsertDomainAuthorityCache =
  typeof domainAuthorityCacheTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* ahrefs_mcp_usage — per-call unit consumption and cache-hit log             */
/* -------------------------------------------------------------------------- */
export const ahrefsMcpUsageTable = pgTable(
  "ahrefs_mcp_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    calledAt: timestamp("called_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    toolName: text("tool_name").notNull(),
    paramsHash: text("params_hash").notNull(),
    cacheHit: boolean("cache_hit").notNull().default(false),
    unitsConsumed: integer("units_consumed").notNull().default(0),
    responseStatus: text("response_status").notNull(),
    errorMessage: text("error_message"),
    projectId: uuid("project_id").references(() => projectsTable.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (t) => [
    index("ahrefs_mcp_usage_brand_called_idx").on(t.brandId, t.calledAt),
    index("ahrefs_mcp_usage_project_idx").on(t.projectId),
  ],
);

export type AhrefsMcpUsage = typeof ahrefsMcpUsageTable.$inferSelect;
export type InsertAhrefsMcpUsage = typeof ahrefsMcpUsageTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* referring_domains — per-domain backlink profile (seeded by bulk pull)      */
/* -------------------------------------------------------------------------- */
export const referringDomainsTable = pgTable(
  "referring_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    domain: text("domain").notNull(),
    /** Domain Rating (0-100). From Ahrefs domain_rating field. */
    dr: numeric("dr", { precision: 5, scale: 2 }),
    /** URL Rating — not available on refdomains endpoint; populated via MCP spot-checks. */
    ur: numeric("ur", { precision: 5, scale: 2 }),
    /** Total links pointing to the target (links_to_target). */
    backlinksCount: integer("backlinks_count"),
    /** Referring domains count of the referring domain itself (dofollow_refdomains). */
    linkedDomains: integer("linked_domains"),
    /** Dofollow links from this domain to the target. */
    dofollowLinks: integer("dofollow_links"),
    /** true if Ahrefs' last_seen is not null (domain stopped linking). Derived at import. */
    isLost: boolean("is_lost").notNull().default(false),
    /** true if Ahrefs classified this as a spam domain. */
    isSpam: boolean("is_spam").notNull().default(false),
    /** true if the referring entity is a root domain (vs. subdomain). */
    isRootDomain: boolean("is_root_domain").notNull().default(true),
    /** Organic search traffic to the referring domain (Ahrefs estimate). Bigint: top domains (Wikipedia) exceed 4B. */
    trafficDomain: bigint("traffic_domain", { mode: "number" }),
    firstSeen: timestamp("first_seen", { withTimezone: true }),
    lastSeen: timestamp("last_seen", { withTimezone: true }),
    sourceProvider: text("source_provider").notNull().default("ahrefs_bulk_import"),
    sourceMetadata: jsonb("source_metadata").notNull().default({}),
    ahrefsLastUpdated: timestamp("ahrefs_last_updated", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("referring_domains_brand_domain_uq").on(t.brandId, t.domain),
    index("referring_domains_brand_dr_idx").on(t.brandId, t.dr),
    index("referring_domains_brand_lost_idx").on(t.brandId, t.isLost),
  ],
);

export type ReferringDomain = typeof referringDomainsTable.$inferSelect;
export type InsertReferringDomain = typeof referringDomainsTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* ahrefs_best_by_links — top pages ranked by referring-domain count         */
/* -------------------------------------------------------------------------- */
export const ahrefsBestByLinksTable = pgTable(
  "ahrefs_best_by_links",
  {
    id:            uuid("id").primaryKey().defaultRandom(),
    brandId:       uuid("brand_id").notNull().references(() => brandsTable.id, { onDelete: "restrict" }),
    pageUrl:       text("page_url").notNull(),
    pageTitle:     text("page_title"),
    language:      text("language"),
    platform:      text("platform"),
    ur:            numeric("ur", { precision: 5, scale: 2 }),
    refDomains:    integer("ref_domains"),
    topDr:         integer("top_dr"),
    linksToTarget: integer("links_to_target"),
    newLinks:      integer("new_links"),
    lostLinks:     integer("lost_links"),
    dofollowLinks: integer("dofollow_links"),
    nofollowLinks: integer("nofollow_links"),
    redirectLinks: integer("redirect_links"),
    pageHttpCode:  integer("page_http_code"),
    firstSeen:     timestamp("first_seen", { withTimezone: true }),
    lastSeen:      timestamp("last_seen", { withTimezone: true }),
    createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ahrefs_best_by_links_brand_url_uq").on(t.brandId, t.pageUrl),
    index("ahrefs_best_by_links_brand_idx").on(t.brandId),
    index("ahrefs_best_by_links_ref_domains_idx").on(t.brandId, t.refDomains),
  ],
);

export type AhrefsBestByLinks = typeof ahrefsBestByLinksTable.$inferSelect;

/* -------------------------------------------------------------------------- */
/* ahrefs_rest_usage — REST API call log with unit consumption per dispatch   */
/* -------------------------------------------------------------------------- */
export const ahrefsRestUsageTable = pgTable(
  "ahrefs_rest_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    calledAt: timestamp("called_at", { withTimezone: true }).notNull().defaultNow(),
    endpoint: text("endpoint").notNull(),
    /** SHA-256 of endpoint + params for deduplication and cache lookup. */
    paramsHash: text("params_hash").notNull(),
    unitsConsumed: integer("units_consumed").notNull().default(0),
    responseStatus: text("response_status").notNull(),
    rowsReturned: integer("rows_returned"),
    errorMessage: text("error_message"),
    /** Tags each call with the phase that triggered it, e.g. bulk_pull_phase_3_organic_keywords. */
    dispatchContext: text("dispatch_context"),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (t) => [
    index("ahrefs_rest_usage_brand_called_idx").on(t.brandId, t.calledAt),
    index("ahrefs_rest_usage_dispatch_idx")
      .on(t.dispatchContext)
      .where(sql`${t.dispatchContext} IS NOT NULL`),
  ],
);

export type AhrefsRestUsage = typeof ahrefsRestUsageTable.$inferSelect;
export type InsertAhrefsRestUsage = typeof ahrefsRestUsageTable.$inferInsert;
