import { pgTable, uuid, text, timestamp, integer, numeric, boolean, jsonb } from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";
import { projectsTable } from "./projects";

export const draftsTable = pgTable("drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id").references(() => brandsTable.id, { onDelete: "restrict" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  sectionId: text("section_id").notNull(),
  sectionHeading: text("section_heading"),
  content: text("content"),
  approved: boolean("approved").notNull().default(false),
  voiceMatchScore: numeric("voice_match_score"),
  voiceFlags: jsonb("voice_flags"),
  dismissedVoiceFlags: jsonb("dismissed_voice_flags"),
  reviewQuestions: jsonb("review_questions"),
  citationCount: integer("citation_count"),
  revisionCount: integer("revision_count").notNull().default(0),
  aiCitationReadinessScore: numeric("ai_citation_readiness_score"),
  atomicChunksCount: integer("atomic_chunks_count"),
  entityDensityScore: numeric("entity_density_score"),
  schemaMarkupRecommendations: jsonb("schema_markup_recommendations"),
  lastEditedBy: text("last_edited_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Draft = typeof draftsTable.$inferSelect;
