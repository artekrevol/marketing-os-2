import { pgTable, uuid, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projectsTable } from "./projects";
import { brandsTable } from "./brands";

export const researchBriefsTable = pgTable("research_briefs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .unique()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brandsTable.id, { onDelete: "restrict" }),
  searchIntent: jsonb("search_intent"),
  benchmarkTeardown: jsonb("benchmark_teardown"),
  competitorTeardown: jsonb("competitor_teardown"),
  synergyMap: jsonb("synergy_map"),
  aiCitationLandscape: jsonb("ai_citation_landscape"),
  atomicQuestionMap: jsonb("atomic_question_map"),
  entityDataRequirements: jsonb("entity_data_requirements"),
  angleInventory: jsonb("angle_inventory"),
  conversionSignals: jsonb("conversion_signals"),
  rawOutput: text("raw_output"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  progressStage: integer("progress_stage"),
  progressStatus: jsonb("progress_status"),
  progressError: text("progress_error"),
  proofPointsStatus: text("proof_points_status"),
  subStatus: jsonb("sub_status")
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ResearchBrief = typeof researchBriefsTable.$inferSelect;
