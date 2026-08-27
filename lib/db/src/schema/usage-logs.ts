import { pgTable, uuid, text, timestamp, integer, numeric, boolean, index } from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";

export const usageLogsTable = pgTable(
  "usage_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id"),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    stage: text("stage"),
    subStage: text("sub_stage"),
    model: text("model").notNull(),
    metadataUserId: text("metadata_user_id"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheCreationInputTokens: integer("cache_creation_input_tokens").notNull().default(0),
    cacheReadInputTokens: integer("cache_read_input_tokens").notNull().default(0),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6 }),
    durationMs: integer("duration_ms"),
    ok: boolean("ok").notNull().default(true),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_logs_brand_created_idx").on(t.brandId, t.createdAt.desc())],
);

export type UsageLog = typeof usageLogsTable.$inferSelect;
