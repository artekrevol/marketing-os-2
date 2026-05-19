import { pgTable, uuid, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";

export const projectsTable = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brandsTable.id, { onDelete: "restrict" }),
  topic: text("topic").notNull(),
  contentType: text("content_type").notNull(),
  mode: text("mode"),
  status: text("status").notNull().default("draft"),
  currentStage: integer("current_stage").notNull().default(0),
  url: text("url"),
  keyword: text("keyword"),
  keywordCluster: jsonb("keyword_cluster"),
  funnelStage: text("funnel_stage"),
  pod: text("pod"),
  companyDomain: text("company_domain"),
  competitorUrl: text("competitor_url"),
  benchmarkUrl: text("benchmark_url"),
  playbookVersion: integer("playbook_version"),
  aiProposedBrief: jsonb("ai_proposed_brief"),
  briefConfirmedAt: timestamp("brief_confirmed_at", { withTimezone: true }),
  briefError: text("brief_error"),
  userNotes: text("user_notes"),
  userOverrides: jsonb("user_overrides"),
  icps: integer("icps").array(),
  writerId: text("writer_id"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Project = typeof projectsTable.$inferSelect;
