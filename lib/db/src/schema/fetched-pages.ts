import { pgTable, uuid, text, timestamp, integer, unique } from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";

export const fetchedPagesTable = pgTable("fetched_pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull(),
  title: text("title"),
  content: text("content").notNull(),
  byteSize: integer("byte_size"),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brandsTable.id, { onDelete: "restrict" }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("fetched_pages_brand_url_uq").on(t.brandId, t.url),
]);

export type FetchedPage = typeof fetchedPagesTable.$inferSelect;
