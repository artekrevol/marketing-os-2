import { pgTable, uuid, text, timestamp, integer, numeric, jsonb } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { brandsTable } from "./brands";

export const draftScoresTable = pgTable("draft_scores", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .unique()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id").references(() => brandsTable.id, { onDelete: "restrict" }),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DraftScore = typeof draftScoresTable.$inferSelect;
