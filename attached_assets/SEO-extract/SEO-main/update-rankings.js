/**
 * Script to update the database with corrected rankings
 * This will update the existing rankings to match the verified organic positions
 */

const { db } = require('./server/db');
const { rankings, keywords } = require('./shared/schema');
const { eq, and } = require('drizzle-orm');

async function updateRankings() {
  console.log('Updating rankings in the database with verified positions...');
  
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
  
  // Process each verified ranking
  for (const verifiedRanking of verifiedRankings) {
    try {
      // Find the keyword in the database
      const keyword = await db.query.keywords.findFirst({
        where: eq(keywords.keyword, verifiedRanking.keyword)
      });
      
      if (!keyword) {
        console.log(`Keyword not found in database: ${verifiedRanking.keyword}`);
        continue;
      }
      
      // Find all organic rankings for this keyword
      const organicRankings = await db.select()
        .from(rankings)
        .where(
          and(
            eq(rankings.keywordId, keyword.id),
            eq(rankings.resultType, 'organic')
          )
        )
        .orderBy(rankings.date.desc());
      
      if (organicRankings.length === 0) {
        console.log(`No organic rankings found for ${verifiedRanking.keyword}`);
        continue;
      }
      
      // Update the latest organic ranking with the verified position
      const latestRanking = organicRankings[0];
      
      // Print out the old and new positions
      console.log(`Updating ${verifiedRanking.keyword}:`);
      console.log(`  Old position: ${latestRanking.position}`);
      console.log(`  New position: ${verifiedRanking.position}`);
      
      // Update the ranking in the database
      await db.update(rankings)
        .set({ position: verifiedRanking.position })
        .where(eq(rankings.id, latestRanking.id));
      
      console.log(`  ✅ Updated successfully`);
      
    } catch (error) {
      console.error(`Error updating ${verifiedRanking.keyword}:`, error);
    }
  }
  
  console.log('\nRanking update completed.');
}

updateRankings()
  .catch(console.error)
  .finally(() => process.exit(0));
