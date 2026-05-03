import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  numeric,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";

/**
 * Per-brand check configuration. Hard-fail checks (Originality) trip
 * qa_runs.status='failed'; warn-level checks (brand-voice, reading-
 * level, brief-compliance) only annotate.
 *
 * threshold semantics depend on `check_name`:
 *   - originality.ai-score: maximum allowed AI-score percent (lower is better)
 *   - reading-level.flesch-grade: target grade level (warns on |Δ|>2)
 *   - brand-voice.confidence: minimum voice-match confidence (0..1)
 *   - brief-compliance.coverage: minimum brief-coverage ratio (0..1)
 *
 * Seeded with 16 rows (4 brands × 4 checks) in 0005_quality_gate.sql.
 */
export const qaCheckDefinitionsTable = pgTable(
  "qa_check_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "cascade" }),
    checkName: text("check_name").notNull(),
    severity: text("severity").notNull(),   // 'hard' | 'warn'
    threshold: numeric("threshold", { precision: 10, scale: 4 }),
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("qa_check_definitions_brand_name_uq").on(t.brandId, t.checkName),
  ],
);

export type QaCheckDefinition = typeof qaCheckDefinitionsTable.$inferSelect;
export type InsertQaCheckDefinition = typeof qaCheckDefinitionsTable.$inferInsert;
