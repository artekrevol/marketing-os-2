import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { brandsTable } from "./brands";

export const interviewAnswersTable = pgTable("interview_answers", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id").references(() => brandsTable.id, { onDelete: "restrict" }),
  sectionId: text("section_id").notNull(),
  question: text("question"),
  answer: text("answer"),
  followUp: text("follow_up"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InterviewAnswer = typeof interviewAnswersTable.$inferSelect;
