import { pgTable, uuid, text, timestamp, jsonb, foreignKey } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { brandsTable } from "./brands";

export const outlinesTable = pgTable("outlines", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .unique()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id").notNull().references(() => brandsTable.id, { onDelete: "restrict" }),
  h1: text("h1"),
  metaDescription: text("meta_description"),
  sections: jsonb("sections").notNull().default([]),
  internalLinks: jsonb("internal_links").notNull().default([]),
  ctaPlacement: text("cta_placement"),
  toneReminder: text("tone_reminder"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "outlines_project_same_brand_fk",
    columns: [t.projectId, t.brandId],
    foreignColumns: [projectsTable.id, projectsTable.brandId],
  }),
]);

export type Outline = typeof outlinesTable.$inferSelect;
