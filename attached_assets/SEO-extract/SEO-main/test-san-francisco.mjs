// Direct API call test for San Francisco location using DataForSEO
import axios from 'axios';
import dotenv from 'dotenv';

// Read .env file
dotenv.config();

// Get API credentials
const apiLogin = process.env.DATAFORSEO_API_LOGIN;
const apiPassword = process.env.DATAFORSEO_API_PASSWORD;

if (!apiLogin || !apiPassword) {
  console.error('DataForSEO API credentials not found in environment variables');
  process.exit(1);
}

// Basic auth for DataForSEO
const auth = Buffer.from(`${apiLogin}:${apiPassword}`).toString('base64');

// Make direct API call with the correct SF location code
async function testSanFranciscoSearch() {
  try {
    // Prepare the API payload with the correct location code
    const payload = {
      "language_code": "en",
      "location_code": 1014221, // San Francisco,California,United States
      "keyword": "mobile app developers san francisco",
      "calculate_rectangles": false,
      "device": "desktop",
      "os": "windows",
      "depth": 100
    };

    console.log('Sending request to DataForSEO with SF location code 1014221...');

    const response = await axios.post(
      'https://api.dataforseo.com/v3/serp/google/organic/live/advanced',
      [payload],
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      }
    );

    const data = response.data;

    // Check API response
    if (data.status_code !== 20000) {
      console.error(`DataForSEO API error code: ${data.status_code}, message: ${data.status_message}`);
      return;
    }

    // Make sure we have at least one task
    const task = data.tasks[0];
    if (!task) {
      console.error('No tasks returned from DataForSEO API');
      return;
    }

    // Check task status
    if (task.status_code !== 20000) {
      console.error(`DataForSEO task error code: ${task.status_code}, message: ${task.status_message}`);
      return;
    }

    if (!task.result?.[0]?.items?.length) {
      console.log('No search results found');
      return;
    }

    console.log(`Found ${task.result[0].items.length} results`);

    // Process results to find our target domain (tekrevol.com)
    const targetDomain = 'tekrevol.com';
    console.log(`\nLooking for domain: ${targetDomain}`);
    
    // Print out all results so we can analyze them
    console.log("\n=== First 20 search results ===");
    
    for (let i = 0; i < Math.min(20, task.result[0].items.length); i++) {
      const item = task.result[0].items[i];
      
      if (!item.domain) continue;
      
      const itemRank = item.rank_absolute;
      const itemType = item.type;
      const itemDomain = item.domain.toLowerCase();
      const itemUrl = item.url;
      
      console.log(`Position ${itemRank} (${itemType}): ${itemDomain} - ${itemUrl}`);
    }
    
    // Now look for our target domain
    console.log("\n=== Searching for target domain ===");
    
    let found = false;
    for (let i = 0; i < task.result[0].items.length; i++) {
      const item = task.result[0].items[i];
      
      if (!item.domain) continue;
      
      const itemDomain = item.domain.toLowerCase();
      const itemUrl = item.url;
      const itemType = item.type;

      if (itemDomain.includes(targetDomain)) {
        console.log(`Found target at position ${item.rank_absolute} (${itemType}): ${itemUrl}`);
        found = true;
        // Don't break, continue to find all instances
      }
    }
    
    if (!found) {
      console.log(`Target domain "${targetDomain}" not found in ${task.result[0].items.length} results`);
    }

  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the test
testSanFranciscoSearch();