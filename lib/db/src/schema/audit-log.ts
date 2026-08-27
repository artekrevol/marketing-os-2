import { pgTable, uuid, text, timestamp, jsonb, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { brandsTable } from "./brands";

/**
 * Admin-sensitive actions. Brand actions always carry brand_id. Explicit
 * global rows are reserved for platform administration/system activity.
 */
export const auditLogTable = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").references(() => brandsTable.id, { onDelete: "restrict" }),
    scope: text("scope").notNull().default("brand"),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    justification: text("justification").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_created_idx").on(t.createdAt.desc()),
    index("audit_log_actor_idx").on(t.actorId, t.createdAt.desc()),
    index("audit_log_brand_created_idx").on(t.brandId, t.createdAt.desc()),
    check(
      "audit_log_scope_brand_consistency",
      sql`(${t.scope} = 'brand' and ${t.brandId} is not null) or (${t.scope} = 'global' and ${t.brandId} is null)`,
    ),
  ],
);

export type AuditLog = typeof auditLogTable.$inferSelect;
export type InsertAuditLog = typeof auditLogTable.$inferInsert;
