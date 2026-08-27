import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";
import { contentObjectsTable } from "./content-objects";
import { qaRunsTable } from "./qa-runs";

/**
 * Reviewer sign-off record. One row per (content_object, reviewer)
 * pair; decision ∈ ('approved','rejected'). Comment required on
 * 'rejected' (enforced via SQL CHECK in 0005).
 */
export const qaSignoffsTable = pgTable(
  "qa_signoffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    contentObjectId: uuid("content_object_id")
      .notNull()
      .references(() => contentObjectsTable.id, { onDelete: "cascade" }),
    /** Optional legacy link to the QA run that produced this sign-off. */
    qaRunId: uuid("qa_run_id").references(() => qaRunsTable.id, { onDelete: "set null" }),
    reviewerId: uuid("reviewer_id").notNull(),
    decision: text("decision").notNull(), // 'approved' | 'rejected'
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "qa_signoffs_content_object_same_brand_fk",
      columns: [t.contentObjectId, t.brandId],
      foreignColumns: [contentObjectsTable.id, contentObjectsTable.brandId],
    }),
    foreignKey({
      name: "qa_signoffs_run_same_brand_fk",
      columns: [t.qaRunId, t.brandId],
      foreignColumns: [qaRunsTable.id, qaRunsTable.brandId],
    }),
    index("qa_signoffs_content_object_idx").on(t.contentObjectId, t.createdAt.desc()),
  ],
);

export type QaSignoff = typeof qaSignoffsTable.$inferSelect;
export type InsertQaSignoff = typeof qaSignoffsTable.$inferInsert;
