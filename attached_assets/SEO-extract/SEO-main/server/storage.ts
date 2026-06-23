import { 
  User, InsertUser, users,
  Location, InsertLocation, locations,
  KeywordGroup, InsertKeywordGroup, keywordGroups,
  Keyword, InsertKeyword, keywords,
  Ranking, InsertRanking, rankings,
  Schedule, InsertSchedule, schedules,
  KeywordBatch, InsertKeywordBatch, keywordBatches,
  KeywordBatchItem, InsertKeywordBatchItem, keywordBatchItems,
  LocationProxy, InsertLocationProxy, locationProxies,
  DashboardLayout, InsertDashboardLayout, dashboardLayouts,
  Competitor, InsertCompetitor, competitors,
  BlacklistedCompetitor, InsertBlacklistedCompetitor, blacklistedCompetitors,
  CompetitorInsight, InsertCompetitorInsight, competitorInsights
} from "@shared/schema";

// Modify the interface with CRUD methods
export interface IStorage {
  
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Locations
  getLocations(): Promise<Location[]>;
  getLocation(id: number): Promise<Location | undefined>;
  createLocation(location: InsertLocation): Promise<Location>;
  updateLocation(id: number, location: Partial<InsertLocation>): Promise<Location | undefined>;
  deleteLocation(id: number): Promise<boolean>;

  // Keyword Groups
  getKeywordGroups(): Promise<KeywordGroup[]>;
  getKeywordGroup(id: number): Promise<KeywordGroup | undefined>;
  createKeywordGroup(group: InsertKeywordGroup): Promise<KeywordGroup>;
  updateKeywordGroup(id: number, group: Partial<InsertKeywordGroup>): Promise<KeywordGroup | undefined>;
  deleteKeywordGroup(id: number): Promise<boolean>;
  getKeywordGroupsByParentId(parentId: number): Promise<KeywordGroup[]>;

  // Keywords
  getKeywords(): Promise<Keyword[]>;
  getKeyword(id: number): Promise<Keyword | undefined>;
  createKeyword(keyword: InsertKeyword): Promise<Keyword>;
  updateKeyword(id: number, keyword: Partial<InsertKeyword>): Promise<Keyword | undefined>;
  deleteKeyword(id: number): Promise<boolean>;
  deleteAllKeywords(): Promise<number>; // Added method to delete all keywords
  getKeywordsByLocationId(locationId: number): Promise<Keyword[]>;
  getKeywordsByGroup(group: string): Promise<Keyword[]>;
  getKeywordsByGroupId(groupId: number): Promise<Keyword[]>;
  
  // Rankings
  getRankings(): Promise<Ranking[]>;
  getRanking(id: number): Promise<Ranking | undefined>;
  createRanking(ranking: InsertRanking): Promise<Ranking>;
  getRankingsByKeywordId(keywordId: number): Promise<Ranking[]>;
  getLatestRankingsByKeywordId(keywordId: number, resultType?: string): Promise<Ranking | undefined>;
  getRankingsByDate(startDate: Date, endDate: Date): Promise<Ranking[]>;
  getRankingsWithKeywords(): Promise<(Ranking & { keyword: Keyword, location: Location | null })[]>;
  getAverageRankingPosition(): Promise<number>;
  getTopTenCount(): Promise<number>;
  
  // Schedules
  getSchedules(): Promise<Schedule[]>;
  getActiveSchedule(): Promise<Schedule | undefined>;
  createSchedule(schedule: InsertSchedule): Promise<Schedule>;
  updateSchedule(id: number, schedule: Partial<InsertSchedule>): Promise<Schedule | undefined>;
  updateScheduleRunInfo(id: number, lastRun: Date, nextRun: Date): Promise<Schedule | undefined>;
  
  // Keyword Batches
  createKeywordBatch(batch: InsertKeywordBatch): Promise<KeywordBatch>;
  getKeywordBatch(id: number): Promise<KeywordBatch | undefined>;
  updateKeywordBatchStatus(id: number, status: string, endTime?: Date): Promise<KeywordBatch | undefined>;
  getLatestKeywordBatch(): Promise<KeywordBatch | undefined>;
  
  // Keyword Batch Items
  createKeywordBatchItem(item: InsertKeywordBatchItem): Promise<KeywordBatchItem>;
  updateKeywordBatchItemStatus(batchId: number, keywordId: number, status: string, message?: string): Promise<KeywordBatchItem | undefined>;
  getKeywordBatchItems(batchId: number): Promise<KeywordBatchItem[]>;
  
  // Location Proxies
  getLocationProxies(): Promise<LocationProxy[]>;
  getLocationProxy(id: number): Promise<LocationProxy | undefined>;
  getLocationProxiesByLocationId(locationId: number): Promise<LocationProxy[]>;
  getRandomActiveProxyForLocation(locationId: number): Promise<LocationProxy | undefined>;
  createLocationProxy(proxy: InsertLocationProxy): Promise<LocationProxy>;
  updateLocationProxy(id: number, proxy: Partial<InsertLocationProxy>): Promise<LocationProxy | undefined>;
  updateLocationProxySuccessRate(id: number, success: boolean): Promise<LocationProxy | undefined>;
  deleteLocationProxy(id: number): Promise<boolean>;
  
