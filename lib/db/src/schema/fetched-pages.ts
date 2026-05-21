import { pgTable, uuid, text, timestamp, integer } from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";

export const fetchedPagesTable = pgTable("fetched_pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull().unique(),
  title: text("title"),
  content: text("content").notNull(),
  byteSize: integer("byte_size"),
  brandId: uuid("brand_id").references(() => brandsTable.id, { onDelete: "set null" }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FetchedPage = typeof fetchedPagesTable.$inferSelect;
