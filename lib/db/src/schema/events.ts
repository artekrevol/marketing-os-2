import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";

// Sprint 1 events table. brand_id is nullable because system-level events
// (worker heartbeats, dead-letter handler writes) are cross-brand.
export const eventsTable = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").references(() => brandsTable.id, { onDelete: "set null" }),
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
  ],
);

export type Event = typeof eventsTable.$inferSelect;
export type InsertEvent = typeof eventsTable.$inferInsert;
