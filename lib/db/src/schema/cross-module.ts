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
import { projectsTable } from "./projects";
import { keywordsTable, locationsTable } from "./seo";
import { userProfilesTable } from "./user-profiles";

/**
 * Shared Data Layer — cross-module bridge tables connecting ContentForge
 * (projects/articles) and SEO OS (keywords/rankings).
 *
 * Design principles for every cross-module read built on these tables:
 *  1. Never throw on missing data — absence is a valid, expected state.
 *  2. Empty states are explicit, not silent.
 *  3. Every cross-module read carries attribution (see module_data_provenance).
 *  4. Staleness is data, not an error.
 *
 * All three tables are brand-scoped (Pattern A): a `brand_id` FK to
 * `brands` with `onDelete: "restrict"`, snake_case columns, and an entry
 * in `BRAND_SCOPED_TABLES` (lib/db/src/brand-scope.ts).
 *
 * FK note: `requested_by` / `source_user_id` reference
 * `user_profiles.user_id` (the PK is `user_id`, a text Clerk id — NOT a
 * uuid `id` column).
 */

/* -------------------------------------------------------------------------- */
/* content_url_keyword_link — the core bridge (project-level)                  */
/* -------------------------------------------------------------------------- */
export const contentUrlKeywordLinkTable = pgTable(
  "content_url_keyword_link",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    keywordId: uuid("keyword_id")
      .notNull()
      .references(() => keywordsTable.id, { onDelete: "restrict" }),
    attachedAt: timestamp("attached_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // 'auto' (system auto-link on publish) | a user_profiles.user_id
    attachedBy: text("attached_by").notNull(),
    isCanonical: boolean("is_canonical").notNull().default(true),
  },
  (t) => [
    unique("content_url_keyword_link_project_keyword_uq").on(
      t.projectId,
      t.keywordId,
    ),
    index("cukl_brand_idx").on(t.brandId),
    index("cukl_keyword_idx").on(t.keywordId),
    index("cukl_project_idx").on(t.projectId),
  ],
);

export type ContentUrlKeywordLink =
  typeof contentUrlKeywordLinkTable.$inferSelect;
export type InsertContentUrlKeywordLink =
  typeof contentUrlKeywordLinkTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* keyword_research_briefs — context snapshots for keyword research requests   */
/* -------------------------------------------------------------------------- */
export const keywordResearchBriefsTable = pgTable(
  "keyword_research_briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").references(() => projectsTable.id, {
      onDelete: "set null",
    }),
    keywordText: text("keyword_text").notNull(),
    locationId: uuid("location_id").references(() => locationsTable.id, {
      onDelete: "set null",
    }),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    contextSnapshot: jsonb("context_snapshot").notNull().default({}),
    requestedBy: text("requested_by").references(
      () => userProfilesTable.userId,
      { onDelete: "set null" },
    ),
  },
  (t) => [
    index("krb_brand_keyword_idx").on(t.brandId, t.keywordText),
    index("krb_project_idx").on(t.projectId),
  ],
);

export type KeywordResearchBrief =
  typeof keywordResearchBriefsTable.$inferSelect;
export type InsertKeywordResearchBrief =
  typeof keywordResearchBriefsTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* module_data_provenance — attribution telemetry for cross-module data        */
/* -------------------------------------------------------------------------- */
export const moduleDataProvenanceTable = pgTable(
  "module_data_provenance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    // 'keyword' | 'rank_snapshot' | 'content_url_keyword_link' | ...
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    // 'content-forge' | 'seo-os' | 'system'
    sourceModule: text("source_module").notNull(),
    sourceUserId: text("source_user_id").references(
      () => userProfilesTable.userId,
      { onDelete: "set null" },
    ),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // 'manual' | 'crawl' | 'auto-link' | ...
    generationMethod: text("generation_method").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (t) => [
    index("mdp_entity_idx").on(t.entityType, t.entityId),
    index("mdp_brand_idx").on(t.brandId),
  ],
);

export type ModuleDataProvenance =
  typeof moduleDataProvenanceTable.$inferSelect;
export type InsertModuleDataProvenance =
  typeof moduleDataProvenanceTable.$inferInsert;
