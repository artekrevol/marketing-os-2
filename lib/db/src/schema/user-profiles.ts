import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userProfilesTable = pgTable("user_profiles", {
  userId: text("user_id").primaryKey(),
  email: text("email"),
  displayName: text("display_name"),
  role: text("role").notNull().default("writer"),
  brandAccess: uuid("brand_access")
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  pod: text("pod"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserProfile = typeof userProfilesTable.$inferSelect;
