// Test script for San Francisco location debugging
import axios from 'axios';

async function testSFDebug() {
  try {
    // Get the San Francisco location data
    console.log("Checking San Francisco location data...");
    const locationsResponse = await axios.get('http://localhost:5000/api/locations');
    const sfLocation = locationsResponse.data.find(loc => loc.name === "San Francisco");
    
    if (!sfLocation) {
      console.log("San Francisco location not found!");
      return;
    }
    
    // Debug output
    console.log("San Francisco location details:");
    console.log(JSON.stringify(sfLocation, null, 2));
    
    // Add a log message to show what's happening with the location code
    console.log("\nStarting test API call with San Francisco keyword...");
    
    // Get a San Francisco keyword
    const keywordsResponse = await axios.get('http://localhost:5000/api/keywords');
    const sfKeywords = keywordsResponse.data.filter(kw => kw.locationId === sfLocation.id);
    
    if (sfKeywords.length === 0) {
      console.log("No San Francisco keywords found!");
      return;
    }
    
    const sfKeyword = sfKeywords[0];
    console.log(`Testing with keyword: "${sfKeyword.keyword}" (ID: ${sfKeyword.id})`);
    
    // Make a direct request to test the location code
    const testResponse = await axios.post('http://localhost:5000/api/crawl', {
      keywordIds: [sfKeyword.id]
    });
    
    console.log("Crawl initiated:");
    console.log(JSON.stringify(testResponse.data, null, 2));
    console.log("\nCheck the server logs to see the location code being used.");
    
  } catch (error) {
    console.error("Error:", error.message);
    if (error.response) {
      console.error("Response:", error.response.data);
    }
  }
}

testSFDebug();