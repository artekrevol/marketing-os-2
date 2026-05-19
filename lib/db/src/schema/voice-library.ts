import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { brandsTable } from "./brands";

export const voiceLibraryTable = pgTable("voice_library", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id").references(() => brandsTable.id, { onDelete: "restrict" }),
  writerId: text("writer_id"),
  originalAiText: text("original_ai_text"),
  editedHumanText: text("edited_human_text"),
  editType: text("edit_type"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VoiceLibrary = typeof voiceLibraryTable.$inferSelect;
