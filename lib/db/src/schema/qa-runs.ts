import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  integer,
} from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";
import { contentObjectsTable } from "./content-objects";

/**
 * One QA run per submission. status ∈ ('queued','running','passed','failed','error').
 *   - queued   — content.qa-run-checks job enqueued, not started.
 *   - running  — handler actively executing checks.
 *   - passed   — all hard-fail checks green; warns may exist.
 *   - failed   — at least one hard-fail check tripped (e.g. Originality).
 *   - error    — handler crashed; check qa_check_results for partial state.
 */
export const qaRunsTable = pgTable(
  "qa_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    contentObjectId: uuid("content_object_id")
      .notNull()
      .references(() => contentObjectsTable.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"),
    triggeredBy: uuid("triggered_by"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    summary: jsonb("summary").notNull().default({}),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("qa_runs_content_object_idx").on(t.contentObjectId, t.createdAt.desc()),
    index("qa_runs_brand_status_idx").on(t.brandId, t.status, t.createdAt.desc()),
  ],
);

export type QaRun = typeof qaRunsTable.$inferSelect;
export type InsertQaRun = typeof qaRunsTable.$inferInsert;
