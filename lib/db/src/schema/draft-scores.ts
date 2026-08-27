import { pgTable, uuid, text, timestamp, integer, numeric, jsonb, foreignKey } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { brandsTable } from "./brands";

export const draftScoresTable = pgTable("draft_scores", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .unique()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id").notNull().references(() => brandsTable.id, { onDelete: "restrict" }),
  finalDraft: text("final_draft"),
  voiceMatchScore: numeric("voice_match_score"),
  originalityScore: numeric("originality_score"),
  aiCitationReadinessScore: numeric("ai_citation_readiness_score"),
  citationCompleteness: numeric("citation_completeness"),
  atomicChunksCount: integer("atomic_chunks_count"),
  atomicQuestionsCount: integer("atomic_questions_count"),
  bannedPhraseCount: integer("banned_phrase_count"),
  wordCount: integer("word_count"),
  schemaMarkupRecommendations: jsonb("schema_markup_recommendations"),
  // --- Quality Fix Dispatch v2 (Phase 4/6) ---
  // The article-level structured schema extracted at final-stitch
  // (ARTICLE_TOOL output, after sanitization). Holds case_studies_cited,
  // testimonials_used, internal_links, statistics_used, etc.
  articleSchema: jsonb("article_schema"),
  // The Phase 6 validation result: every *_passes boolean plus the list of
  // stripped items and per-gate reasons. `validation.shippable` is the
  // overall hard-gate result surfaced in the review UI.
  validation: jsonb("validation"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "draft_scores_project_same_brand_fk",
    columns: [t.projectId, t.brandId],
    foreignColumns: [projectsTable.id, projectsTable.brandId],
  }),
]);

export type DraftScore = typeof draftScoresTable.$inferSelect;
