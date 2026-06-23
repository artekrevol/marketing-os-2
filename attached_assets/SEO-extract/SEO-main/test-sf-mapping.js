// Test the San Francisco mapping function
// Let's create a more direct test using our actual API

import axios from 'axios';

// Mock a location object with San Francisco data
const sfLocation = {
  id: 6,
  name: "San Francisco",
  code: "CA,US"
};

async function testLocationMapping() {
  // Use the API directly to check if it's using the correct location code
  try {
    // Get API credentials
    const apiLogin = process.env.DATAFORSEO_API_LOGIN;
    const apiPassword = process.env.DATAFORSEO_API_PASSWORD;
  
    if (!apiLogin || !apiPassword) {
      console.error('DataForSEO API credentials not found in environment variables');
      process.exit(1);
    }
  
    // Basic auth for DataForSEO
    const auth = Buffer.from(`${apiLogin}:${apiPassword}`).toString('base64');
  
    // Let's use the actual location code in our request
    const payload = {
      "language_code": "en",
      "location_code": 1014221, // San Francisco specific location code
      "keyword": "mobile app developers san francisco",
      "calculate_rectangles": false,
      "device": "desktop",
      "os": "windows",
      "depth": 100
    };
  
    console.log('Testing with direct location code 1014221 for San Francisco...');
    
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
    if (data.tasks && data.tasks[0] && data.tasks[0].result) {
      console.log(`API returned ${data.tasks[0].result[0]?.items?.length || 0} results for location code 1014221`);
      
      if (data.tasks[0].result[0] && data.tasks[0].result[0].items) {
        // Count result types
        const items = data.tasks[0].result[0].items;
        const typeCounts = {};
        items.forEach(item => {
          typeCounts[item.type] = (typeCounts[item.type] || 0) + 1;
        });
        
        console.log('Result type breakdown:', typeCounts);
        
        // Verify organic filtering works
        const organicItems = items.filter(item => item.type === 'organic');
        console.log(`Found ${organicItems.length} organic results`);
        
        // Look for tekrevol.com in both all results and organic results
        console.log('\nSearching for tekrevol.com in all results:');
        for (let i = 0; i < Math.min(5, items.length); i++) {
          const item = items[i];
          if (item.domain.includes('tekrevol.com')) {
            console.log(`Found tekrevol.com at position ${item.rank_absolute} (${item.type}): ${item.url}`);
          }
        }
        
        console.log('\nSearching for tekrevol.com in organic results only:');
        for (let i = 0; i < organicItems.length; i++) {
          const item = organicItems[i];
          if (item.domain.includes('tekrevol.com')) {
            console.log(`Found tekrevol.com at organic position ${item.rank_absolute}: ${item.url}`);
            break;
          }
        }
      }
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Run the test
testLocationMapping();