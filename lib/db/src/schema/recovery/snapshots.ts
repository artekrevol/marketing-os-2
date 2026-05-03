import {
  pgTable,
  uuid,
  date,
  numeric,
  integer,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { brandsTable } from "../brands";

/**
 * Daily roll-up of recovery metrics per brand, written by a nightly
 * worker job (Prompt 4). Brand-scoped (Pattern A). RLS: read =
 * standard; write = admin-only (the worker uses service_role and
 * bypasses RLS).
 *
 * `gap_to_baseline_top10_pct` is the rankings-based headline metric
 * the burn-down chart projects on (amendments §D.4). The clicks-based
 * gap stays in the schema as nullable for the future GSC pipeline.
 */
export const recoverySnapshotsTable = pgTable(
  "recovery_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    snapshotDate: date("snapshot_date").notNull(),

    gscClicks30dAvg: numeric("gsc_clicks_30d_avg"),
    ga4Sessions30dAvg: numeric("ga4_sessions_30d_avg"),
    avgPosition30d: numeric("avg_position_30d").notNull(),
    keywordsInTop10: integer("keywords_in_top_10").notNull(),
    keywordsInTop3: integer("keywords_in_top_3").notNull(),

    gapToBaselineClicksPct: numeric("gap_to_baseline_clicks_pct"),
    gapToBaselinePosition: numeric("gap_to_baseline_position"),
    gapToBaselineTop10Pct: numeric("gap_to_baseline_top10_pct"),

    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("recovery_snapshots_brand_date_uq").on(t.brandId, t.snapshotDate),
    index("recovery_snapshots_brand_date_idx").on(t.brandId, t.snapshotDate.desc()),
    index("recovery_snapshots_brand_id_idx").on(t.brandId),
  ],
);

export type RecoverySnapshot = typeof recoverySnapshotsTable.$inferSelect;
export type InsertRecoverySnapshot = typeof recoverySnapshotsTable.$inferInsert;
