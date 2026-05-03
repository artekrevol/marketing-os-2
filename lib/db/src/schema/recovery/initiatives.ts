import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { brandsTable } from "../brands";

/**
 * Manually logged recovery work. Brand-scoped (Pattern A). RLS: read
 * and write follow the standard `is_admin() OR brand_access` shape;
 * lead/admin role enforcement happens at the service layer.
 *
 * `type` enum and `status` enum are enforced as SQL CHECK constraints
 * in the migration. Mirror the values here when validating input in
 * the service layer.
 */
export const recoveryInitiativesTable = pgTable(
  "recovery_initiatives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),

    name: text("name").notNull(),
    type: text("type").notNull(),
    description: text("description"),

    expectedImpactPct: numeric("expected_impact_pct"),
    expectedImpactClicks: integer("expected_impact_clicks"),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    status: text("status").notNull().default("active"),

    actualImpactClicks14d: integer("actual_impact_clicks_14d"),

    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("recovery_initiatives_brand_status_started_idx").on(
      t.brandId,
      t.status,
      t.startedAt.desc(),
    ),
    index("recovery_initiatives_brand_id_idx").on(t.brandId),
  ],
);

/** Allowed values for `recovery_initiatives.type` (mirrors the SQL CHECK). */
export const RECOVERY_INITIATIVE_TYPES = [
  "content_refresh",
  "content_kill",
  "content_consolidation",
  "technical_fix",
  "link_building",
  "quality_gate",
  "other",
] as const;
export type RecoveryInitiativeType = (typeof RECOVERY_INITIATIVE_TYPES)[number];

/** Allowed values for `recovery_initiatives.status` (mirrors the SQL CHECK). */
export const RECOVERY_INITIATIVE_STATUSES = [
  "active",
  "completed",
  "abandoned",
] as const;
export type RecoveryInitiativeStatus = (typeof RECOVERY_INITIATIVE_STATUSES)[number];

export type RecoveryInitiative = typeof recoveryInitiativesTable.$inferSelect;
export type InsertRecoveryInitiative = typeof recoveryInitiativesTable.$inferInsert;