  // Dashboard Layouts
  getDashboardLayouts(userId: number): Promise<DashboardLayout[]>;
  getDashboardLayout(id: number): Promise<DashboardLayout | undefined>;
  getActiveDashboardLayout(userId: number): Promise<DashboardLayout | undefined>;
  createDashboardLayout(layout: InsertDashboardLayout): Promise<DashboardLayout>;
  updateDashboardLayout(id: number, layout: Partial<InsertDashboardLayout>): Promise<DashboardLayout | undefined>;
  deleteDashboardLayout(id: number): Promise<boolean>;
  
  // Competitors
  createCompetitor(competitor: InsertCompetitor): Promise<Competitor>;
  getCompetitor(id: number): Promise<Competitor | undefined>;
  getCompetitorsByKeywordId(keywordId: number): Promise<Competitor[]>;
  getLatestCompetitorsByKeywordId(keywordId: number, limit?: number): Promise<Competitor[]>;
  getCompetitorsByBatchId(batchId: number): Promise<Competitor[]>;
  getCompetitorsByDomain(domain: string): Promise<Competitor[]>;
  
  // Blacklisted Competitors
  getBlacklistedCompetitors(): Promise<BlacklistedCompetitor[]>;
  getBlacklistedCompetitorsForKeyword(keywordId: number): Promise<BlacklistedCompetitor[]>;
  createBlacklistedCompetitor(competitor: InsertBlacklistedCompetitor): Promise<BlacklistedCompetitor>;
  deleteBlacklistedCompetitor(id: number): Promise<boolean>;
  isCompetitorBlacklisted(domain: string, keywordId?: number): Promise<boolean>;
  
  // Competitor Insights
  getCompetitorInsights(competitorId: number): Promise<CompetitorInsight | undefined>;
  getCompetitorInsightsByCompetitorIds(competitorIds: number[]): Promise<CompetitorInsight[]>;
  getAllCompetitorInsights(): Promise<CompetitorInsight[]>;
  createCompetitorInsight(insight: InsertCompetitorInsight): Promise<CompetitorInsight>;
  updateCompetitorInsight(id: number, insight: Partial<InsertCompetitorInsight>): Promise<CompetitorInsight | undefined>;
  deleteCompetitorInsight(id: number): Promise<boolean>;
}

