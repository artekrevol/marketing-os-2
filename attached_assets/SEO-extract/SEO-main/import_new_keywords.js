/**
 * Script to import new keywords from the generated JSON file
 * 
 * This script will:
 * 1. Delete all existing keywords using the API
 * 2. Import new keywords from keywords_import.json using the API
 * 3. Set the appropriate group and location for each keyword
 * 
 * Run with: node import_new_keywords.js
 */

import fs from 'fs';
import axios from 'axios';

const API_BASE_URL = 'http://localhost:5000/api';
const KEYWORDS_FILE = './keywords_import.json';

// Delete all existing keywords
async function deleteAllKeywords() {
  try {
    console.log('Fetching all keywords...');
    const response = await axios.get(`${API_BASE_URL}/keywords`);
    const keywords = response.data;
    
    console.log(`Found ${keywords.length} keywords to delete`);
    let deletedCount = 0;
    
    for (const keyword of keywords) {
      try {
        await axios.delete(`${API_BASE_URL}/keywords/${keyword.id}`);
        deletedCount++;
        
        if (deletedCount % 10 === 0) {
          console.log(`Deleted ${deletedCount} of ${keywords.length} keywords...`);
        }
      } catch (error) {
        console.error(`Error deleting keyword ${keyword.id}:`, error.message);
      }
    }
    
    console.log(`Successfully deleted ${deletedCount} of ${keywords.length} keywords`);
  } catch (error) {
    console.error('Error in delete operation:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

// Import new keywords from the JSON file
async function importNewKeywords() {
  try {
    console.log('Reading keywords from file...');
    const keywordsData = JSON.parse(fs.readFileSync(KEYWORDS_FILE, 'utf8'));
    console.log(`Found ${keywordsData.length} keywords to import`);
    
    // Process in batches to avoid overwhelming the API
    const batchSize = 50;
    let importedCount = 0;
    
    for (let i = 0; i < keywordsData.length; i += batchSize) {
      const batch = keywordsData.slice(i, Math.min(i + batchSize, keywordsData.length));
      console.log(`Processing batch ${Math.floor(i/batchSize) + 1} (${i+1} to ${Math.min(i + batchSize, keywordsData.length)})`);
      
      try {
        const response = await axios.post(`${API_BASE_URL}/keywords/bulk`, batch);
        
        if (response.status === 201) {
          importedCount += batch.length;
          console.log(`Successfully imported ${importedCount} of ${keywordsData.length} keywords...`);
        } else {
          console.error(`Error importing batch: ${response.status} ${response.statusText}`);
        }
      } catch (error) {
        console.error('Error importing batch:', error.message);
        if (error.response) {
          console.error('Response data:', error.response.data);
        }
      }
      
      // Small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`\nImport Summary:`);
    console.log(`- Total keywords: ${keywordsData.length}`);
    console.log(`- Successfully imported: ${importedCount}`);
    console.log(`- Failed: ${keywordsData.length - importedCount}`);
    
  } catch (error) {
    console.error('Error in import operation:', error.message);
  }
}

// Main function to run the import process
async function main() {
  try {
    console.log('Starting keyword import process...');
    
    // Step 1: We already deleted the keywords using SQL
    console.log('Keywords already deleted using SQL');
    
    // Step 2: Import new keywords
    await importNewKeywords();
    
    console.log('Import process completed successfully');
  } catch (error) {
    console.error('Error in main process:', error.message);
  }
}

main()
  .then(() => console.log('Script execution completed'))
  .catch(err => console.error('Script execution failed:', err.message));