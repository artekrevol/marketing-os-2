import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  jsonb,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { brandsTable } from "./brands";

// Telemetry for outbound integration calls. Brand work is always attributed;
// platform health checks use scope='global' explicitly.
export const integrationCallLogTable = pgTable(
  "integration_call_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendor: text("vendor").notNull(),
    endpoint: text("endpoint").notNull(),
    status: text("status").notNull(), // 'ok' | 'error' | 'rate_limited' | 'timeout'
    httpStatus: integer("http_status"),
    durationMs: integer("duration_ms").notNull(),
    costEstimateUsd: numeric("cost_estimate_usd", { precision: 12, scale: 6 }),
    brandId: uuid("brand_id").references(() => brandsTable.id, { onDelete: "restrict" }),
    scope: text("scope").notNull().default("brand"),
    requestMeta: jsonb("request_meta").notNull().default({}),
    errorMessage: text("error_message"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("integration_call_log_occurred_idx").on(t.occurredAt.desc()),
    index("integration_call_log_vendor_idx").on(t.vendor, t.occurredAt.desc()),
    index("integration_call_log_brand_occurred_idx").on(t.brandId, t.occurredAt.desc()),
    check(
      "integration_call_log_scope_brand_consistency",
      sql`(${t.scope} = 'brand' and ${t.brandId} is not null) or (${t.scope} = 'global' and ${t.brandId} is null)`,
    ),
  ],
);

export type IntegrationCallLog = typeof integrationCallLogTable.$inferSelect;
export type InsertIntegrationCallLog = typeof integrationCallLogTable.$inferInsert;
