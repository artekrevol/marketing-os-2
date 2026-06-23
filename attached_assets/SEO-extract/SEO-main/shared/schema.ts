import { pgTable, text, serial, integer, timestamp, boolean, primaryKey, jsonb, foreignKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Keep existing users table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Add tables for keyword tracking functionality

export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  code: text("code").notNull(),
  dataForSEOLocationCode: text("dataForSEOLocationCode"),
});

export const insertLocationSchema = createInsertSchema(locations).pick({
  name: true,
  code: true,
  dataForSEOLocationCode: true,
});

export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type Location = typeof locations.$inferSelect;

// Keyword Groups for hierarchical organization
export const keywordGroups = pgTable("keywordGroups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  parentId: integer("parentId"), // Self-reference will be added with foreignKey
  createdAt: timestamp("createdAt").defaultNow(),
  updatedAt: timestamp("updatedAt").defaultNow(),
}, (table) => {
  return {
    parentIdFk: foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: "keywordGroups_parentId_fkey"
    })
  };
});

export const insertKeywordGroupSchema = createInsertSchema(keywordGroups).pick({
  name: true,
  description: true,
  parentId: true,
});

export type InsertKeywordGroup = z.infer<typeof insertKeywordGroupSchema>;
export type KeywordGroup = typeof keywordGroups.$inferSelect;

export const keywords = pgTable("keywords", {
  id: serial("id").primaryKey(),
  keyword: text("keyword").notNull(),
  targetUrl: text("targetUrl"),
  locationId: integer("locationId").references(() => locations.id),
  group: text("group"), // Keep the existing group column for backward compatibility
  groupId: integer("groupId").references(() => keywordGroups.id), // New reference to keywordGroups
  trackDaily: boolean("trackDaily").default(true),
  createdAt: timestamp("createdAt").defaultNow(),
});

export const insertKeywordSchema = createInsertSchema(keywords).pick({
  keyword: true,
  targetUrl: true,
  locationId: true,
  group: true,
  groupId: true,
  trackDaily: true,
});

export type InsertKeyword = z.infer<typeof insertKeywordSchema>;
export type Keyword = typeof keywords.$inferSelect;

export const rankings = pgTable("rankings", {
  id: serial("id").primaryKey(),
  keywordId: integer("keywordId").references(() => keywords.id).notNull(),
  position: integer("position").notNull(),
  url: text("url").notNull(),
  date: timestamp("date").defaultNow(),
  resultType: text("resultType").default("organic"), // "organic", "other_organic", "local_pack"
  title: text("title"), // Store the title of the search result
  domain: text("domain"), // Store the domain of the result
  previousPosition: integer("previousPosition"), // Track previous position for change calculation
  isScheduled: boolean("isScheduled").default(false), // Whether this was from a scheduled crawl
  positionChange: integer("positionChange"), // Track position change from previous ranking
});

export const insertRankingSchema = createInsertSchema(rankings).pick({
  keywordId: true,
  position: true,
  url: true,
  date: true,
  resultType: true,
  title: true,
  domain: true,
  previousPosition: true,
  isScheduled: true,
  positionChange: true,
});

export type InsertRanking = z.infer<typeof insertRankingSchema>;
export type Ranking = typeof rankings.$inferSelect;

export const schedules = pgTable("schedules", {
  id: serial("id").primaryKey(),
  cronExpression: text("cronExpression").notNull(),
  lastRun: timestamp("lastRun"),
  nextRun: timestamp("nextRun"),
  isActive: boolean("isActive").default(true),
});

export const insertScheduleSchema = createInsertSchema(schedules).pick({
  cronExpression: true,
  isActive: true,
});

export type InsertSchedule = z.infer<typeof insertScheduleSchema>;
export type Schedule = typeof schedules.$inferSelect;

export const keywordBatches = pgTable("keywordBatches", {
  id: serial("id").primaryKey(),
  status: text("status").notNull(), // queued, running, completed, failed
  startTime: timestamp("startTime"),
  endTime: timestamp("endTime"),
  createdAt: timestamp("createdAt").defaultNow(),
});

export const insertKeywordBatchSchema = createInsertSchema(keywordBatches).pick({
  status: true,
  startTime: true,
  endTime: true,
});

export type InsertKeywordBatch = z.infer<typeof insertKeywordBatchSchema>;
export type KeywordBatch = typeof keywordBatches.$inferSelect;

