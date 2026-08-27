/**
 * Google platform integrations — OAuth connections and GSC data tables.
 *
 * Architecture:
 *   google_oauth_states      — short-lived CSRF tokens for the OAuth dance
 *   google_brand_connections — one OAuth token set per brand (covers GSC + GA4 + Business Profile)
 *   gsc_query_rows           — GSC search analytics, query dimension (synced nightly)
 *   gsc_page_rows            — GSC search analytics, page dimension (synced nightly)
 *   gsc_sync_log             — per-brand sync history with row counts
 */
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  numeric,
  date,
  index,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";

/* ── OAuth state (CSRF) — expires in 10 min, not brand-scoped ─────────────── */
export const googleOauthStatesTable = pgTable("google_oauth_states", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id").notNull().references(() => brandsTable.id, { onDelete: "cascade" }),
  createdBy: text("created_by").notNull(),
  returnTo: text("return_to"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Per-brand OAuth connection — one row per brand ───────────────────────── */
export const googleBrandConnectionsTable = pgTable("google_brand_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id")
    .notNull()
    .unique()
    .references(() => brandsTable.id, { onDelete: "cascade" }),
  googleAccountEmail: text("google_account_email").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  /** When the access token expires (UTC). Refresh 5 min before this. */
  tokenExpiry: timestamp("token_expiry", { withTimezone: true }).notNull(),
  /** Space-separated OAuth scopes granted. */
  scopes: text("scopes").notNull(),
  /** GSC property URL selected by admin, e.g. "sc-domain:example.com". */
  gscPropertyUrl: text("gsc_property_url"),
  /** GA4 numeric property ID — populated in Phase 2. */
  ga4PropertyId: text("ga4_property_id"),
  /** Business Profile account resource name, e.g. "accounts/123". */
  businessProfileAccountName: text("business_profile_account_name"),
  /** Selected Business Profile location resource names for this brand. */
  businessProfileLocationNames: text("business_profile_location_names").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GoogleBrandConnection = typeof googleBrandConnectionsTable.$inferSelect;

/* ── GSC: query-level analytics rows ─────────────────────────────────────── */
export const gscQueryRowsTable = pgTable(
  "gsc_query_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    date: date("date").notNull(),
    query: text("query").notNull(),
    page: text("page").notNull(),
    country: text("country").notNull().default(""),
    device: text("device").notNull().default(""),
    clicks: integer("clicks").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    ctr: numeric("ctr", { precision: 8, scale: 6 }).notNull().default("0"),
    position: numeric("position", { precision: 8, scale: 2 }).notNull().default("0"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("gsc_query_rows_uq").on(
      t.brandId, t.date, t.query, t.page, t.country, t.device,
    ),
    index("gsc_query_rows_brand_date_idx").on(t.brandId, t.date),
  ],
);

/* ── GSC: page-level analytics rows ──────────────────────────────────────── */
export const gscPageRowsTable = pgTable(
  "gsc_page_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    date: date("date").notNull(),
    page: text("page").notNull(),
    country: text("country").notNull().default(""),
    device: text("device").notNull().default(""),
    clicks: integer("clicks").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    ctr: numeric("ctr", { precision: 8, scale: 6 }).notNull().default("0"),
    position: numeric("position", { precision: 8, scale: 2 }).notNull().default("0"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("gsc_page_rows_uq").on(
      t.brandId, t.date, t.page, t.country, t.device,
    ),
    index("gsc_page_rows_brand_date_idx").on(t.brandId, t.date),
  ],
);

/* ── GSC sync history ─────────────────────────────────────────────────────── */
export const gscSyncLogTable = pgTable(
  "gsc_sync_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    /** running | done | error */
    status: text("status").notNull().default("running"),
    dateFrom: date("date_from"),
    dateTo: date("date_to"),
    queryRowsUpserted: integer("query_rows_upserted").notNull().default(0),
    pageRowsUpserted: integer("page_rows_upserted").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("gsc_sync_log_brand_idx").on(t.brandId)],
);

export type GscSyncLog = typeof gscSyncLogTable.$inferSelect;
