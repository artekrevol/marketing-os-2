/**
 * Comprehensive position calculation fix script
 * This script addresses several issues with position calculations:
 * 
 * 1. Standardizes "-1" position values to be displayed as "Not Ranked"
 * 2. Implements improved position change calculations to handle edge cases
 * 3. Adds a clearer indication for keywords first time appearing in rankings
 * 
 * To run: npx tsx fix-position-calculations.js
 */

import { db } from './server/db';
import * as schema from './shared/schema';
import { eq, sql } from 'drizzle-orm';

async function fixPositionCalculations() {
  console.log("🔧 Starting position calculation fix process...");
  
  try {
    // 1. Standardize position values for "not ranked" entries
    console.log("Step 1: Standardizing position values for unranked keywords...");
    
    // Replace 0 and 999 with -1 for consistency (all represent "not ranked")
    const standardizePositionsResult = await db.execute(
      sql`UPDATE rankings SET position = -1 WHERE position = 0 OR position = 999`
    );
    
    console.log(`✅ Standardized ${standardizePositionsResult.rowCount || 0} ranking entries.`);
    
    // 2. Recalculate position changes with better handling of edge cases
    console.log("Step 2: Recalculating position changes with improved logic...");
    
    // Get all keywords
    const keywordsResult = await db.query.keywords.findMany({
      columns: {
        id: true
      }
    });
    
    console.log(`Found ${keywordsResult.length} keywords to process.`);
    
    let fixedPositionChanges = 0;
    let newlyRankedKeywords = 0;
    let lostRankingKeywords = 0;
    
    // Process each keyword
    for (const keyword of keywordsResult) {
      const keywordId = keyword.id;
      
      // Get all rankings for this keyword, ordered by date
      const keywordRankings = await db.query.rankings.findMany({
        where: eq(schema.rankings.keywordId, keywordId),
        orderBy: (rankings, { asc }) => [asc(rankings.date)]
      });
      
      if (keywordRankings.length <= 1) {
        // Skip keywords with only one ranking entry (no change to calculate)
        continue;
      }
      
      // Process each ranking except the first one
      for (let i = 1; i < keywordRankings.length; i++) {
        const currentRanking = keywordRankings[i];
        const previousRanking = keywordRankings[i-1];
        
        // Filter by result type to compare apples to apples
        if (currentRanking.result_type !== previousRanking.result_type) {
          continue;
        }
        
        // Calculate position change with improved logic
        let positionChange = 0;
        
        // Current position is not ranked (-1)
        if (currentRanking.position == -1) {
          if (previousRanking.position != -1) {
            // Was ranked before, but not anymore - this is a loss (negative change)
            positionChange = previousRanking.position * -1;
            lostRankingKeywords++;
          } else {
            // Was not ranked before, still not ranked - no change
            positionChange = 0;
          }
        } 
        // Current position is ranked (positive number)
        else if (previousRanking.position == -1) {
          // Was not ranked before, but now is - this is a new ranking
          // Convention: Set to 0 to indicate a new ranking
          positionChange = 0;
          newlyRankedKeywords++;
        } else {
          // Both rankings have positions - straightforward calculation
          positionChange = previousRanking.position - currentRanking.position;
        }
        
        // Update the position change in the database
        await db.update(schema.rankings)
          .set({ positionChange })
          .where(eq(schema.rankings.id, currentRanking.id));
        
        fixedPositionChanges++;
      }
    }
    
    console.log(`✅ Fixed ${fixedPositionChanges} position changes.`);
    console.log(`✅ Identified ${newlyRankedKeywords} newly ranked keywords.`);
    console.log(`✅ Identified ${lostRankingKeywords} keywords that lost rankings.`);
    
    // 3. Update the frontend to display "Not Ranked" for position -1
    console.log("Step 3: UI display improvements already implemented in CurrentRankings.tsx");
    
    console.log("🎉 Position calculation fixes completed successfully!");
    
  } catch (error) {
    console.error("❌ Error during position calculation fixes:", error);
  }
}

// Run the fix function
fixPositionCalculations()
  .then(() => {
    console.log("Script execution completed.");
    process.exit(0);
  })
  .catch(error => {
    console.error("Script execution failed:", error);
    process.exit(1);
  });