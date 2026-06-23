// Test script to crawl a specific keyword with location
// This will test our San Francisco location code fix

import { crawlKeywords } from './server/crawler.js';
import { storage } from './server/storage.js';

// Find and crawl the "mobile app developers san francisco" keyword
async function testCrawlSanFranciscoKeyword() {
  try {
    console.log("Starting San Francisco keyword test crawl...");
    
    // Get the keyword with ID 49 (mobile app developers san francisco)
    const keyword = await storage.getKeyword(49);
    
    if (!keyword) {
      console.error("Keyword with ID 49 not found!");
      return;
    }
    
    console.log(`Found keyword: "${keyword.keyword}" with location ID ${keyword.locationId}`);
    
    // Get the location
    const location = await storage.getLocation(keyword.locationId);
    
    if (!location) {
      console.error(`Location with ID ${keyword.locationId} not found!`);
      return;
    }
    
    console.log(`Location: ${location.name} (${location.code})`);
    
    // Perform the crawl for just this one keyword
    console.log("Starting crawl for San Francisco keyword...");
    await crawlKeywords([49]);
    console.log("Crawl completed.");
    
    // Get the latest ranking
    const ranking = await storage.getLatestRankingsByKeywordId(49);
    
    if (!ranking) {
      console.log("No ranking found after crawl!");
      return;
    }
    
    console.log(`Results: Position = ${ranking.position}, URL = ${ranking.url}`);
    console.log(`Ranked on: ${ranking.date}`);
    
  } catch (error) {
    console.error("Error during test crawl:", error);
  }
}

testCrawlSanFranciscoKeyword();