/**
 * Test script to verify our San Francisco ranking fix
 * This runs a targeted test for SF keywords to ensure positions are correctly calculated
 */

const { db } = require('./server/db');
const { keywords, rankings } = require('./shared/schema');
const { eq, and } = require('drizzle-orm');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

async function testSanFranciscoPositionFix() {
  console.log('Verifying San Francisco ranking positions in the database...');
  
  // Define the verified rankings based on user's data
  const verifiedRankings = [
    { keyword: 'mobile app development company in san francisco', expectedPosition: 7 }
  ];
  
  console.log('Keyword'.padEnd(50) + ' | ' + 'Expected'.padEnd(10) + ' | ' + 'Current'.padEnd(10) + ' | ' + 'Status');
  console.log('-'.repeat(90));
  
  // Process each verified ranking
  for (const verifiedRanking of verifiedRankings) {
    try {
      // Find the keyword in the database
      const keyword = await db.query.keywords.findFirst({
        where: eq(keywords.keyword, verifiedRanking.keyword)
      });
      
      if (!keyword) {
        console.log(`${verifiedRanking.keyword.padEnd(50)} | ${String(verifiedRanking.expectedPosition).padEnd(10)} | ${'N/A'.padEnd(10)} | ❌ Keyword not found`);
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
        console.log(`${verifiedRanking.keyword.padEnd(50)} | ${String(verifiedRanking.expectedPosition).padEnd(10)} | ${'N/A'.padEnd(10)} | ❌ No rankings found`);
        continue;
      }
      
      // Get the latest ranking
      const latestRanking = organicRankings[0];
      
      // Compare positions
      const status = latestRanking.position === verifiedRanking.expectedPosition 
        ? '✅ Match' 
        : `❌ Mismatch (off by ${Math.abs(latestRanking.position - verifiedRanking.expectedPosition)})`;
      
      console.log(
        `${verifiedRanking.keyword.padEnd(50)} | ${String(verifiedRanking.expectedPosition).padEnd(10)} | ${String(latestRanking.position).padEnd(10)} | ${status}`
      );
      
      // If there's a mismatch, print more details about the ranking
      if (latestRanking.position !== verifiedRanking.expectedPosition) {
        console.log(`Details for "${verifiedRanking.keyword}":`);
        console.log(` - Current position: ${latestRanking.position}`);
        console.log(` - Expected position: ${verifiedRanking.expectedPosition}`);
        console.log(` - URL: ${latestRanking.url}`);
        console.log(` - Last checked: ${new Date(latestRanking.date).toLocaleString()}`);
        console.log(` - Result type: ${latestRanking.resultType}`);
        console.log(` - Domain: ${latestRanking.domain}`);
        
        // Get all rankings for this keyword
        const allRankings = await db.select()
          .from(rankings)
          .where(eq(rankings.keywordId, keyword.id))
          .orderBy((cols) => [cols.date.desc()]);
        
        console.log(`\nAll recent rankings for this keyword (sorted by date):`);
        for (let i = 0; i < Math.min(5, allRankings.length); i++) {
          const r = allRankings[i];
          console.log(` - Position: ${r.position} (${r.resultType}) on ${new Date(r.date).toLocaleString()}`);
        }
      }
      
    } catch (error) {
      console.error(`Error checking ${verifiedRanking.keyword}:`, error);
    }
  }
  
  console.log('\nVerification completed.');
}

testSanFranciscoPositionFix()
  .catch(console.error)
  .finally(() => process.exit(0));