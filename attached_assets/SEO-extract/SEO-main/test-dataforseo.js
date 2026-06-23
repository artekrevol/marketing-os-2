// Simple script to test DataForSEO API directly

import axios from 'axios';

async function testDataForSEO() {
  try {
    // Try to get credentials from both possible environment variable names
    const apiLogin = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
    const apiPassword = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;

    if (!apiLogin || !apiPassword) {
      console.error('DataForSEO API credentials not found in environment variables');
      return;
    }

    // Basic auth for DataForSEO
    const auth = Buffer.from(`${apiLogin}:${apiPassword}`).toString('base64');

    // Test payload based on our application's format
    const payload = [{
      "language_code": "en",
      "location_code": 1014221, // San Francisco location code
      "keyword": "mobile app developers san francisco",
      "calculate_rectangles": false,
      "device": "desktop",
      "os": "windows",
      "depth": 100
    }];

    console.log('Sending request to DataForSEO with payload:', JSON.stringify(payload));

    const response = await axios.post(
      'https://api.dataforseo.com/v3/serp/google/organic/live/advanced',
      payload,
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Response status:', response.status);
    console.log('Response data:', JSON.stringify(response.data, null, 2));

  } catch (error) {
    console.error('Error details:', error.response ? error.response.data : error.message);
  }
}

testDataForSEO();