import { db } from "./db";
import { eq, and, desc, gte, lte, isNotNull, isNull, or, sql, asc, inArray } from "drizzle-orm";

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser;
  }

  // Locations
  async getLocations(): Promise<Location[]> {
    return db.select().from(locations);
  }

  async getLocation(id: number): Promise<Location | undefined> {
    const [location] = await db.select().from(locations).where(eq(locations.id, id));
    return location;
  }

  async createLocation(location: InsertLocation): Promise<Location> {
    const [newLocation] = await db.insert(locations).values(location).returning();
    return newLocation;
  }

  async updateLocation(id: number, locationData: Partial<InsertLocation>): Promise<Location | undefined> {
    const [updatedLocation] = await db
      .update(locations)
      .set(locationData)
      .where(eq(locations.id, id))
      .returning();
    return updatedLocation;
  }

  async deleteLocation(id: number): Promise<boolean> {
    const result = await db.delete(locations).where(eq(locations.id, id)).returning({ id: locations.id });
    return result.length > 0;
  }

  // Keywords
  async getKeywords(): Promise<Keyword[]> {
    return db.select().from(keywords);
  }

  async getKeyword(id: number): Promise<Keyword | undefined> {
    const [keyword] = await db.select().from(keywords).where(eq(keywords.id, id));
    return keyword;
  }

  async createKeyword(keyword: InsertKeyword): Promise<Keyword> {
    const keywordData = {
      ...keyword,
      createdAt: new Date()
    };
    const [newKeyword] = await db.insert(keywords).values(keywordData).returning();
    return newKeyword;
  }

  async updateKeyword(id: number, keywordData: Partial<InsertKeyword>): Promise<Keyword | undefined> {
    const [updatedKeyword] = await db
      .update(keywords)
      .set(keywordData)
      .where(eq(keywords.id, id))
      .returning();
    return updatedKeyword;
  }

  async deleteKeyword(id: number): Promise<boolean> {
    const result = await db.delete(keywords).where(eq(keywords.id, id)).returning({ id: keywords.id });
    return result.length > 0;
  }
  
  async deleteAllKeywords(): Promise<number> {
    // First get the total count of keywords to return
    const allKeywords = await db.select({ id: keywords.id }).from(keywords);
    const count = allKeywords.length;
    
    try {
      // Use a transaction to ensure all deletions happen atomically
      await db.transaction(async (tx) => {
        // Delete all related records in the correct order (child tables first)
        // 1. Delete competitor insights first (references competitors)
        await tx.delete(competitorInsights);
        
        // 2. Delete competitors (references keywords)
        await tx.delete(competitors);
        
        // 3. Delete keyword batch items (references keywords)
        await tx.delete(keywordBatchItems);
        
        // 4. Delete rankings (references keywords)
        await tx.delete(rankings);
        
        // 5. Finally delete all keywords
        await tx.delete(keywords);
      });
      
      return count;
    } catch (error) {
      console.error("Error in delete all keywords:", error);
      throw error;
    }
  }

  async getKeywordsByLocationId(locationId: number): Promise<Keyword[]> {
    return db.select().from(keywords).where(eq(keywords.locationId, locationId));
  }

  async getKeywordsByGroup(group: string): Promise<Keyword[]> {
    return db.select().from(keywords).where(eq(keywords.group, group));
  }
  
  async getKeywordsByGroupId(groupId: number): Promise<Keyword[]> {
    return db.select().from(keywords).where(eq(keywords.groupId, groupId));
  }
  
  // Keyword Groups
  async getKeywordGroups(): Promise<KeywordGroup[]> {
    return db.select().from(keywordGroups);
  }
  
  async getKeywordGroup(id: number): Promise<KeywordGroup | undefined> {
    const [group] = await db.select().from(keywordGroups).where(eq(keywordGroups.id, id));
    return group;
  }
  
  async createKeywordGroup(group: InsertKeywordGroup): Promise<KeywordGroup> {
    const [newGroup] = await db.insert(keywordGroups).values(group).returning();
    return newGroup;
  }
  
  async updateKeywordGroup(id: number, groupData: Partial<InsertKeywordGroup>): Promise<KeywordGroup | undefined> {
    const [updatedGroup] = await db
      .update(keywordGroups)
      .set({
        ...groupData,
        updatedAt: new Date()
      })
      .where(eq(keywordGroups.id, id))
      .returning();
    return updatedGroup;
  }
  
  async deleteKeywordGroup(id: number): Promise<boolean> {
    const result = await db.delete(keywordGroups).where(eq(keywordGroups.id, id)).returning({ id: keywordGroups.id });
    return result.length > 0;
  }
  
  async getKeywordGroupsByParentId(parentId: number): Promise<KeywordGroup[]> {
    return db.select().from(keywordGroups).where(eq(keywordGroups.parentId, parentId));
  }

  // Rankings
  async getRankings(): Promise<Ranking[]> {
    return db.select().from(rankings);
  }

  async getRanking(id: number): Promise<Ranking | undefined> {
    const [ranking] = await db.select().from(rankings).where(eq(rankings.id, id));
    return ranking;
  }

  async createRanking(rankingData: InsertRanking): Promise<Ranking> {
    const data = {
      ...rankingData,
      date: new Date()
    };
    const [newRanking] = await db.insert(rankings).values(data).returning();
    return newRanking;
  }

  async getRankingsByKeywordId(keywordId: number): Promise<Ranking[]> {
    return db
      .select()
      .from(rankings)
      .where(eq(rankings.keywordId, keywordId))
      .orderBy(asc(rankings.date));
  }

  async getLatestRankingsByKeywordId(keywordId: number, resultType: string = 'organic'): Promise<Ranking | undefined> {
    const [latestRanking] = await db
      .select()
      .from(rankings)
      .where(
        and(
          eq(rankings.keywordId, keywordId),
          eq(rankings.resultType, resultType)
        )
      )
      .orderBy(desc(rankings.date))
      .limit(1);
    return latestRanking;
  }

  async getRankingsByDate(startDate: Date, endDate: Date): Promise<Ranking[]> {
    return db
      .select()
      .from(rankings)
      .where(
        and(
          gte(rankings.date, startDate),
          lte(rankings.date, endDate)
        )
      );
  }

  async getRankingsWithKeywords(): Promise<(Ranking & { keyword: Keyword, location: Location | null })[]> {
    const result = await db
      .select({
        ranking: rankings,
        keyword: keywords
      })
      .from(rankings)
      .innerJoin(keywords, eq(rankings.keywordId, keywords.id));

    // Get locations in a separate query to handle nullable relations
    const enrichedResults = await Promise.all(
      result.map(async ({ ranking, keyword }) => {
        let location = null;
        if (keyword.locationId) {
          const [loc] = await db
            .select()
            .from(locations)
            .where(eq(locations.id, keyword.locationId));
          location = loc || null;
        }

        return {
          ...ranking,
          keyword,
          location
        };
      })
    );

    return enrichedResults;
  }

  async getAverageRankingPosition(): Promise<number> {
    // Define the target domain
    const TARGET_DOMAIN = 'tekrevol.com';
    
    // Get all rankings with URL or domain
    const allRankings = await db
      .select({
        position: rankings.position,
        url: rankings.url,
        domain: rankings.domain,
        resultType: rankings.resultType
      })
      .from(rankings)
      .where(eq(rankings.resultType, 'organic')); // Only consider organic results
    
    // Filter for only Tekrevol domain rankings
    const filteredRankings = allRankings.filter(r => {
      // If domain is present, check if it includes tekrevol.com
      if (r.domain) {
        return r.domain.toLowerCase().includes(TARGET_DOMAIN);
      }
      // If URL is present but domain is not, check URL
      if (r.url) {
        return r.url.toLowerCase().includes(TARGET_DOMAIN);
      }
      return false;
    });
    
    if (filteredRankings.length === 0) return 0;
    
    // Calculate average position
    const totalPositions = filteredRankings.reduce((sum, r) => sum + r.position, 0);
    return parseFloat((totalPositions / filteredRankings.length).toFixed(1));
  }

  async getTopTenCount(): Promise<number> {
    // Define the target domain
    const TARGET_DOMAIN = 'tekrevol.com';
    
    // Get all rankings with URL or domain
    const allRankings = await db
      .select({
        position: rankings.position,
        url: rankings.url,
        domain: rankings.domain,
        resultType: rankings.resultType
      })
      .from(rankings)
      .where(eq(rankings.resultType, 'organic')); // Only consider organic results
    
    // Filter for only Tekrevol domains and positions <= 10
    const filteredRankings = allRankings.filter(r => {
      // First check position
      if (r.position > 10) return false;
      
      // Then check domain/URL
      if (r.domain) {
        return r.domain.toLowerCase().includes(TARGET_DOMAIN);
      }
      if (r.url) {
        return r.url.toLowerCase().includes(TARGET_DOMAIN);
      }
      return false;
    });
    
    return filteredRankings.length;
  }

  // Schedules
  async getSchedules(): Promise<Schedule[]> {
    return db.select().from(schedules);
  }

  async getActiveSchedule(): Promise<Schedule | undefined> {
    if (!db) {
      console.warn('Database not available. Cannot get active schedule.');
      return undefined;
    }
    const [schedule] = await db.select().from(schedules).where(eq(schedules.isActive, true));
    return schedule;
  }

  async createSchedule(schedule: InsertSchedule): Promise<Schedule> {
    const [newSchedule] = await db.insert(schedules).values(schedule).returning();
    return newSchedule;
  }

  async updateSchedule(id: number, scheduleData: Partial<InsertSchedule>): Promise<Schedule | undefined> {
    const [updatedSchedule] = await db
      .update(schedules)
      .set(scheduleData)
      .where(eq(schedules.id, id))
      .returning();
    return updatedSchedule;
  }

  async updateScheduleRunInfo(id: number, lastRun: Date, nextRun: Date): Promise<Schedule | undefined> {
    const [updatedSchedule] = await db
      .update(schedules)
      .set({ lastRun, nextRun })
      .where(eq(schedules.id, id))
      .returning();
    return updatedSchedule;
  }

  // Keyword Batches
  async createKeywordBatch(batch: InsertKeywordBatch): Promise<KeywordBatch> {
    const data = {
      ...batch,
      createdAt: new Date()
    };
    const [newBatch] = await db.insert(keywordBatches).values(data).returning();
    return newBatch;
  }

  async getKeywordBatch(id: number): Promise<KeywordBatch | undefined> {
    const [batch] = await db.select().from(keywordBatches).where(eq(keywordBatches.id, id));
    return batch;
  }

  async updateKeywordBatchStatus(id: number, status: string, endTime?: Date): Promise<KeywordBatch | undefined> {
    // Get current batch first
    const [currentBatch] = await db.select().from(keywordBatches).where(eq(keywordBatches.id, id));
    
    if (!currentBatch) return undefined;
    
    const updateData: Record<string, any> = { status };
    
    // Only set startTime if it's currently null and status is 'running'
    if (!currentBatch.startTime && status === 'running') {
      updateData.startTime = new Date();
    }
    
    // Set endTime if status is 'completed' or 'failed'
    if (status === 'completed' || status === 'failed') {
      updateData.endTime = endTime || new Date();
    }
    
    const [updatedBatch] = await db
      .update(keywordBatches)
      .set(updateData)
      .where(eq(keywordBatches.id, id))
      .returning();
      
    return updatedBatch;
  }

  async getLatestKeywordBatch(): Promise<KeywordBatch | undefined> {
    const [batch] = await db
      .select()
      .from(keywordBatches)
      .orderBy(desc(keywordBatches.createdAt))
      .limit(1);
    return batch;
  }

  // Keyword Batch Items
  async createKeywordBatchItem(item: InsertKeywordBatchItem): Promise<KeywordBatchItem> {
    const itemData = {
      ...item,
      message: item.message || null
    };
    const [newItem] = await db.insert(keywordBatchItems).values(itemData).returning();
    return newItem;
  }

  async updateKeywordBatchItemStatus(batchId: number, keywordId: number, status: string, message?: string): Promise<KeywordBatchItem | undefined> {
    const updateData: Record<string, any> = { 
      status,
      updatedAt: new Date() // Always update updatedAt when status changes
    };
    
    if (message !== undefined) {
      updateData.message = message;
    }
    
    // Set startTime when status changes to 'running' if not already set
    if (status === 'running') {
      // Check if startTime is already set
      const [existingItem] = await db
        .select()
        .from(keywordBatchItems)
        .where(
          and(
            eq(keywordBatchItems.batchId, batchId),
            eq(keywordBatchItems.keywordId, keywordId)
          )
        )
        .limit(1);
      
      if (existingItem && !existingItem.startTime) {
        updateData.startTime = new Date();
      }
    }
    
    // Set endTime when status changes to 'completed' or 'failed'
    if (status === 'completed' || status === 'failed') {
      updateData.endTime = new Date();
    }
    
    const [updatedItem] = await db
      .update(keywordBatchItems)
      .set(updateData)
      .where(
        and(
          eq(keywordBatchItems.batchId, batchId),
          eq(keywordBatchItems.keywordId, keywordId)
        )
      )
      .returning();
      
    return updatedItem;
  }

  async getKeywordBatchItems(batchId: number): Promise<KeywordBatchItem[]> {
    return db
      .select()
      .from(keywordBatchItems)
      .where(eq(keywordBatchItems.batchId, batchId));
  }
  
  // Location Proxies
  async getLocationProxies(): Promise<LocationProxy[]> {
    return db.select().from(locationProxies);
  }
  
  async getLocationProxy(id: number): Promise<LocationProxy | undefined> {
    const [proxy] = await db.select().from(locationProxies).where(eq(locationProxies.id, id));
    return proxy;
  }
  
  async getLocationProxiesByLocationId(locationId: number): Promise<LocationProxy[]> {
    return db
      .select()
      .from(locationProxies)
      .where(eq(locationProxies.locationId, locationId));
  }
  
  async getRandomActiveProxyForLocation(locationId: number): Promise<LocationProxy | undefined> {
    // Get all active proxies for the location
    const proxies = await db
      .select()
      .from(locationProxies)
      .where(
        and(
          eq(locationProxies.locationId, locationId),
          eq(locationProxies.isActive, true)
        )
      );
    
    if (proxies.length === 0) {
      return undefined;
    }
    
    // Choose a random proxy, weighted by success rate
    // Proxies with higher success rates have better chances of being selected
    const totalWeight = proxies.reduce((sum, proxy) => sum + (proxy.successRate || 100), 0);
    let random = Math.random() * totalWeight;
    
    for (const proxy of proxies) {
      random -= (proxy.successRate || 100);
      if (random <= 0) {
        // Update lastUsed timestamp
        await this.updateLocationProxy(proxy.id, { lastUsed: new Date(), successRate: proxy.successRate });
        return proxy;
      }
    }
    
    // Fallback to the first proxy (in case of rounding errors)
    const fallback = proxies[0];
    await this.updateLocationProxy(fallback.id, { lastUsed: new Date(), successRate: fallback.successRate });
    return fallback;
  }
  
  async createLocationProxy(proxy: InsertLocationProxy): Promise<LocationProxy> {
    const proxyData = {
      ...proxy,
      createdAt: new Date()
    };
    const [newProxy] = await db.insert(locationProxies).values(proxyData).returning();
    return newProxy;
  }
  
  async updateLocationProxy(id: number, proxyData: Partial<InsertLocationProxy>): Promise<LocationProxy | undefined> {
    const [updatedProxy] = await db
      .update(locationProxies)
      .set(proxyData)
      .where(eq(locationProxies.id, id))
      .returning();
    return updatedProxy;
  }
  
  async updateLocationProxySuccessRate(id: number, success: boolean): Promise<LocationProxy | undefined> {
    // Get current proxy
    const [proxy] = await db.select().from(locationProxies).where(eq(locationProxies.id, id));
    
    if (!proxy) return undefined;
    
    // Calculate new success rate (weighted average)
    // We give more weight to recent results, so old failures don't permanently penalize a proxy
    const currentRate = proxy.successRate || 100;
    const weight = 0.3; // 30% weight to new result, 70% to historical data
    const newRate = success 
      ? Math.min(100, currentRate + (100 - currentRate) * weight) // Increase success rate
      : Math.max(10, currentRate - currentRate * weight * 0.5);   // Decrease success rate, but not below 10%
    
    // Update success rate
    const [updatedProxy] = await db
      .update(locationProxies)
      .set({ 
        successRate: Math.round(newRate),
        lastUsed: new Date()
      })
      .where(eq(locationProxies.id, id))
      .returning();
      
    return updatedProxy;
  }
  
  async deleteLocationProxy(id: number): Promise<boolean> {
    const result = await db.delete(locationProxies).where(eq(locationProxies.id, id)).returning({ id: locationProxies.id });
    return result.length > 0;
  }
  
  // Dashboard Layouts
  async getDashboardLayouts(userId: number): Promise<DashboardLayout[]> {
    return db
      .select()
      .from(dashboardLayouts)
      .where(eq(dashboardLayouts.userId, userId))
      .orderBy(desc(dashboardLayouts.updatedAt));
  }
  
  async getDashboardLayout(id: number): Promise<DashboardLayout | undefined> {
    const [layout] = await db.select().from(dashboardLayouts).where(eq(dashboardLayouts.id, id));
    return layout;
  }
  
  async getActiveDashboardLayout(userId: number): Promise<DashboardLayout | undefined> {
    const [layout] = await db
      .select()
      .from(dashboardLayouts)
      .where(
        and(
          eq(dashboardLayouts.userId, userId),
          eq(dashboardLayouts.isActive, true)
        )
      )
      .limit(1);
    return layout;
  }
  
  async createDashboardLayout(layout: InsertDashboardLayout): Promise<DashboardLayout> {
    const now = new Date();
    const layoutData = {
      ...layout,
      createdAt: now,
      updatedAt: now
    };
    
    // If this is marked as active, deactivate all other layouts for this user first
    if (layout.isActive) {
      await db
        .update(dashboardLayouts)
        .set({ isActive: false })
        .where(eq(dashboardLayouts.userId, layout.userId));
    }
    
    const [newLayout] = await db.insert(dashboardLayouts).values(layoutData).returning();
    return newLayout;
  }
  
  async updateDashboardLayout(id: number, layoutData: Partial<InsertDashboardLayout>): Promise<DashboardLayout | undefined> {
    // Add updated timestamp
    const updateData = {
      ...layoutData,
      updatedAt: new Date()
    };
    
    // If setting this as active, deactivate all others first
    if (layoutData.isActive) {
      // Get the layout to find the user ID
      const [layout] = await db.select().from(dashboardLayouts).where(eq(dashboardLayouts.id, id));
      if (layout) {
        await db
          .update(dashboardLayouts)
          .set({ isActive: false })
          .where(
            and(
              eq(dashboardLayouts.userId, layout.userId),
              sql`${dashboardLayouts.id} != ${id}`
            )
          );
      }
    }
    
    const [updatedLayout] = await db
      .update(dashboardLayouts)
      .set(updateData)
      .where(eq(dashboardLayouts.id, id))
      .returning();
      
    return updatedLayout;
  }
  
  async deleteDashboardLayout(id: number): Promise<boolean> {
    const result = await db.delete(dashboardLayouts).where(eq(dashboardLayouts.id, id)).returning({ id: dashboardLayouts.id });
    return result.length > 0;
  }
  
  // Competitors
  async createCompetitor(competitor: InsertCompetitor): Promise<Competitor> {
    const data = {
      ...competitor,
      date: competitor.date || new Date()
    };
    const [newCompetitor] = await db.insert(competitors).values(data).returning();
    return newCompetitor;
  }
  
  async getCompetitor(id: number): Promise<Competitor | undefined> {
    const [competitor] = await db.select().from(competitors).where(eq(competitors.id, id));
    return competitor;
  }

  async getCompetitorsByKeywordId(keywordId: number): Promise<Competitor[]> {
    return db
      .select()
      .from(competitors)
      .where(eq(competitors.keywordId, keywordId))
      .orderBy(asc(competitors.position));
  }

  async getLatestCompetitorsByKeywordId(keywordId: number, limit: number = 20): Promise<Competitor[]> {
    try {
      // Get the latest batch ID from the keywordBatches table
      const [latestBatch] = await db
        .select()
        .from(keywordBatches)
        .orderBy(desc(keywordBatches.startTime))
        .limit(1);
      
      if (!latestBatch) {
        return [];
      }
      
      // First try to get competitors from the latest batch
      const latestBatchCompetitors = await db
        .select()
        .from(competitors)
        .where(
          and(
            eq(competitors.keywordId, keywordId),
            eq(competitors.batchId, latestBatch.id)
          )
        )
        .orderBy(asc(competitors.position));
      
      // If we have competitors from the latest batch
      if (latestBatchCompetitors.length > 0) {
        // Create a set of domains we already have from the latest batch
        const domainsFromLatestBatch = new Set(latestBatchCompetitors.map(c => c.domain.toLowerCase()));
        
        // Now get additional unique domains from other batches
        // to ensure we have a diverse set of competitors
        const additionalCompetitors = await db
          .select()
          .from(competitors)
          .where(
            and(
              eq(competitors.keywordId, keywordId),
              sql`${competitors.batchId} != ${latestBatch.id}`
            )
          )
          .orderBy(desc(competitors.date));
        
        // Filter to include only domains not already in the latest batch
        const uniqueAdditionalCompetitors = additionalCompetitors.filter(comp => 
          !domainsFromLatestBatch.has(comp.domain.toLowerCase())
        );
        
        // Combine competitors from latest batch with unique additional competitors
        const allCompetitors = [...latestBatchCompetitors, ...uniqueAdditionalCompetitors];
        
        // Remove duplicate domains (keep only the first entry for each domain)
        // This ensures we prioritize latest batch results when domains overlap
        const uniqueCompetitors = [];
        const seenDomains = new Set();
        
        for (const comp of allCompetitors) {
          const lowerDomain = comp.domain.toLowerCase();
          if (!seenDomains.has(lowerDomain)) {
            seenDomains.add(lowerDomain);
            uniqueCompetitors.push(comp);
            
            // If we have enough unique competitors, stop adding more
            if (uniqueCompetitors.length >= limit) {
              break;
            }
          }
        }
        
        // Sort by position
        return uniqueCompetitors.sort((a, b) => a.position - b.position);
      }
      
      // If no competitors in latest batch, try to find any competitors for this keyword sorted by date
      const recentCompetitors = await db
        .select()
        .from(competitors)
        .where(eq(competitors.keywordId, keywordId))
        .orderBy(desc(competitors.date))
        .limit(50); // Get more than we need
        
      // Remove duplicate domains (keep only the first occurrence of each domain)
      const uniqueCompetitors = [];
      const seenDomains = new Set();
      
      for (const comp of recentCompetitors) {
        const lowerDomain = comp.domain.toLowerCase();
        if (!seenDomains.has(lowerDomain)) {
          seenDomains.add(lowerDomain);
          uniqueCompetitors.push(comp);
          
          // If we have enough unique competitors, stop adding more
          if (uniqueCompetitors.length >= limit) {
            break;
          }
        }
      }
      
      // Sort by position
      return uniqueCompetitors.sort((a, b) => a.position - b.position);
    } catch (error) {
      console.error(`Error in getLatestCompetitorsByKeywordId for keyword ${keywordId}:`, error);
      return [];
    }
  }

  async getCompetitorsByBatchId(batchId: number): Promise<Competitor[]> {
    return db
      .select()
      .from(competitors)
      .where(eq(competitors.batchId, batchId))
      .orderBy(asc(competitors.position));
  }

  async getCompetitorsByDomain(domain: string): Promise<Competitor[]> {
    return db
      .select()
      .from(competitors)
      .where(sql`LOWER(${competitors.domain}) LIKE LOWER(${`%${domain}%`})`)
      .orderBy(desc(competitors.date));
  }
  
  // Blacklisted Competitors
  async getBlacklistedCompetitors(): Promise<BlacklistedCompetitor[]> {
    return db.select().from(blacklistedCompetitors);
  }
  
  async getBlacklistedCompetitorsForKeyword(keywordId: number): Promise<BlacklistedCompetitor[]> {
    return db
      .select()
      .from(blacklistedCompetitors)
      .where(
        or(
          eq(blacklistedCompetitors.keywordId, keywordId),
          isNull(blacklistedCompetitors.keywordId)
        )
      );
  }
  
  async createBlacklistedCompetitor(competitor: InsertBlacklistedCompetitor): Promise<BlacklistedCompetitor> {
    const data = {
      ...competitor,
      createdAt: new Date()
    };
    
    const [newBlacklist] = await db.insert(blacklistedCompetitors).values(data).returning();
    return newBlacklist;
  }
  
  async deleteBlacklistedCompetitor(id: number): Promise<boolean> {
    const result = await db
      .delete(blacklistedCompetitors)
      .where(eq(blacklistedCompetitors.id, id))
      .returning({ id: blacklistedCompetitors.id });
    return result.length > 0;
  }
  
  async isCompetitorBlacklisted(domain: string, keywordId?: number): Promise<boolean> {
    // First check if domain is blacklisted globally
    const [globalBlacklist] = await db
      .select()
      .from(blacklistedCompetitors)
      .where(
        and(
          sql`LOWER(${blacklistedCompetitors.domain}) = LOWER(${domain})`,
          isNull(blacklistedCompetitors.keywordId)
        )
      );
      
    if (globalBlacklist) {
      return true;
    }
    
    // Then check if domain is blacklisted for specific keyword
    if (keywordId) {
      const [keywordBlacklist] = await db
        .select()
        .from(blacklistedCompetitors)
        .where(
          and(
            sql`LOWER(${blacklistedCompetitors.domain}) = LOWER(${domain})`,
            eq(blacklistedCompetitors.keywordId, keywordId)
          )
        );
        
      return !!keywordBlacklist;
    }
    
    return false;
  }
  
  // Competitor Insights
  async getCompetitorInsights(competitorId: number): Promise<CompetitorInsight | undefined> {
    try {
      const [insight] = await db
        .select()
        .from(competitorInsights)
        .where(eq(competitorInsights.competitorId, competitorId))
        .orderBy(desc(competitorInsights.createdAt))
        .limit(1);
      
      return insight;
    } catch (error) {
      console.error("Error getting competitor insights:", error);
      return undefined;
    }
  }

  async getCompetitorInsightsByCompetitorIds(competitorIds: number[]): Promise<CompetitorInsight[]> {
    try {
      if (competitorIds.length === 0) {
        return [];
      }

      // Fetch all insights for the given competitor IDs in a single query
      const insights = await db
        .select()
        .from(competitorInsights)
        .where(inArray(competitorInsights.competitorId, competitorIds))
        .orderBy(desc(competitorInsights.createdAt));

      // Group by competitorId and keep only the latest for each
      // This ensures we only get one insight per competitor (the most recent one)
      const latestInsightsMap = new Map<number, CompetitorInsight>();
      for (const insight of insights) {
        const existing = latestInsightsMap.get(insight.competitorId);
        if (!existing || (insight.createdAt && existing.createdAt && new Date(insight.createdAt) > new Date(existing.createdAt))) {
          latestInsightsMap.set(insight.competitorId, insight);
        }
      }

      return Array.from(latestInsightsMap.values());
    } catch (error) {
      console.error("Error getting competitor insights by IDs:", error);
      return [];
    }
  }

  async getAllCompetitorInsights(): Promise<CompetitorInsight[]> {
    try {
      const insights = await db
        .select()
        .from(competitorInsights)
        .orderBy(desc(competitorInsights.createdAt));
      
      return insights;
    } catch (error) {
      console.error("Error getting all competitor insights:", error);
      return [];
    }
  }

  async createCompetitorInsight(insight: InsertCompetitorInsight): Promise<CompetitorInsight> {
    try {
      const [newInsight] = await db
        .insert(competitorInsights)
        .values({
          ...insight,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .returning();
      
      return newInsight;
    } catch (error) {
      console.error("Error creating competitor insight:", error);
      throw error; // Re-throw to handle at the route level
    }
  }

  async updateCompetitorInsight(id: number, insight: Partial<InsertCompetitorInsight>): Promise<CompetitorInsight | undefined> {
    const [updatedInsight] = await db
      .update(competitorInsights)
      .set({
        ...insight,
        updatedAt: new Date()
      })
      .where(eq(competitorInsights.id, id))
      .returning();
    
    return updatedInsight;
  }

  async deleteCompetitorInsight(id: number): Promise<boolean> {
    const result = await db
      .delete(competitorInsights)
      .where(eq(competitorInsights.id, id))
      .returning({ id: competitorInsights.id });
    
    return result.length > 0;
  }
}

export const storage = new DatabaseStorage();

// Helper function to initialize the database with some example data
async function initializeDatabase() {
  try {
    console.log('Initializing database with example data...');
    
    // Check if we already have locations
    const existingLocations = await storage.getLocations();
    if (existingLocations.length === 0) {
      // Add default locations
      console.log('Adding default locations...');
      const defaultLocations: InsertLocation[] = [
        { name: "Houston", code: "TX,US" },
        { name: "Miami", code: "FL,US" },
        { name: "New York", code: "NY,US" },
        { name: "Los Angeles", code: "CA,US" },
        { name: "Chicago", code: "IL,US" },
        { name: "San Francisco", code: "CA,US" }
      ];
      
      for (const location of defaultLocations) {
        await storage.createLocation(location);
      }
    }
    
    // Check if we already have a schedule
    const existingSchedule = await storage.getActiveSchedule();
    if (!existingSchedule) {
      console.log('Creating default schedule...');
      // Add default schedule (daily at 4:00 AM)
      const schedule = await storage.createSchedule({
        cronExpression: "0 4 * * *",
        isActive: true
      });
      
      // Set next run to tomorrow at 4 AM
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(4, 0, 0, 0);
      
      // Set last run to today
      const today = new Date();
      today.setHours(3, 45, 0, 0);
      
      await storage.updateScheduleRunInfo(schedule.id, today, tomorrow);
    }
    
    // Check if we already have keywords
    const existingKeywords = await storage.getKeywords();
    if (existingKeywords.length === 0) {
      console.log('Adding example keywords...');
      // Add example keywords with real location IDs
      const locations = await storage.getLocations();
      
      if (locations.length >= 3) {
        const exampleKeywords: InsertKeyword[] = [
          { keyword: "Mobile App Development", targetUrl: "tekrevol.com/services/mobile-app-development", locationId: locations[0].id, group: "Services", trackDaily: true },
          { keyword: "Web Development Company", targetUrl: "tekrevol.com/services/web-development", locationId: locations[1].id, group: "Services", trackDaily: true },
          { keyword: "Custom Software Development", targetUrl: "tekrevol.com/services/custom-software", locationId: locations[2].id, group: "Services", trackDaily: true },
          { keyword: "Enterprise Software Solutions", targetUrl: "tekrevol.com/enterprise", locationId: locations[0].id, group: "Products", trackDaily: true },
          { keyword: "Digital Transformation", targetUrl: "tekrevol.com/services/digital-transformation", locationId: locations[1].id, group: "Services", trackDaily: true }
        ];
        
        const createdKeywords = [];
        for (const keyword of exampleKeywords) {
          const k = await storage.createKeyword(keyword);
          createdKeywords.push(k);
        }
        
        console.log('Adding example rankings...');
        // Add some initial rankings
        for (const keyword of createdKeywords) {
          // Random position between 1 and 20
          const position = Math.floor(Math.random() * 20) + 1;
          await storage.createRanking({
            keywordId: keyword.id,
            position,
            url: keyword.targetUrl || 'tekrevol.com'
          });
        }
        
        // Add historical rankings for the first keyword
        if (createdKeywords.length > 0) {
          const firstKeyword = createdKeywords[0];
          
          // Ranking from 2 days ago
          const twoDaysAgo = new Date();
          twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
          const ranking1 = await storage.createRanking({
            keywordId: firstKeyword.id,
            position: 5,
            url: firstKeyword.targetUrl || 'tekrevol.com'
          });
          await db.update(rankings)
            .set({ date: twoDaysAgo })
            .where(eq(rankings.id, ranking1.id));
          
          // Ranking from 1 day ago
          const oneDayAgo = new Date();
          oneDayAgo.setDate(oneDayAgo.getDate() - 1);
          const ranking2 = await storage.createRanking({
            keywordId: firstKeyword.id,
            position: 4,
            url: firstKeyword.targetUrl || 'tekrevol.com'
          });
          await db.update(rankings)
            .set({ date: oneDayAgo })
            .where(eq(rankings.id, ranking2.id));
        }
      }
    }
    
    console.log('Database initialization complete.');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

// Run the initialization (only if database is available)
if (db) {
  initializeDatabase().catch((error) => {
    console.error('Failed to initialize database:', error);
    console.log('App will continue to run, but database features may not work.');
  });
} else {
  console.log('Database not configured. Skipping initialization.');
  console.log('To enable database features, set DATABASE_URL in your .env file.');
}
