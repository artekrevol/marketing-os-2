import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";
import { qaRunsTable } from "./qa-runs";

/**
 * Manual override of a hard-fail check by an admin/editor. Lets an
 * approver push a content_object forward despite a failed Originality
 * scan, with a justification stored alongside (audit_log gets a
 * paired entry via the service layer).
 *
 * `check_name` matches the failing qa_check_results.check_name.
 */
export const qaOverridesTable = pgTable(
  "qa_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    qaRunId: uuid("qa_run_id")
      .notNull()
      .references(() => qaRunsTable.id, { onDelete: "cascade" }),
    checkName: text("check_name").notNull(),
    overriddenBy: uuid("overridden_by").notNull(),
    justification: text("justification").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "qa_overrides_run_same_brand_fk",
      columns: [t.qaRunId, t.brandId],
      foreignColumns: [qaRunsTable.id, qaRunsTable.brandId],
    }),
    index("qa_overrides_run_idx").on(t.qaRunId),
  ],
);

export type QaOverride = typeof qaOverridesTable.$inferSelect;
export type InsertQaOverride = typeof qaOverridesTable.$inferInsert;
