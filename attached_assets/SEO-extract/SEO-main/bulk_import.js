/**
 * Script to bulk import keywords using the API
 * Run with: node bulk_import.js
 * 
 * This version includes resume functionality to continue from where it left off
 */

import fs from 'fs';
import axios from 'axios';

const API_URL = 'http://localhost:5000/api/keywords/bulk';
const KEYWORDS_FILE = './keywords_import.json';

// Get existing keywords to avoid duplicates
async function getExistingKeywords() {
  try {
    console.log('Fetching existing keywords...');
    const response = await axios.get('http://localhost:5000/api/keywords');
    return new Set(response.data.map(k => k.keyword.toLowerCase()));
  } catch (error) {
    console.error('Error fetching existing keywords:', error.message);
    return new Set();
  }
}

async function bulkImport() {
  try {
    // Get existing keywords to avoid duplicates
    const existingKeywords = await getExistingKeywords();
    console.log(`Found ${existingKeywords.size} existing keywords in database`);
    
    // Read keywords from the JSON file
    console.log('Reading keywords from file...');
    const keywordsData = JSON.parse(fs.readFileSync(KEYWORDS_FILE, 'utf8'));
    console.log(`Found ${keywordsData.length} keywords in file`);
    
    // Filter out already imported keywords
    const newKeywords = keywordsData.filter(kw => !existingKeywords.has(kw.keyword.toLowerCase()));
    console.log(`Filtered to ${newKeywords.length} new keywords to import`);
    
    if (newKeywords.length === 0) {
      console.log('No new keywords to import. All keywords have been imported.');
      return;
    }
    
    // Group keywords by their locationId and groupId
    // This allows us to send batches that have the same properties
    const groupedKeywords = new Map();
    
    newKeywords.forEach(kw => {
      const key = `${kw.locationId || 'null'}-${kw.groupId || 'null'}-${kw.targetUrl || 'null'}`;
      if (!groupedKeywords.has(key)) {
        groupedKeywords.set(key, {
          keywords: [],
          locationId: kw.locationId,
          groupId: kw.groupId,
          targetUrl: kw.targetUrl || null
        });
      }
      groupedKeywords.get(key).keywords.push(kw.keyword);
    });
    
    console.log(`Grouped keywords into ${groupedKeywords.size} batches by location and group`);
    
    // Import each batch
    let importedTotal = 0;
    let batchNumber = 1;
    
    for (const [key, batch] of groupedKeywords.entries()) {
      console.log(`Processing batch ${batchNumber++} of ${groupedKeywords.size} (${batch.keywords.length} keywords)`);
      console.log(`  Location ID: ${batch.locationId}, Group ID: ${batch.groupId}`);
      
      // Split into smaller batches to avoid overwhelming the API
      const MAX_BATCH_SIZE = 50;
      
      for (let i = 0; i < batch.keywords.length; i += MAX_BATCH_SIZE) {
        const keywordBatch = batch.keywords.slice(i, i + MAX_BATCH_SIZE);
        
        try {
          // Format the data as expected by the API
          const requestData = {
            keywords: keywordBatch,
            locationId: batch.locationId,
            targetUrl: batch.targetUrl,
            // Set both group and groupId fields
            group: batch.groupId ? batch.groupId.toString() : null,
            groupId: batch.groupId,
            trackDaily: false
          };
          
          const response = await axios.post(API_URL, requestData);
          
          if (response.status === 201) {
            const result = response.data;
            const successCount = result.results.filter(r => r.success).length;
            importedTotal += successCount;
            console.log(`  Successfully imported ${successCount} of ${keywordBatch.length} keywords (chunk ${Math.floor(i/MAX_BATCH_SIZE) + 1}/${Math.ceil(batch.keywords.length/MAX_BATCH_SIZE)})`);
          } else {
            console.error(`  Error importing batch: ${response.status} ${response.statusText}`);
          }
        } catch (error) {
          console.error(`  Error importing batch:`, error.message);
          if (error.response) {
            console.error(`  Response data:`, error.response.data);
          }
        }
        
        // Delay to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    console.log(`\nImport Summary:`);
    console.log(`- Total keywords in file: ${keywordsData.length}`);
    console.log(`- Already imported: ${existingKeywords.size}`);
    console.log(`- New keywords to import: ${newKeywords.length}`);
    console.log(`- Successfully imported: ${importedTotal}`);
    console.log(`- Failed: ${newKeywords.length - importedTotal}`);
    
  } catch (error) {
    console.error('Error in bulk import:', error.message);
  }
}

// Fix groupId for any keywords with string group values
async function fixGroupIds() {
  try {
    console.log('Fixing groupId values...');
    
    // Execute SQL directly instead of using an API endpoint
    // We'll do this manually through the SQL tool since we don't have a direct API endpoint
    console.log('Please run the following SQL manually:');
    console.log(`UPDATE "keywords" SET "groupId" = CAST("group" AS INTEGER) WHERE "group" ~ '^[0-9]+$' AND ("groupId" IS NULL OR "groupId" != CAST("group" AS INTEGER));`);
    
    return 0;
  } catch (error) {
    console.error('Error fixing groupId values:', error.message);
    return 0;
  }
}

async function main() {
  // Step 1: Import new keywords
  await bulkImport();
  
  // Step 2: Fix any group ID issues
  await fixGroupIds();
  
  console.log('Import process completed');
}

main()
  .then(() => console.log('Script execution completed'))
  .catch(err => console.error('Script execution failed:', err.message));