import { pgTable, uuid, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";
import { projectsTable } from "./projects";

/**
 * Read-only Drizzle mirror of the Sprint 1 `drafts` table. Only the
 * columns the QA worker reads (text body, version, project_id, brand_id)
 * are projected; the full canonical schema is owned by the Supabase
 * migrations and consumed by the frontend through supabase-js.
 */
export const draftsTable = pgTable("drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brandsTable.id, { onDelete: "restrict" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  bodyMd: text("body_md").notNull().default(""),
  bodyHtml: text("body_html"),
  wordCount: integer("word_count").notNull().default(0),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Draft = typeof draftsTable.$inferSelect;
