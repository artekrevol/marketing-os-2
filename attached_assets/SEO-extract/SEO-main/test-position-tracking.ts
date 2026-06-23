import { storage } from './server/storage';
import { type InsertRanking } from './shared/schema';

/**
 * Test script to verify position change tracking functionality
 * This script will:
 * 1. Get an existing keyword
 * 2. Simulate creating ranking data with position changes
 * 3. Verify the position change calculation
 */
async function testPositionTracking() {
  try {
    console.log('Testing position change tracking...');
    
    // Get a random keyword from database
    const keywords = await storage.getKeywords();
    if (!keywords || keywords.length === 0) {
      console.error('No keywords found in database');
      return;
    }
    
    const testKeyword = keywords[0];
    console.log(`Using test keyword: ${testKeyword.keyword} (ID: ${testKeyword.id})`);
    
    // Create a simulated first ranking (position 8)
    const firstRanking: InsertRanking = {
      keywordId: testKeyword.id,
      position: 8,
      previousPosition: -1, // No previous position
      positionChange: 0,    // No change yet
      url: "https://example.com/test",
      date: new Date(),
      resultType: "organic",
      title: "Test Ranking",
      domain: "example.com",
      isScheduled: true
    };
    
    console.log('Creating first test ranking with position 8...');
    const ranking1 = await storage.createRanking(firstRanking);
    console.log(`First ranking created: Position ${ranking1.position}`);
    
    // Wait 1 second
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Get the saved ranking
    const previousRanking = await storage.getLatestRankingsByKeywordId(testKeyword.id, "organic");
    if (!previousRanking) {
      console.error('Failed to retrieve previous ranking');
      return;
    }
    console.log(`Retrieved previous ranking: Position ${previousRanking.position}`);
    
    // Create a simulated second ranking with an improvement (position 5)
    const positionImprovement: InsertRanking = {
      keywordId: testKeyword.id,
      position: 5,
      previousPosition: previousRanking.position,
      positionChange: previousRanking.position - 5, // Should be +3 (improvement)
      url: "https://example.com/test",
      date: new Date(),
      resultType: "organic",
      title: "Test Ranking Improved",
      domain: "example.com",
      isScheduled: true
    };
    
    console.log('Creating second test ranking with position 5 (improvement)...');
    const ranking2 = await storage.createRanking(positionImprovement);
    console.log(`Second ranking created: Position ${ranking2.position}, Change: ${ranking2.positionChange}`);
    
    // Wait 1 second
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Get the latest ranking
    const latestRanking = await storage.getLatestRankingsByKeywordId(testKeyword.id, "organic");
    if (!latestRanking) {
      console.error('Failed to retrieve latest ranking');
      return;
    }
    console.log(`Retrieved latest ranking: Position ${latestRanking.position}, Previous: ${latestRanking.previousPosition}, Change: ${latestRanking.positionChange}`);
    
    // Create a final ranking with a decline (position 7)
    const positionDecline: InsertRanking = {
      keywordId: testKeyword.id,
      position: 7,
      previousPosition: latestRanking.position,
      positionChange: latestRanking.position - 7, // Should be -2 (decline)
      url: "https://example.com/test",
      date: new Date(),
      resultType: "organic",
      title: "Test Ranking Declined",
      domain: "example.com",
      isScheduled: true
    };
    
    console.log('Creating final test ranking with position 7 (decline)...');
    const ranking3 = await storage.createRanking(positionDecline);
    console.log(`Final ranking created: Position ${ranking3.position}, Change: ${ranking3.positionChange}`);
    
    // Verify all test rankings
    console.log('\nTest Results:');
    console.log('=============');
    console.log(`First Ranking: Position ${ranking1.position}, Change: ${ranking1.positionChange}`);
    console.log(`Second Ranking: Position ${ranking2.position}, Change: ${ranking2.positionChange}`);
    console.log(`Final Ranking: Position ${ranking3.position}, Change: ${ranking3.positionChange}`);
    
    if (ranking2.positionChange === 3 && ranking3.positionChange === -2) {
      console.log('\n✅ Position tracking test PASSED!');
    } else {
      console.log('\n❌ Position tracking test FAILED!');
      console.log('Expected changes: +3, -2');
      console.log(`Actual changes: ${ranking2.positionChange}, ${ranking3.positionChange}`);
    }
    
  } catch (error) {
    console.error('Error in position tracking test:', error);
  }
}

// Run the test
testPositionTracking();