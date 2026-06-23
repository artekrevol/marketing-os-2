// Quick test for San Francisco location code detection
import axios from 'axios';

async function testSFLocation() {
  try {
    // Start a crawl for San Francisco keyword
    console.log("Testing San Francisco location code detection...");
    
    // First get the San Francisco location ID
    const locationsResponse = await axios.get('http://localhost:5000/api/locations');
    const sfLocation = locationsResponse.data.find(loc => loc.name === "San Francisco");
    
    if (!sfLocation) {
      console.log("San Francisco location not found!");
      return;
    }
    
    console.log(`Found San Francisco location: id=${sfLocation.id}, code=${sfLocation.code}`);
    
    // Get keywords for San Francisco
    const keywordsResponse = await axios.get('http://localhost:5000/api/keywords');
    const sfKeywords = keywordsResponse.data.filter(kw => kw.locationId === sfLocation.id);
    
    if (sfKeywords.length === 0) {
      console.log("No San Francisco keywords found!");
      return;
    }
    
    // Use the first keyword
    const sfKeyword = sfKeywords[0];
    console.log(`Using keyword: "${sfKeyword.keyword}" (ID: ${sfKeyword.id})`);
    
    // Start crawl for this keyword
    console.log("\nStarting crawler for San Francisco keyword...");
    const response = await axios.post('http://localhost:5000/api/crawl', {
      keywordIds: [sfKeyword.id]
    });
    
    console.log(`Crawl started, batch ID: ${response.data.batchId}`);
    console.log(`Check the logs for "Using specific location code for San Francisco, CA: 1014221" message`);
    
  } catch (error) {
    console.error("Error:", error.message);
    if (error.response) {
      console.error("Response:", error.response.data);
    }
  }
}

testSFLocation();