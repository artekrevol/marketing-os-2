// Import keywords from JSON file to the database
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE_URL = 'http://localhost:5000/api';
const KEYWORDS_FILE = path.join(process.cwd(), 'keywords_import.json');

// Map location names to location IDs
const LOCATION_MAP = {
  'Houston': 1,
  'Miami': 2,
  'New York': 3,
  'Los Angeles': 4,
  'Chicago': 5,
  'San Francisco': 6
};

async function importKeywords() {
  try {
    // Read the keywords JSON file
    const keywordsData = JSON.parse(fs.readFileSync(KEYWORDS_FILE, 'utf8'));
    console.log(`Loaded ${keywordsData.length} keywords from file`);

    // Get existing keywords to avoid duplicates
    const response = await axios.get(`${API_BASE_URL}/keywords`);
    const existingKeywords = response.data || [];
    const existingKeywordMap = new Map(
      existingKeywords.map(k => [k.keyword.toLowerCase(), k])
    );

    console.log(`Found ${existingKeywords.length} existing keywords in database`);

    // Process keywords for import
    const newKeywords = [];
    const updatedKeywords = [];
    const failures = [];

    for (const item of keywordsData) {
      try {
        const keyword = item.keyword;
        const locationName = item.location;
        const position = item.position;
        
        // Map location name to ID
        let locationId = LOCATION_MAP['Houston']; // Default to Houston
        if (LOCATION_MAP[locationName]) {
          locationId = LOCATION_MAP[locationName];
        }

        // Check if keyword already exists
        const existingKeyword = existingKeywordMap.get(keyword.toLowerCase());
        
        if (existingKeyword) {
          // Update existing keyword's ranking if needed
          console.log(`Keyword already exists: "${keyword}" - updating ranking if needed`);
          
          // Add ranking if position is provided
          if (position !== null && position !== undefined) {
            const rankingData = {
              keywordId: existingKeyword.id,
              position: position,
              url: item.targetUrl || "https://www.tekrevol.com",
              date: new Date().toISOString()
            };
            
            try {
              await axios.post(`${API_BASE_URL}/rankings`, rankingData);
              updatedKeywords.push(keyword);
            } catch (rankErr) {
              console.error(`Failed to add ranking for existing keyword "${keyword}":`, rankErr.message);
              failures.push({ keyword, error: rankErr.message });
            }
          }
        } else {
          // Create new keyword
          const keywordData = {
            keyword: keyword,
            locationId: locationId,
            targetUrl: item.targetUrl || "https://www.tekrevol.com",
            group: item.group || "Imported",
            trackDaily: true
          };
          
          try {
            const result = await axios.post(`${API_BASE_URL}/keywords`, keywordData);
            const newKeywordId = result.data.id;
            
            // If position is provided, add a ranking
            if (position !== null && position !== undefined) {
              const rankingData = {
                keywordId: newKeywordId,
                position: position,
                url: item.targetUrl || "https://www.tekrevol.com",
                date: new Date().toISOString()
              };
              
              await axios.post(`${API_BASE_URL}/rankings`, rankingData);
            }
            
            newKeywords.push(keyword);
          } catch (keywordErr) {
            console.error(`Failed to create keyword "${keyword}":`, keywordErr.message);
            failures.push({ keyword, error: keywordErr.message });
          }
        }
      } catch (itemErr) {
        console.error(`Error processing item:`, itemErr.message, item);
        failures.push({ keyword: item.keyword, error: itemErr.message });
      }
    }

    // Print summary
    console.log('\nImport Summary:');
    console.log(`- New keywords created: ${newKeywords.length}`);
    console.log(`- Existing keywords updated: ${updatedKeywords.length}`);
    console.log(`- Failed imports: ${failures.length}`);
    
    if (failures.length > 0) {
      console.log('\nFailed imports:');
      failures.forEach(f => console.log(`- "${f.keyword}": ${f.error}`));
    }
    
    if (newKeywords.length > 0) {
      console.log('\nNewly imported keywords:');
      newKeywords.slice(0, 10).forEach(k => console.log(`- "${k}"`));
      if (newKeywords.length > 10) {
        console.log(`  ... and ${newKeywords.length - 10} more`);
      }
    }
    
  } catch (err) {
    console.error('Import failed:', err.message);
  }
}

// Run the import
importKeywords();