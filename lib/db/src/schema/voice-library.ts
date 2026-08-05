import { pgTable, uuid, text, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projectsTable } from "./projects";
import { brandsTable } from "./brands";

export const voiceLibraryTable = pgTable("voice_library", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brandsTable.id, { onDelete: "restrict" }),
  writerId: text("writer_id"),
  originalAiText: text("original_ai_text").notNull(),
  editedHumanText: text("edited_human_text").notNull(),
  editType: text("edit_type"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check(
    "voice_library_edit_type_check",
    sql`${t.editType} IS NULL OR ${t.editType} IN ('inline', 'revision', 'manual')`,
  ),
]);

export type VoiceLibrary = typeof voiceLibraryTable.$inferSelect;
