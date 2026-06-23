// Test script to verify our organic result filtering fix
import axios from 'axios';
import dotenv from 'dotenv';

// Load environment variables
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

// Function to test our fix
async function testSanFranciscoSearchWithFix() {
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

    console.log('=== Testing DataForSEO search with organic result filtering ===');
    console.log('Sending request with SF location code 1014221...');

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

    console.log(`Found ${task.result[0].items.length} total results`);

    // Filter for organic results only - OUR IMPROVED FIX
    const organicItems = task.result[0].items.filter(item => 
      // Only include true organic results
      item.type === 'organic' && 
      
      // Exclude potential ads 
      !item.url?.includes('/aclk?') &&     // Google ad click URLs
      !item.url?.includes('googleadservices.com') &&  // Google Ads services domain
      !item.url?.startsWith('https://www.google.com/ads/') && // Direct Google ad links
      
      // Exclude items that might be miscategorized local pack results
      // Sometimes Google categorizes local results as "organic" but they're actually from Maps/local
      !(item.url?.includes('google.com/maps') || 
        item.url?.includes('maps.google.com') ||
        (item.title?.includes('Maps') && item.domain?.includes('google.com')))
    );
    
    // Identify all local pack results (both explicit and disguised as organic)
    const localPackItems = task.result[0].items.filter(item => 
      item.type === 'local_pack' ||
      // Also include organic items that are actually maps results
      (item.type === 'organic' && 
        (item.url?.includes('google.com/maps') || 
         item.url?.includes('maps.google.com') ||
         (item.title?.includes('Maps') && item.domain?.includes('google.com'))))
    );
    
    console.log(`Found ${organicItems.length} true organic results`);
    console.log(`Found ${localPackItems.length} local pack results (both explicit and disguised)`);
    
    // Calculate true organic positions
    const organicPositions = {};
    let trueOrganicPosition = 1;
    
    // Sort organic items by their absolute rank to calculate true positions
    const sortedOrganicItems = [...organicItems].sort((a, b) => a.rank_absolute - b.rank_absolute);
    for (const item of sortedOrganicItems) {
      organicPositions[item.rank_absolute] = trueOrganicPosition++;
    }

    // Process results to find our target domain (tekrevol.com)
    const targetDomain = 'tekrevol.com';
    console.log(`\nLooking for domain: ${targetDomain}`);
    
    // Print summary of different result types for debugging
    const resultTypes = task.result[0].items.reduce((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + 1;
      return acc;
    }, {});
    console.log('Result types:', resultTypes);
    
    // Print first few organic results
    console.log('\n=== First 5 organic results ===');
    for (let i = 0; i < Math.min(5, organicItems.length); i++) {
      const item = organicItems[i];
      console.log(`Position ${item.rank_absolute} (${item.type}): ${item.domain} - ${item.url}`);
    }
    
    // Find our target in organic results
    console.log('\n=== Looking for target domain in organic results ===');
    for (const item of organicItems) {
      if (item.domain.toLowerCase().includes(targetDomain)) {
        const truePosition = organicPositions[item.rank_absolute] || item.rank_absolute;
        console.log(`Found target at position ${truePosition} (true organic position) / ${item.rank_absolute} (API position): ${item.url}`);
        return;
      }
    }
    
    console.log(`Target domain "${targetDomain}" not found in organic results`);
    
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the test
testSanFranciscoSearchWithFix();