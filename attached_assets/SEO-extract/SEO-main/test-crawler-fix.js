// Test script to crawl a specific keyword with location after our fix
// This should now correctly identify position 12 for the organic result

import { crawlKeywords } from './server/crawler.js';
import { storage } from './server/storage.js';

// Find and crawl the "mobile app developers san francisco" keyword
async function testCrawlSanFranciscoKeyword() {
  try {
    console.log("\n=== Testing San Francisco keyword with updated organic result filtering ===");
    
    // For testing, let's create or update the San Francisco keyword if needed
    let keyword = await storage.getKeyword(49);
    
    if (!keyword) {
      console.log("Creating test keyword for San Francisco...");
      const newKeyword = {
        keyword: "mobile app developers san francisco",
        targetUrl: "tekrevol.com",
        group: "sf-test",
        locationId: 6, // San Francisco location ID
        trackDaily: true
      };
      keyword = await storage.createKeyword(newKeyword);
      console.log("Created new keyword with ID:", keyword.id);
    } else {
      console.log(`Found existing keyword: "${keyword.keyword}" with ID ${keyword.id}`);
    }
    
    // Get the San Francisco location
    const location = await storage.getLocation(keyword.locationId);
    
    if (!location) {
      console.error(`Location with ID ${keyword.locationId} not found!`);
      return;
    }
    
    console.log(`Location: ${location.name} (${location.code})`);
    
    // Perform the crawl for just this one keyword
    console.log("Starting crawl for San Francisco keyword...");
    await crawlKeywords([keyword.id]);
    console.log("Crawl completed.");
    
    // Get the latest ranking
    const ranking = await storage.getLatestRankingsByKeywordId(keyword.id);
    
    if (!ranking) {
      console.log("No ranking found after crawl!");
      return;
    }
    
    console.log(`\n=== Results ===`);
    console.log(`Position: ${ranking.position}`);
    console.log(`URL: ${ranking.url}`);
    console.log(`Ranked on: ${ranking.date}`);
    
    // Verify that the position is around 12, as per the organic listing
    if (ranking.position >= 10 && ranking.position <= 15) {
      console.log("✓ Success! Position corresponds to the organic result (expected ~12).");
    } else if (ranking.position <= 5) {
      console.log("✗ Failed! Position still corresponds to the local_pack result (expected ~12).");
    } else {
      console.log("? Unexpected position - different from both expected results (local_pack ~2, organic ~12).");
    }
    
  } catch (error) {
    console.error("Error during test crawl:", error);
  }
}

testCrawlSanFranciscoKeyword();