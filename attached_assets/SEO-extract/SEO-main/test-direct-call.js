// Simple test script to make a direct API call and verify the fix
import axios from 'axios';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testAPIWithFix() {
  try {
    // Make a direct API call to run a crawler job for the San Francisco location
    console.log("Testing API call with fixed location code for San Francisco...");
    
    // First, let's check the current location definition for San Francisco
    const locationsResponse = await axios.get('http://localhost:5000/api/locations');
    const sfLocation = locationsResponse.data.find(loc => loc.name === "San Francisco");
    
    if (sfLocation) {
      console.log(`Found San Francisco location: id=${sfLocation.id}, code=${sfLocation.code}`);
    } else {
      console.log("San Francisco location not found in database");
      return;
    }
    
    // Find keywords for San Francisco
    const keywordsResponse = await axios.get('http://localhost:5000/api/keywords');
    const sfKeywords = keywordsResponse.data.filter(kw => kw.locationId === sfLocation.id);
    
    if (sfKeywords.length > 0) {
      console.log(`Found ${sfKeywords.length} keywords for San Francisco location`);
      console.log(`First keyword: "${sfKeywords[0].keyword}" (ID: ${sfKeywords[0].id})`);
    } else {
      console.log("No keywords found for San Francisco location");
      return;
    }
    
    // Use the first keyword for testing
    const keywordId = sfKeywords[0].id;
    console.log(`\nStarting crawl for keyword ID ${keywordId}...`);
    
    const response = await axios.post('http://localhost:5000/api/crawl', { 
      keywordIds: [keywordId]
    });
    
    console.log("Crawl job started:");
    console.log("Batch ID:", response.data.batchId);
    console.log("Status:", response.data.status);
    
    // Now we wait for the job to complete
    console.log("\nWaiting for crawl job to complete...");
    let isComplete = false;
    let attempts = 0;
    let statusResponse;
    
    while (!isComplete && attempts < 20) {
      await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
      
      statusResponse = await axios.get('http://localhost:5000/api/crawl/status');
      console.log(`Attempt ${attempts + 1}: Status = ${statusResponse.data.status}`);
      
      if (statusResponse.data.status === 'completed') {
        isComplete = true;
      }
      
      attempts++;
    }
    
    if (!isComplete) {
      console.log("Crawl job did not complete in time. Check the dashboard for results.");
      return;
    }
    
    // Get the results for the specific keyword
    console.log(`\nGetting latest ranking for keyword ID ${keywordId}...`);
    const rankingsResponse = await axios.get('http://localhost:5000/api/keywords/rankings');
    
    const sf_keyword = rankingsResponse.data.find(k => k.id === keywordId);
    
    if (sf_keyword) {
      console.log("\n=== San Francisco Keyword Results ===");
      console.log("Keyword:", sf_keyword.keyword);
      console.log("Target URL:", sf_keyword.targetUrl);
      console.log("Location:", sf_keyword.location);
      console.log("Current position:", sf_keyword.latestRanking.position);
      console.log("URL found:", sf_keyword.latestRanking.url);
      
      // Verify that the position is in the expected range (10-15) for organic results
      if (sf_keyword.latestRanking.position >= 10 && sf_keyword.latestRanking.position <= 15) {
        console.log("\n✅ SUCCESS: Position corresponds to the organic result (expected ~10-15)");
      } else if (sf_keyword.latestRanking.position < 5) {
        console.log("\n❌ FAILED: Position still corresponds to the local_pack result");
      } else {
        console.log(`\n⚠️ UNEXPECTED: Position ${sf_keyword.latestRanking.position} is different from expected range`);
      }
    } else {
      console.log(`Could not find keyword ID ${keywordId} in the rankings data`);
    }
    
  } catch (error) {
    console.error("Error:", error.message);
    if (error.response) {
      console.error("Response:", error.response.data);
    }
  }
}

testAPIWithFix();