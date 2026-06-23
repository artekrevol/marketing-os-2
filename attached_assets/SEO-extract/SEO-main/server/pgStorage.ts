import { db } from './db';
import { eq, and, desc, gte, lte, sql, isNull } from 'drizzle-orm';
import { 
  User, InsertUser, users,
  Location, InsertLocation, locations,
  Keyword, InsertKeyword, keywords,
  Ranking, InsertRanking, rankings,
  Schedule, InsertSchedule, schedules,
  KeywordBatch, InsertKeywordBatch, keywordBatches,
  KeywordBatchItem, InsertKeywordBatchItem, keywordBatchItems
} from '@shared/schema';
import { IStorage } from './storage';

/**
 * PostgreSQL implementation of the storage interface
 */
export class PgStorage implements IStorage {
  // Users
  async getUser(id: number): Promise<User | undefined> {
    const results = await db.select().from(users).where(eq(users.id, id));
    return results[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const results = await db.select().from(users).where(eq(users.username, username));
    return results[0];
  }

  async createUser(user: InsertUser): Promise<User> {
    const results = await db.insert(users).values(user).returning();
    return results[0];
  }

  // Locations
  async getLocations(): Promise<Location[]> {
    return db.select().from(locations);
  }

  async getLocation(id: number): Promise<Location | undefined> {
    const results = await db.select().from(locations).where(eq(locations.id, id));
    return results[0];
  }

  async createLocation(location: InsertLocation): Promise<Location> {
    const results = await db.insert(locations).values(location).returning();
    return results[0];
  }

  async updateLocation(id: number, location: Partial<InsertLocation>): Promise<Location | undefined> {
    const results = await db.update(locations)
      .set(location)
      .where(eq(locations.id, id))
      .returning();
    return results[0];
  }

  async deleteLocation(id: number): Promise<boolean> {
    try {
      await db.delete(locations).where(eq(locations.id, id));
      return true;
    } catch (error) {
      console.error('Error deleting location:', error);
      return false;
    }
  }

  // Keywords
  async getKeywords(): Promise<Keyword[]> {
    return db.select().from(keywords);
  }

  async getKeyword(id: number): Promise<Keyword | undefined> {
    const results = await db.select().from(keywords).where(eq(keywords.id, id));
    return results[0];
  }

  async createKeyword(keyword: InsertKeyword): Promise<Keyword> {
    const results = await db.insert(keywords).values(keyword).returning();
    return results[0];
  }

  async updateKeyword(id: number, keyword: Partial<InsertKeyword>): Promise<Keyword | undefined> {
    const results = await db.update(keywords)
      .set(keyword)
      .where(eq(keywords.id, id))
      .returning();
    return results[0];
  }

  async deleteKeyword(id: number): Promise<boolean> {
    try {
      await db.delete(keywords).where(eq(keywords.id, id));
      return true;
    } catch (error) {
      console.error('Error deleting keyword:', error);
      return false;
    }
  }

  async getKeywordsByLocationId(locationId: number): Promise<Keyword[]> {
    return db.select().from(keywords).where(eq(keywords.locationId, locationId));
  }

  async getKeywordsByGroup(group: string): Promise<Keyword[]> {
    return db.select().from(keywords).where(eq(keywords.group, group));
  }

  // Rankings
  async getRankings(): Promise<Ranking[]> {
    return db.select().from(rankings);
  }

  async getRanking(id: number): Promise<Ranking | undefined> {
    const results = await db.select().from(rankings).where(eq(rankings.id, id));
    return results[0];
  }

  async createRanking(ranking: InsertRanking): Promise<Ranking> {
    const results = await db.insert(rankings).values(ranking).returning();
    return results[0];
  }

  async getRankingsByKeywordId(keywordId: number): Promise<Ranking[]> {
    return db.select()
      .from(rankings)
      .where(eq(rankings.keywordId, keywordId))
      .orderBy(desc(rankings.date));
  }

  async getLatestRankingsByKeywordId(keywordId: number): Promise<Ranking | undefined> {
    const results = await db.select()
      .from(rankings)
      .where(eq(rankings.keywordId, keywordId))
      .orderBy(desc(rankings.date))
      .limit(1);
    return results[0];
  }

  async getRankingsByDate(startDate: Date, endDate: Date): Promise<Ranking[]> {
    return db.select()
      .from(rankings)
      .where(
        and(
          gte(rankings.date, startDate),
          lte(rankings.date, endDate)
        )
      );
  }

  async getRankingsWithKeywords(): Promise<(Ranking & { keyword: Keyword, location: Location | null })[]> {
    const results = await db
      .select({
        id: rankings.id,
        keywordId: rankings.keywordId,
        position: rankings.position,
        url: rankings.url,
        date: rankings.date,
        keyword: {
          id: keywords.id,
          keyword: keywords.keyword,
          targetUrl: keywords.targetUrl,
          locationId: keywords.locationId,
          group: keywords.group,
          trackDaily: keywords.trackDaily
        },
        location: {
          id: locations.id,
          name: locations.name,
          code: locations.code
        }
      })
      .from(rankings)
      .innerJoin(keywords, eq(rankings.keywordId, keywords.id))
      .leftJoin(locations, eq(keywords.locationId, locations.id))
      .orderBy(desc(rankings.date));

    return results.map(r => ({
      ...r,
      location: r.location.id ? r.location : null
    }));
  }

  async getAverageRankingPosition(): Promise<number> {
    // Get the latest ranking for each keyword
    const latestRankings = await db
      .select({
        position: rankings.position,
        keywordId: rankings.keywordId,
        max_date: sql<Date>`MAX(${rankings.date})`
      })
      .from(rankings)
      .groupBy(rankings.keywordId, rankings.position);

    if (latestRankings.length === 0) return 0;

    const totalPositions = latestRankings.reduce((sum, ranking) => sum + ranking.position, 0);
    return totalPositions / latestRankings.length;
  }

  async getTopTenCount(): Promise<number> {
    // Count keywords with the latest ranking in top 10
    const latestRankings = await db
      .select({
        position: rankings.position,
        keywordId: rankings.keywordId,
        max_date: sql<Date>`MAX(${rankings.date})`
      })
      .from(rankings)
      .groupBy(rankings.keywordId, rankings.position);

    return latestRankings.filter(ranking => ranking.position <= 10).length;
  }

  // Schedules
  async getSchedules(): Promise<Schedule[]> {
    return db.select().from(schedules);
  }

  async getActiveSchedule(): Promise<Schedule | undefined> {
    const results = await db
      .select()
      .from(schedules)
      .where(eq(schedules.isActive, true))
      .orderBy(desc(schedules.id))
      .limit(1);
    return results[0];
  }

  async createSchedule(schedule: InsertSchedule): Promise<Schedule> {
    const results = await db.insert(schedules).values(schedule).returning();
    return results[0];
  }

  async updateSchedule(id: number, schedule: Partial<InsertSchedule>): Promise<Schedule | undefined> {
    const results = await db.update(schedules)
      .set(schedule)
      .where(eq(schedules.id, id))
      .returning();
    return results[0];
  }

  async updateScheduleRunInfo(id: number, lastRun: Date, nextRun: Date): Promise<Schedule | undefined> {
    const results = await db.update(schedules)
      .set({ lastRun, nextRun })
      .where(eq(schedules.id, id))
      .returning();
    return results[0];
  }

  // Keyword Batches
  async createKeywordBatch(batch: InsertKeywordBatch): Promise<KeywordBatch> {
    const results = await db.insert(keywordBatches).values(batch).returning();
    return results[0];
  }

  async getKeywordBatch(id: number): Promise<KeywordBatch | undefined> {
    const results = await db.select().from(keywordBatches).where(eq(keywordBatches.id, id));
    return results[0];
  }

  async updateKeywordBatchStatus(id: number, status: string, endTime?: Date): Promise<KeywordBatch | undefined> {
    const updateData: any = { status };
    if (endTime) {
      updateData.endTime = endTime;
    }

    const results = await db.update(keywordBatches)
      .set(updateData)
      .where(eq(keywordBatches.id, id))
      .returning();
    return results[0];
  }

  async getLatestKeywordBatch(): Promise<KeywordBatch | undefined> {
    const results = await db
      .select()
      .from(keywordBatches)
      .orderBy(desc(keywordBatches.createdAt))
      .limit(1);
    return results[0];
  }

  // Keyword Batch Items
  async createKeywordBatchItem(item: InsertKeywordBatchItem): Promise<KeywordBatchItem> {
    const results = await db.insert(keywordBatchItems).values(item).returning();
    return results[0];
  }

  async updateKeywordBatchItemStatus(batchId: number, keywordId: number, status: string, message?: string): Promise<KeywordBatchItem | undefined> {
    const updateData: any = { status };
    if (message !== undefined) {
      updateData.message = message;
    }

    const results = await db.update(keywordBatchItems)
      .set(updateData)
      .where(
        and(
          eq(keywordBatchItems.batchId, batchId),
          eq(keywordBatchItems.keywordId, keywordId)
        )
      )
      .returning();
    return results[0];
  }

  async getKeywordBatchItems(batchId: number): Promise<KeywordBatchItem[]> {
    return db
      .select()
      .from(keywordBatchItems)
      .where(eq(keywordBatchItems.batchId, batchId));
  }
}