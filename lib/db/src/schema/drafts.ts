import { pgTable, uuid, text, timestamp, integer, numeric, boolean, jsonb, unique, foreignKey } from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";
import { projectsTable } from "./projects";

export const draftsTable = pgTable(
  "drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brandsTable.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    sectionId: text("section_id").notNull(),
    sectionHeading: text("section_heading"),
    content: text("content"),
    approved: boolean("approved").notNull().default(false),
    voiceMatchScore: numeric("voice_match_score"),
    voiceFlags: jsonb("voice_flags"),
    dismissedVoiceFlags: jsonb("dismissed_voice_flags").notNull().default([]),
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
  },
  (t) => [
    foreignKey({
      name: "drafts_project_same_brand_fk",
      columns: [t.projectId, t.brandId],
      foreignColumns: [projectsTable.id, projectsTable.brandId],
    }),
    // One draft per (project, section). Required so the upsert in
    // /api/ai/draft-section's onConflictDoUpdate has a real conflict
    // target — without this Postgres throws
    // "there is no unique or exclusion constraint matching the
    // ON CONFLICT specification" and every draft attempt returns 500.
    unique("drafts_project_section_unique").on(t.projectId, t.sectionId),
  ],
);

export type Draft = typeof draftsTable.$inferSelect;
