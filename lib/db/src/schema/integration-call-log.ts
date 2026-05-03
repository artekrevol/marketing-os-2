import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";

// Sprint 2 — telemetry for outbound integration calls. brand_id is
// nullable because some calls (system test buttons, cross-brand health
// pings) are not associated with a brand. Documented explicitly.
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
    brandId: uuid("brand_id").references(() => brandsTable.id, { onDelete: "set null" }),
    requestMeta: jsonb("request_meta").notNull().default({}),
    errorMessage: text("error_message"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("integration_call_log_occurred_idx").on(t.occurredAt.desc()),
    index("integration_call_log_vendor_idx").on(t.vendor, t.occurredAt.desc()),
  ],
);

export type IntegrationCallLog = typeof integrationCallLogTable.$inferSelect;
export type InsertIntegrationCallLog = typeof integrationCallLogTable.$inferInsert;
