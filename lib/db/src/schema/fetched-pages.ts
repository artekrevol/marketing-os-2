import { pgTable, uuid, text, timestamp, integer } from "drizzle-orm/pg-core";

export const fetchedPagesTable = pgTable("fetched_pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull().unique(),
  title: text("title"),
  content: text("content"),
  byteSize: integer("byte_size"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FetchedPage = typeof fetchedPagesTable.$inferSelect;
