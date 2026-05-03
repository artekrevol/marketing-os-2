import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";
import { contentObjectsTable } from "./content-objects";

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
    reviewerId: uuid("reviewer_id").notNull(),
    decision: text("decision").notNull(), // 'approved' | 'rejected'
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("qa_signoffs_content_object_idx").on(t.contentObjectId, t.createdAt.desc()),
  ],
);

export type QaSignoff = typeof qaSignoffsTable.$inferSelect;
export type InsertQaSignoff = typeof qaSignoffsTable.$inferInsert;
