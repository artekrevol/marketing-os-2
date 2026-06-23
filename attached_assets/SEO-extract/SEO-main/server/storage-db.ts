import { 
  User, InsertUser, users,
  Location, InsertLocation, locations,
  Keyword, InsertKeyword, keywords,
  Ranking, InsertRanking, rankings,
  Schedule, InsertSchedule, schedules,
  KeywordBatch, InsertKeywordBatch, keywordBatches,
  KeywordBatchItem, InsertKeywordBatchItem, keywordBatchItems
} from "@shared/schema";
import { PgStorage } from "./pgStorage";

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

  // Keywords
  getKeywords(): Promise<Keyword[]>;
  getKeyword(id: number): Promise<Keyword | undefined>;
  createKeyword(keyword: InsertKeyword): Promise<Keyword>;
  updateKeyword(id: number, keyword: Partial<InsertKeyword>): Promise<Keyword | undefined>;
  deleteKeyword(id: number): Promise<boolean>;
  getKeywordsByLocationId(locationId: number): Promise<Keyword[]>;
  getKeywordsByGroup(group: string): Promise<Keyword[]>;
  
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
}

// Use PostgreSQL storage implementation
export const storage = new PgStorage();