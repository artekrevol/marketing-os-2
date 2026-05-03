import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Minimal projection of `public.user_profiles` (defined in
 * `0001_brands_and_tenancy.sql`). The worker / services tier reads from
 * this table for FK targets (e.g. `recovery_baselines.locked_by`,
 * `recovery_initiatives.created_by`). The `role` and `brand_access`
 * columns are intentionally omitted here — those are managed via Supabase
 * helper RPCs (`is_admin()`, `current_user_brand_access()`) and not
 * mutated from the worker tier.
 *
 * Primary key is `user_id` (FK to `auth.users(id)`), NOT `id`.
 */
export const userProfilesTable = pgTable("user_profiles", {
  userId: uuid("user_id").primaryKey(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserProfile = typeof userProfilesTable.$inferSelect;
