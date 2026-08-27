import { pgTable, uuid, text, timestamp, jsonb, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { brandsTable } from "./brands";

export const TELEMETRY_SCOPES = ["brand", "global"] as const;
export type TelemetryScope = (typeof TELEMETRY_SCOPES)[number];

// Brand/product events always carry brand_id. Platform-health events may be
// global, but must say so explicitly instead of relying on a bare NULL.
export const eventsTable = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").references(() => brandsTable.id, { onDelete: "restrict" }),
    scope: text("scope").notNull().default("brand"),
    actorId: uuid("actor_id"),
    eventType: text("event_type").notNull(),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("events_brand_created_idx").on(t.brandId, t.createdAt.desc()),
    index("events_subject_idx").on(t.subjectType, t.subjectId),
    index("events_type_created_idx").on(t.eventType, t.createdAt.desc()),
    check(
      "events_scope_brand_consistency",
      sql`(${t.scope} = 'brand' and ${t.brandId} is not null) or (${t.scope} = 'global' and ${t.brandId} is null)`,
    ),
  ],
);

export type Event = typeof eventsTable.$inferSelect;
export type InsertEvent = typeof eventsTable.$inferInsert;