export const keywordBatchItems = pgTable("keywordBatchItems", {
  batchId: integer("batchId").references(() => keywordBatches.id).notNull(),
  keywordId: integer("keywordId").references(() => keywords.id).notNull(),
  status: text("status").notNull(), // pending, running, completed, failed
  message: text("message"),
  startTime: timestamp("startTime"),
  endTime: timestamp("endTime"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(), // Track when item was last updated for progress detection
}, (t) => ({
  pk: primaryKey(t.batchId, t.keywordId),
}));

export const insertKeywordBatchItemSchema = createInsertSchema(keywordBatchItems).pick({
  batchId: true,
  keywordId: true,
  status: true,
  message: true,
  startTime: true,
  endTime: true,
});

export type InsertKeywordBatchItem = z.infer<typeof insertKeywordBatchItemSchema>;
export type KeywordBatchItem = typeof keywordBatchItems.$inferSelect;

// Location-specific proxies
export const locationProxies = pgTable("locationProxies", {
  id: serial("id").primaryKey(),
  locationId: integer("locationId").references(() => locations.id).notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull(),
  username: text("username"),
  password: text("password"),
  isActive: boolean("isActive").default(true),
  lastUsed: timestamp("lastUsed"),
  successRate: integer("successRate").default(100),
  createdAt: timestamp("createdAt").defaultNow(),
});

export const insertLocationProxySchema = createInsertSchema(locationProxies).pick({
  locationId: true,
  host: true,
  port: true,
  username: true,
  password: true,
  isActive: true,
  successRate: true,
  lastUsed: true,
});

export type InsertLocationProxy = z.infer<typeof insertLocationProxySchema>;
export type LocationProxy = typeof locationProxies.$inferSelect;

// Dashboard layouts for customizable widgets
export const dashboardLayouts = pgTable("dashboardLayouts", {
  id: serial("id").primaryKey(),
  userId: integer("userId").references(() => users.id).notNull(),
  name: text("name").notNull().default("Default Layout"),
  layouts: jsonb("layouts").notNull(), // Store grid layout as JSON
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow(),
  updatedAt: timestamp("updatedAt").defaultNow(),
});

export const insertDashboardLayoutSchema = createInsertSchema(dashboardLayouts).pick({
  userId: true,
  name: true,
  layouts: true,
  isActive: true,
});

export type InsertDashboardLayout = z.infer<typeof insertDashboardLayoutSchema>;
export type DashboardLayout = typeof dashboardLayouts.$inferSelect;

// Competitors data from search results
export const competitors = pgTable("competitors", {
  id: serial("id").primaryKey(),
  keywordId: integer("keywordId").references(() => keywords.id).notNull(),
  domain: text("domain").notNull(),
  url: text("url").notNull(),
  title: text("title"),
  position: integer("position").notNull(),
  batchId: integer("batchId").references(() => keywordBatches.id).notNull(),
  date: timestamp("date").defaultNow(),
});

// Blacklisted competitors that should be excluded from results
export const blacklistedCompetitors = pgTable("blacklistedCompetitors", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull(),
  createdAt: timestamp("createdAt").defaultNow(),
  reason: text("reason"),
  keywordId: integer("keywordId"), // Optional, if blacklisted for specific keyword only
});

export const insertCompetitorSchema = createInsertSchema(competitors).pick({
  keywordId: true,
  domain: true,
  url: true,
  title: true,
  position: true,
  batchId: true,
  date: true,
});

export type InsertCompetitor = z.infer<typeof insertCompetitorSchema>;
export type Competitor = typeof competitors.$inferSelect;

export const insertBlacklistedCompetitorSchema = createInsertSchema(blacklistedCompetitors).pick({
  domain: true,
  reason: true,
  keywordId: true,
});

export type InsertBlacklistedCompetitor = z.infer<typeof insertBlacklistedCompetitorSchema>;
export type BlacklistedCompetitor = typeof blacklistedCompetitors.$inferSelect;

// Competitor Insights table for storing OnPage analysis data
export const competitorInsights = pgTable("competitorInsights", {
  id: serial("id").primaryKey(),
  competitorId: integer("competitorId").references(() => competitors.id, { onDelete: "cascade" }).notNull(),
  taskId: text("taskId"),
  url: text("url").notNull(),
  title: text("title"),
  description: text("description"),
  canonical: text("canonical"),
  metaKeywords: text("metaKeywords"),
  h1: text("h1").array(),
  h2: text("h2").array(),
  h3: text("h3").array(),
  h4: text("h4").array(),
  h5: text("h5").array(),
  h6: text("h6").array(),
  keywordDensity: jsonb("keywordDensity"),
  robotsTxt: text("robotsTxt"),
  images: jsonb("images"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const insertCompetitorInsightSchema = createInsertSchema(competitorInsights).pick({
  competitorId: true,
  taskId: true,
  url: true,
  title: true,
  description: true,
  canonical: true,
  metaKeywords: true,
  h1: true,
  h2: true,
  h3: true,
  h4: true,
  h5: true,
  h6: true,
  keywordDensity: true,
  robotsTxt: true,
  images: true,
});

export type InsertCompetitorInsight = z.infer<typeof insertCompetitorInsightSchema>;
export type CompetitorInsight = typeof competitorInsights.$inferSelect;
