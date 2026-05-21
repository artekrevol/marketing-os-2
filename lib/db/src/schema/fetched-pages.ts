import { pgTable, uuid, text, timestamp, integer } from "drizzle-orm/pg-core";

export const fetchedPagesTable = pgTable("fetched_pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull().unique(),
  title: text("title"),
  content: text("content"),
  byteSize: integer("byte_size"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  brandId: uuid("brand_id"),
});

export type FetchedPage = typeof fetchedPagesTable.$inferSelect;
