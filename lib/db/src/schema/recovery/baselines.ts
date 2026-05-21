import {
  pgTable,
  uuid,
  text,
  date,
  numeric,
  integer,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { brandsTable } from "../brands";

/**
 * One row per brand. Locks the pre-October-2025 baseline metrics for
 * the Recovery War Room. UNIQUE per brand — only one baseline per
 * brand ever.
 *
 * Column names in the DB use the short form (avg_position_30d, etc.)
 * rather than the baseline_ prefix — the table name is already
 * recovery_baselines, so the prefix is redundant.
 *
 * GSC and GA4 columns are NULLABLE until those ingestion pipelines
 * land. Position + top-N columns sourced from rank_snapshots are
 * NOT NULL — that data is already available.
 *
 * locked_by stores a Clerk user ID (text), not a UUID.
 */
export const recoveryBaselinesTable = pgTable(
  "recovery_baselines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    baselineDate: date("baseline_date").notNull(),

    baselineGscClicksDaily: numeric("gsc_clicks_30d_avg"),
    baselineGa4SessionsDaily: numeric("ga4_sessions_30d_avg"),
    baselineAvgPosition: numeric("avg_position_30d").notNull(),
    baselineKeywordsInTop10: integer("keywords_in_top_10").notNull(),
    baselineKeywordsInTop3: integer("keywords_in_top_3").notNull(),

    lockedAt: timestamp("locked_at", { withTimezone: true }).notNull().defaultNow(),
    lockedBy: text("locked_by").notNull(),
    notes: text("notes"),
  },
  (t) => [
    unique("recovery_baselines_brand_id_key").on(t.brandId),
    index("recovery_baselines_brand_id_idx").on(t.brandId),
  ],
);

export type RecoveryBaseline = typeof recoveryBaselinesTable.$inferSelect;
export type InsertRecoveryBaseline = typeof recoveryBaselinesTable.$inferInsert;
