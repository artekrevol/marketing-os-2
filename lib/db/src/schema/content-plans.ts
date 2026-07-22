import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";
import { projectsTable } from "./projects";
import { userProfilesTable } from "./user-profiles";

/**
 * Content Plan Architecture (Phase 1 — Schema Foundation).
 *
 * Two brand-scoped tables that sit between intake and generation:
 *
 *  content_plan_templates — Rabia's configuration layer. One global row
 *    (scope='global', content_type=NULL) holds cross-cutting defaults
 *    (citation authority, brand voice, tone requirements). Eight per-type
 *    rows (scope='content_type') hold article-structure and required-element
 *    defaults for each content type. Cascade: check per-type first, fall back
 *    to global. Edited through the Rules Dashboard UI.
 *
 *  content_plans — The per-project plan produced by the planner AI and
 *    reviewed/adjusted by Rabia before generation runs. plan_data holds the
 *    full structured plan (selected testimonials, link targets, brand mention
 *    budget, citation slots, section structure). Approved plans are the
 *    authoritative generation spec; validators check plan compliance rather
 *    than accumulating heuristic rules.
 *
 * Partial unique indexes (created via raw DDL, not expressible in Drizzle's
 * builder with WHERE clauses):
 *   cpt_global_version_uq:   UNIQUE(brand_id, version) WHERE scope='global'
 *   cpt_type_version_uq:     UNIQUE(brand_id, content_type, version) WHERE scope='content_type'
 *   content_plans_active_per_project: UNIQUE(project_id) WHERE status='approved' AND superseded_by IS NULL
 */

/* -------------------------------------------------------------------------- */
/* content_plan_templates — Rabia's Rules Dashboard configuration layer       */
/* -------------------------------------------------------------------------- */

export const contentPlanTemplatesTable = pgTable(
  "content_plan_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    /**
     * 'global'       → applies across all content types; content_type IS NULL.
     *                  template_data keys: citation_authority, brand_voice_global,
     *                  tone_requirements, cost_budget.
     * 'content_type' → overrides for a specific content type.
     *                  template_data keys: article_structure, required_elements,
     *                  brand_mention_overrides.
     */
    scope: text("scope").notNull().default("content_type"),
    contentType: text("content_type"),
    version: integer("version").notNull().default(1),
    templateData: jsonb("template_data").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by").references(
      () => userProfilesTable.userId,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("cpt_brand_scope_type_active_idx").on(
      t.brandId,
      t.scope,
      t.contentType,
      t.isActive,
    ),
  ],
);

export type ContentPlanTemplate = typeof contentPlanTemplatesTable.$inferSelect;
export type InsertContentPlanTemplate =
  typeof contentPlanTemplatesTable.$inferInsert;

/* -------------------------------------------------------------------------- */
/* content_plans — per-project plan produced by planner AI, reviewed by Rabia */
/* -------------------------------------------------------------------------- */

export const contentPlansTable = pgTable(
  "content_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    templateId: uuid("template_id").references(
      () => contentPlanTemplatesTable.id,
      { onDelete: "set null" },
    ),
    /**
     * Lifecycle: draft → under_review → approved | abandoned
     * Superseding: approved → superseded (superseded_by set to new plan id)
     */
    status: text("status").notNull().default("draft"),
    /**
     * The full structured plan. Top-level keys (set by planner, editable by Rabia):
     *   primary_keyword, content_type, funnel_stage,
     *   brand_mentions: { budget, style_mix },
     *   citations: { slots[] },
     *   testimonials: { selected_ids[] },
     *   internal_links: { selected_ids[] },
     *   named_projects: { selected_ids[] },
     *   article_structure: { section_kinds[], target_word_count }
     */
    planData: jsonb("plan_data").notNull(),
    /** Provenance: which template_id/version + planner model were used. */
    provenance: jsonb("provenance").notNull().default({}),
    plannerReasoning: text("planner_reasoning"),
    estimatedCostUsd: numeric("estimated_cost_usd", {
      precision: 10,
      scale: 4,
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: text("approved_by").references(
      () => userProfilesTable.userId,
      { onDelete: "set null" },
    ),
    /** Set when this plan is superseded by a newer one. Self-referencing FK. */
    supersededBy: uuid("superseded_by").references(
      (): AnyPgColumn => contentPlansTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("content_plans_brand_project_idx").on(t.brandId, t.projectId),
    index("content_plans_status_idx").on(t.brandId, t.status),
    index("content_plans_keyword_idx").on(
      // functional index on plan_data->>'primary_keyword'; declared here for
      // documentation — the expression index was created via raw DDL.
      t.planData,
    ),
  ],
);

export type ContentPlan = typeof contentPlansTable.$inferSelect;
export type InsertContentPlan = typeof contentPlansTable.$inferInsert;
