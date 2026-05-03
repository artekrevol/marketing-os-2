import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const brandsTable = pgTable("brands", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  primaryDomain: text("primary_domain"),
  voiceProfile: jsonb("voice_profile").notNull().default({}),
  thresholds: jsonb("thresholds").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Brand = typeof brandsTable.$inferSelect;
