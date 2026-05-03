import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  integer,
  numeric,
} from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";
import { qaRunsTable } from "./qa-runs";

/**
 * One row per check executed in a qa_run. severity ∈ ('hard','warn').
 * outcome ∈ ('pass','fail','error').
 *
 * `score` is the raw numeric metric the check produced (e.g. AI-score
 * percent, Flesch grade); `threshold` is the brand-specific cutoff at
 * the time of evaluation. The diff is what the reviewer sees in the UI.
 */
export const qaCheckResultsTable = pgTable(
  "qa_check_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    qaRunId: uuid("qa_run_id")
      .notNull()
      .references(() => qaRunsTable.id, { onDelete: "cascade" }),
    checkName: text("check_name").notNull(),
    severity: text("severity").notNull(), // 'hard' | 'warn'
    outcome: text("outcome").notNull(),   // 'pass' | 'fail' | 'error'
    score: numeric("score", { precision: 10, scale: 4 }),
    threshold: numeric("threshold", { precision: 10, scale: 4 }),
    summary: text("summary"),
    details: jsonb("details").notNull().default({}),
    durationMs: integer("duration_ms"),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("qa_check_results_run_idx").on(t.qaRunId),
    index("qa_check_results_check_idx").on(t.checkName, t.outcome),
  ],
);

export type QaCheckResult = typeof qaCheckResultsTable.$inferSelect;
export type InsertQaCheckResult = typeof qaCheckResultsTable.$inferInsert;
