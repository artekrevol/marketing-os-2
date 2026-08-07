import {
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  numeric,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";

/**
 * Cost and call tracking for DataForSEO Labs API calls.
 * Parallel to ahrefs_rest_usage — one row per Labs API call.
 * dispatch_context identifies the weekly job run that triggered the call.
 */
export const dataforSEOLabsUsageTable = pgTable(
  "dataforseo_labs_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    calledAt: timestamp("called_at", { withTimezone: true }).notNull().defaultNow(),
    endpoint: text("endpoint").notNull(),
    paramsHash: text("params_hash").notNull(),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    itemsReturned: integer("items_returned"),
    responseStatus: text("response_status").notNull(),
    errorMessage: text("error_message"),
    /** Identifies the weekly run: e.g. "discovery_week_2026-30_related_keywords" */
    dispatchContext: varchar("dispatch_context", { length: 120 }),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (t) => [
    index("dataforseo_labs_usage_brand_called_idx").on(t.brandId, t.calledAt),
    // Partial index (WHERE dispatch_context IS NOT NULL) applied via DDL only.
    index("dataforseo_labs_usage_dispatch_idx").on(t.dispatchContext),
  ],
);

export type DataForSEOLabsUsage = typeof dataforSEOLabsUsageTable.$inferSelect;
export type InsertDataForSEOLabsUsage = typeof dataforSEOLabsUsageTable.$inferInsert;
