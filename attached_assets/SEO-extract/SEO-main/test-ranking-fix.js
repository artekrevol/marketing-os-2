/**
 * Test script to verify our ranking position fixes
 * This will crawl a specific set of keywords to test our updated logic
 */

import { db } from './server/db';
import { rankings, keywords } from './shared/schema';
import { eq, and } from 'drizzle-orm';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testRankingFix() {
  console.log('Verifying ranking positions in the database...');
  
  // Define the verified rankings based on user's data
  const verifiedRankings = [
    { keyword: 'app developers in houston', position: 3 },
    { keyword: 'houston app developers', position: 2 },
    { keyword: 'mobile app developers houston', position: 3 },
    { keyword: 'mobile application developers houston', position: 3 },
    { keyword: 'mobile app developer houston', position: 2 },
    { keyword: 'android app development houston', position: 2 },
    { keyword: 'mobile application development houston', position: 1 },
    { keyword: 'houston mobile app development', position: 2 },
    { keyword: 'app developer houston', position: 2 },
    { keyword: 'mobile app developer houston company', position: 2 },
    { keyword: 'houston app development', position: 2 }
  ];
  
  console.log('Keyword'.padEnd(40) + ' | ' + 'Verified'.padEnd(10) + ' | ' + 'Database'.padEnd(10) + ' | ' + 'Status');
  console.log('-'.repeat(80));
  
  // Process each verified ranking
  for (const verifiedRanking of verifiedRankings) {
    try {
      // Find the keyword in the database
      const keyword = await db.query.keywords.findFirst({
        where: eq(keywords.keyword, verifiedRanking.keyword)
      });
      
      if (!keyword) {
        console.log(`${verifiedRanking.keyword.padEnd(40)} | ${String(verifiedRanking.position).padEnd(10)} | ${'N/A'.padEnd(10)} | Keyword not found`);
        continue;
      }
      
      // Find the latest organic ranking for this keyword
      const organicRankings = await db.select()
        .from(rankings)
        .where(
          and(
            eq(rankings.keywordId, keyword.id),
            eq(rankings.resultType, 'organic')
          )
        )
        .orderBy((cols) => [cols.date.desc()]);
      
      if (organicRankings.length === 0) {
        console.log(`${verifiedRanking.keyword.padEnd(40)} | ${String(verifiedRanking.position).padEnd(10)} | ${'N/A'.padEnd(10)} | No rankings found`);
        continue;
      }
      
      // Get the latest ranking
      const latestRanking = organicRankings[0];
      
      // Compare positions
      const status = latestRanking.position === verifiedRanking.position ? '✅ Match' : '❌ Mismatch';
      
      console.log(
        `${verifiedRanking.keyword.padEnd(40)} | ${String(verifiedRanking.position).padEnd(10)} | ${String(latestRanking.position).padEnd(10)} | ${status}`
      );
      
    } catch (error) {
      console.error(`Error checking ${verifiedRanking.keyword}:`, error);
    }
  }
  
  console.log('\nVerification completed.');
}

testRankingFix()
  .catch(console.error)
  .finally(() => process.exit(0));