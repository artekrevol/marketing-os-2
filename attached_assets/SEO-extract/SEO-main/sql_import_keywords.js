/**
 * Script to import keywords using raw SQL
 * This avoids foreign key constraint issues by clearing related tables in the correct order
 * 
 * Run with: node sql_import_keywords.js
 */

const fs = require('fs');
const { execute } = require('./server/db-cli');

// SQL queries to clear data
const clearQueries = [
  // Drop related tables first
  'DELETE FROM "competitors";',
  'DELETE FROM "keywordBatchItems";',
  'DELETE FROM "rankings";',
  // Then drop keywords
  'DELETE FROM "keywords";'
];

// Import the keywords from JSON
async function importKeywords() {
  try {
    console.log('Reading keywords from JSON file...');
    const keywordsData = JSON.parse(fs.readFileSync('./keywords_import.json', 'utf8'));
    console.log(`Found ${keywordsData.length} keywords to import`);

    // Clear existing data
    console.log('Clearing existing data...');
    for (const query of clearQueries) {
      console.log(`Executing: ${query}`);
      await execute(query);
    }
    console.log('Existing data cleared successfully');

    // Process data in batches
    const batchSize = 50;
    let importedCount = 0;

    console.log('Importing new keywords...');
    for (let i = 0; i < keywordsData.length; i += batchSize) {
      const batch = keywordsData.slice(i, i + batchSize);
      
      // Generate insert values
      const valueStrings = batch.map(kw => {
        const keyword = kw.keyword.replace(/'/g, "''"); // Escape single quotes
        const targetUrl = (kw.targetUrl || '').replace(/'/g, "''");
        const locationId = kw.locationId === null ? 'NULL' : kw.locationId;
        const groupId = kw.groupId;
        const group = groupId.toString();
        
        return `('${keyword}', '${targetUrl}', ${locationId}, '${group}', ${groupId}, false, NOW())`;
      });
      
      // Build and execute the insert query
      const insertQuery = `
        INSERT INTO "keywords" (keyword, "targetUrl", "locationId", "group", "groupId", "trackDaily", "createdAt")
        VALUES ${valueStrings.join(', ')};
      `;
      
      await execute(insertQuery);
      importedCount += batch.length;
      console.log(`Imported ${importedCount} of ${keywordsData.length} keywords...`);
    }
    
    console.log('Import completed successfully');
    
    // Verify the import
    const countResult = await execute('SELECT COUNT(*) FROM "keywords";');
    console.log(`Keywords in database after import: ${countResult.rows[0].count}`);
    
    // Count by group
    const locationKeywordsCount = await execute('SELECT COUNT(*) FROM "keywords" WHERE "groupId" = 1;');
    const competitorKeywordsCount = await execute('SELECT COUNT(*) FROM "keywords" WHERE "groupId" = 2;');
    
    console.log(`Location Keywords: ${locationKeywordsCount.rows[0].count}`);
    console.log(`Competitor Keywords: ${competitorKeywordsCount.rows[0].count}`);
    
    // Get a sample of the imported keywords
    const sampleKeywords = await execute('SELECT id, keyword, "locationId", "groupId" FROM "keywords" LIMIT 5;');
    console.log('Sample of imported keywords:');
    console.log(sampleKeywords.rows);
    
  } catch (error) {
    console.error('Error importing keywords:', error);
    process.exit(1);
  }
}

// Create a simplified database client for direct SQL execution
const { drizzle } = require('drizzle-orm/neon-serverless');
const { neon } = require('@neondatabase/serverless');
require('dotenv').config();

// Create a function to execute raw SQL queries
async function execute(sql) {
  const client = neon(process.env.DATABASE_URL);
  try {
    const result = await client.query(sql);
    return result;
  } catch (error) {
    console.error(`Error executing SQL: ${sql}`);
    console.error(error);
    throw error;
  }
}

// Expose the execute function
exports.execute = execute;

// Run the import if this script is executed directly
if (require.main === module) {
  importKeywords()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Import failed:', err);
      process.exit(1);
    });
}