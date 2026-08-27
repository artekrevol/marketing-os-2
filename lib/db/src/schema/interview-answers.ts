import { pgTable, uuid, text, timestamp, foreignKey } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { brandsTable } from "./brands";

export const interviewAnswersTable = pgTable("interview_answers", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id").notNull().references(() => brandsTable.id, { onDelete: "restrict" }),
  sectionId: text("section_id").notNull(),
  question: text("question"),
  answer: text("answer"),
  followUp: text("follow_up"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "interview_answers_project_same_brand_fk",
    columns: [t.projectId, t.brandId],
    foreignColumns: [projectsTable.id, projectsTable.brandId],
  }),
]);

export type InterviewAnswer = typeof interviewAnswersTable.$inferSelect;
