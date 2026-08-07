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

/**
 * Weekly snapshots of competitor state for movement detection.
 * One row per (brand, competitor_domain, snapshot_week).
 * snapshot_week uses ISO week format YYYY-WW (e.g. "2026-30").
 */
export const competitorMovementsTable = pgTable(
  "competitor_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    competitorDomain: text("competitor_domain").notNull(),
    /** ISO week string: YYYY-WW */
    snapshotWeek: text("snapshot_week").notNull(),
    keywordsCommon: integer("keywords_common"),
    keywordsCommonDelta: integer("keywords_common_delta"),
    domainRating: numeric("domain_rating", { precision: 5, scale: 2 }),
    isNewThisWeek: boolean("is_new_this_week").notNull().default(false),
    isLostThisWeek: boolean("is_lost_this_week").notNull().default(false),
    sourceProvider: text("source_provider").notNull().default("dataforseo_labs"),
    sourceMetadata: jsonb("source_metadata").notNull().default({}),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("competitor_movements_brand_domain_week_uq").on(
      t.brandId,
      t.competitorDomain,
      t.snapshotWeek,
    ),
    index("competitor_movements_brand_week_idx").on(t.brandId, t.snapshotWeek),
    // Partial index (WHERE is_new_this_week = true) applied via DDL only.
    index("competitor_movements_new_idx").on(t.brandId, t.isNewThisWeek),
  ],
);

export type CompetitorMovement = typeof competitorMovementsTable.$inferSelect;
export type InsertCompetitorMovement = typeof competitorMovementsTable.$inferInsert;
