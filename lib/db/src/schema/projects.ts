import { pgTable, uuid, text, timestamp, integer } from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";

// Minimal projection of the Sprint 1 projects table. Only the columns the
// worker reads/writes. Added here so withBrandScope can register the
// table in BRAND_SCOPED_TABLES and so jobs can resolve brand_id from
// project_id when needed.
export const projectsTable = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brandsTable.id, { onDelete: "restrict" }),
  topic: text("topic").notNull(),
  contentType: text("content_type").notNull(),
  status: text("status").notNull().default("draft"),
  currentStage: integer("current_stage").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Project = typeof projectsTable.$inferSelect;
