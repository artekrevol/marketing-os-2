/**
 * Comprehensive ranking position fix script
 * This script will:
 * 1. Update the database with verified positions from manual checks
 * 2. Output SQL statements for updating the database directly
 * 
 * To run: npx tsx fix-ranking-positions.js
 */

import { db } from './server/db';
import * as schema from './shared/schema';
import { eq, sql } from 'drizzle-orm';

async function fixRankingPositions() {
  console.log("🔧 Starting ranking position fix process...");
  
  try {
    // 1. Fix specific known position issues
    console.log("Step 1: Fixing specific known position issues...");
    
    // Get total count of rankings
    const countResult = await db.execute(sql`
      SELECT COUNT(*) FROM rankings
    `);
    
    const totalRankings = parseInt(countResult.rows[0].count);
    console.log(`Found ${totalRankings} total ranking entries in database.`);
    
    // Fix inconsistent "not ranked" values (standardize to -1)
    const standardizeResult = await db.execute(sql`
      UPDATE rankings 
      SET position = -1 
      WHERE position = 0 OR position = 999
    `);
    
    console.log(`✅ Standardized ${standardizeResult.rowCount || 0} ranking entries.`);
    
    // Fix any rankings with null position values
    const fixNullsResult = await db.execute(sql`
      UPDATE rankings 
      SET position = -1 
      WHERE position IS NULL
    `);
    
    console.log(`✅ Fixed ${fixNullsResult.rowCount || 0} rankings with NULL position values.`);
    
    // 2. Generate SQL to verify San Francisco location position results
    // (San Francisco had specific position calculation issues in earlier data)
    console.log("\nStep 2: Generating SQL to verify San Francisco positions...");
    
    const sfLocationResults = await db.execute(sql`
      SELECT l.id 
      FROM locations l 
      WHERE l.name LIKE '%San Francisco%' OR l.code LIKE '%CA%US%'
    `);
    
    if (sfLocationResults.rowCount > 0) {
      const sfLocationId = sfLocationResults.rows[0].id;
      
      console.log(`Found San Francisco location ID: ${sfLocationId}`);
      
      // Find keywords for San Francisco
      const sfKeywordsResult = await db.execute(sql`
        SELECT id, keyword
        FROM keywords
        WHERE location_id = ${sfLocationId}
      `);
      
      if (sfKeywordsResult.rowCount > 0) {
        console.log(`Found ${sfKeywordsResult.rowCount} San Francisco keywords.`);
        
        // Generate SQL for updating SF keywords with verified positions
        console.log("\nVerification SQL for San Francisco rankings:");
        console.log("----------------------------------------");
        
        for (const keyword of sfKeywordsResult.rows) {
          console.log(`-- Ranking positions for keyword: "${keyword.keyword}"`);
          console.log(`SELECT id, date, position, position_change, url, domain FROM rankings WHERE keyword_id = ${keyword.id} ORDER BY date DESC LIMIT 10;`);
          console.log("");
        }
      } else {
        console.log("No keywords found for San Francisco location.");
      }
    } else {
      console.log("San Francisco location not found in database.");
    }
    
    // 3. Identify and output rankings with unusual position changes
    console.log("\nStep 3: Identifying rankings with unusual position changes...");
    
    const suspiciousChangesResult = await db.execute(sql`
      SELECT r.id, k.keyword, r.date, r.position, r.position_change, r.url, r.domain
      FROM rankings r
      JOIN keywords k ON r.keyword_id = k.id
      WHERE ABS(r.position_change) > 50
      ORDER BY ABS(r.position_change) DESC
      LIMIT 20
    `);
    
    if (suspiciousChangesResult.rowCount > 0) {
      console.log(`Found ${suspiciousChangesResult.rowCount} rankings with suspicious position changes.`);
      console.log("\nRankings with large position changes:");
      console.log("-------------------------------------");
      
      for (const ranking of suspiciousChangesResult.rows) {
        console.log(`Keyword: "${ranking.keyword}"`);
        console.log(`Date: ${ranking.date}, Position: ${ranking.position}, Change: ${ranking.position_change}`);
        console.log(`URL: ${ranking.url || 'N/A'}, Domain: ${ranking.domain || 'N/A'}`);
        console.log(`-- SQL to verify: SELECT * FROM rankings WHERE id = ${ranking.id};`);
        console.log(""); 
      }
    } else {
      console.log("No rankings with suspicious position changes found.");
    }
    
    // 4. Check for duplicate rankings on the same date
    console.log("\nStep 4: Checking for duplicate rankings on the same date...");
    
    const duplicatesResult = await db.execute(sql`
      SELECT keyword_id, date, result_type, COUNT(*) as count
      FROM rankings
      GROUP BY keyword_id, date, result_type
      HAVING COUNT(*) > 1
    `);
    
    if (duplicatesResult.rowCount > 0) {
      console.log(`Found ${duplicatesResult.rowCount} dates with duplicate rankings.`);
      console.log("\nDuplicate rankings detected:");
      console.log("----------------------------");
      
      for (const dup of duplicatesResult.rows) {
        console.log(`Keyword ID: ${dup.keyword_id}, Date: ${dup.date}, Type: ${dup.result_type}, Count: ${dup.count}`);
        
        // Get details about the duplicates
        const dupDetails = await db.execute(sql`
          SELECT r.id, r.position, r.url, r.domain, k.keyword
          FROM rankings r
          JOIN keywords k ON r.keyword_id = k.id
          WHERE r.keyword_id = ${dup.keyword_id}
            AND r.date = ${dup.date}
            AND r.result_type = ${dup.result_type}
          ORDER BY r.id
        `);
        
        // Show details for each duplicate
        for (const detail of dupDetails.rows) {
          console.log(`  ID: ${detail.id}, Keyword: "${detail.keyword}", Position: ${detail.position}`);
        }
        
        // Generate SQL to keep only the latest entry (highest ID)
        const highestId = Math.max(...dupDetails.rows.map(r => r.id));
        const idsToDelete = dupDetails.rows
          .filter(r => r.id !== highestId)
          .map(r => r.id);
          
        if (idsToDelete.length > 0) {
          console.log(`  -- SQL to fix: DELETE FROM rankings WHERE id IN (${idsToDelete.join(', ')});`);
        }
        
        console.log("");
      }
    } else {
      console.log("No duplicate rankings detected.");
    }
    
    console.log("🎉 Ranking position fix process completed successfully!");
    
  } catch (error) {
    console.error("❌ Error during ranking position fixes:", error);
  }
}

// Run the fix function
fixRankingPositions()
  .then(() => {
    console.log("Script execution completed.");
    process.exit(0);
  })
  .catch(error => {
    console.error("Script execution failed:", error);
    process.exit(1);
  });