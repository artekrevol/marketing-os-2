import { pgTable, uuid, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const playbookTable = pgTable("playbook", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: integer("version").notNull().default(1),
  contentMarkdown: text("content_markdown").notNull().default(""),
  sourceFilename: text("source_filename"),
  uploadedBy: text("uploaded_by"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const playbookSectionsTable = pgTable("playbook_sections", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: integer("version").notNull().default(1),
  sectionNumber: integer("section_number").notNull(),
  sectionTitle: text("section_title").notNull(),
  sectionContent: text("section_content").notNull(),
  sectionTokenEstimate: integer("section_token_estimate").notNull().default(0),
  alwaysInclude: boolean("always_include").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlaybookRow = typeof playbookTable.$inferSelect;
export type PlaybookSectionRow = typeof playbookSectionsTable.$inferSelect;
