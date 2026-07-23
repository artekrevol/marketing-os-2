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
} from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";
import { projectsTable } from "./projects";

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
