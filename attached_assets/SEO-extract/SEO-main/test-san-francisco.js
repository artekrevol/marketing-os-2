const axios = require('axios');
require('dotenv').config();

const apiLogin = process.env.DATAFORSEO_API_LOGIN;
const apiPassword = process.env.DATAFORSEO_API_PASSWORD;

if (!apiLogin || !apiPassword) {
  console.error('DataForSEO API credentials not found');
  process.exit(1);
}

// Basic auth for DataForSEO
const auth = Buffer.from(`${apiLogin}:${apiPassword}`).toString('base64');

async function testSanFranciscoSearch() {
  try {
    // Prepare the API payload with San Francisco location code and our target keyword
    const payload = {
      "language_code": "en",
      "location_code": 1014221, // San Francisco,California,United States
      "keyword": "mobile app developers san francisco",
      "calculate_rectangles": false,
      "device": "desktop",
      "os": "windows",
      "depth": 100
    };

    console.log('Sending request to DataForSEO...');
    console.log('Payload:', JSON.stringify(payload, null, 2));

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

    // Print all results with position, domain and URL
    console.log('\nAll search results:');
    task.result[0].items.forEach((item, index) => {
      console.log(`Position ${item.rank_absolute}: ${item.domain} - ${item.url}`);
    });

    // Process results to find our target domain (tekrevol.com)
    const targetDomain = 'tekrevol.com';
    console.log(`\nLooking for domain: ${targetDomain}`);
    
    for (const item of task.result[0].items) {
      const itemDomain = item.domain?.toLowerCase();
      const itemUrl = item.url;

      if (itemDomain && itemDomain.includes(targetDomain)) {
        console.log(`\nFound target at position ${item.rank_absolute}: ${itemUrl}`);
        return;
      }
    }

    console.log(`\nTarget domain "${targetDomain}" not found in top ${task.result[0].items.length} results`);

  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

testSanFranciscoSearch();