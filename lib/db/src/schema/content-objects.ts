import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  integer,
  foreignKey,
  unique,
} from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";
import { projectsTable } from "./projects";

/**
 * Sprint 3 — Quality Gate. The reviewable artifact lifecycle is keyed
 * off `content_objects` rather than `drafts` so multiple drafts can
 * roll up into a single review record (e.g. retry pipelines).
 *
 * status ∈ ('drafting','submitted','in_review','approved','rejected')
 *   - drafting   — initial state; ContentForge editor mutates body.
 *   - submitted  — writer pressed "Submit for Review"; QA worker queued.
 *   - in_review  — QA passed; reviewer can approve/reject.
 *   - approved   — terminal success.
 *   - rejected   — terminal failure (with reviewer comment).
 */
export const contentObjectsTable = pgTable(
  "content_objects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    draftId: uuid("draft_id"),
    title: text("title").notNull().default(""),
    bodyMd: text("body_md").notNull().default(""),
    wordCount: integer("word_count").notNull().default(0),
    status: text("status").notNull().default("drafting"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    submittedBy: text("submitted_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: text("decided_by"),
    decisionComment: text("decision_comment"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "content_objects_project_same_brand_fk",
      columns: [t.projectId, t.brandId],
      foreignColumns: [projectsTable.id, projectsTable.brandId],
    }),
    // Required so other brand-scoped tables can FK against (id, brand_id)
    // for the "same brand" composite foreign keys. Already live in
    // production via migration 0005_brand_isolation.sql.
    unique("content_objects_id_brand_uq").on(t.id, t.brandId),
    index("content_objects_brand_status_idx").on(t.brandId, t.status, t.submittedAt.desc()),
    index("content_objects_project_idx").on(t.projectId),
  ],
);

export type ContentObject = typeof contentObjectsTable.$inferSelect;
export type InsertContentObject = typeof contentObjectsTable.$inferInsert;
