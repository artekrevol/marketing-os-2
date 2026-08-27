import { pgTable, uuid, text, timestamp, boolean, foreignKey } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { brandsTable } from "./brands";

export const proofPointsTable = pgTable("proof_points", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id").notNull().references(() => brandsTable.id, { onDelete: "restrict" }),
  claim: text("claim").notNull(),
  sourceUrl: text("source_url"),
  sourcePublication: text("source_publication"),
  publicationDate: text("publication_date"),
  verificationStatus: text("verification_status").notNull().default("unverified"),
  starred: boolean("starred").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "proof_points_project_same_brand_fk",
    columns: [t.projectId, t.brandId],
    foreignColumns: [projectsTable.id, projectsTable.brandId],
  }),
]);

export type ProofPoint = typeof proofPointsTable.$inferSelect;
