import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";

/**
 * Sprint 1 audit_log. Cross-brand admin-sensitive actions land here
 * with a non-empty justification. brand_id is nullable on purpose
 * (system-level actions). NOT brand-scoped — the worker writes
 * directly via the raw transaction handle inside `withBrandScope`,
 * exactly like the events table.
 */
export const auditLogTable = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").references(() => brandsTable.id, { onDelete: "set null" }),
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
  ],
);

export type AuditLog = typeof auditLogTable.$inferSelect;
export type InsertAuditLog = typeof auditLogTable.$inferInsert;
