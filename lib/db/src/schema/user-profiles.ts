import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Two-axis identity taxonomy for a user_profile:
 *  - `role` is AUTHORITY (what the user is allowed to do across modules).
 *  - `department` is CRAFT (what kind of work the user does).
 *
 * Validation is enforced in the service layer via these const arrays —
 * same convention used elsewhere on the platform. `role` is a plain text
 * column (no $type) so route handlers validate against USER_ROLES;
 * `department` is a real Postgres enum (`app_department`).
 *
 * Note: "outreach" is a DEPARTMENT, not a role. SEO OS entry is gated on
 * role ∈ {admin, lead, reviewer}; the default authority for new users is
 * "member" and the default craft is "writer".
 */
export const USER_ROLES = ["admin", "lead", "reviewer", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_DEPARTMENTS = [
  "writer",
  "editor",
  "strategist",
  "analyst",
  "outreach",
  "engineering",
  "operations",
] as const;
export type UserDepartment = (typeof USER_DEPARTMENTS)[number];

export const departmentEnum = pgEnum("app_department", USER_DEPARTMENTS);

export const userProfilesTable = pgTable("user_profiles", {
  userId: text("user_id").primaryKey(),
  email: text("email"),
  passwordHash: text("password_hash"),
  displayName: text("display_name"),
  role: text("role").notNull().default("member"),
  department: departmentEnum("department").notNull().default("writer"),
  brandAccess: uuid("brand_access")
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  pod: text("pod"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserProfile = typeof userProfilesTable.$inferSelect;
