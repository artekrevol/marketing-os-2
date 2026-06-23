/**
 * Test script to verify our position calculation fix
 * This runs a direct test on the target keyword to verify position accuracy
 */
const { storage } = require('./server/storage');
const { searchWithDataForSEO } = require('./server/dataForSEO');

async function testPositionFix() {
  try {
    console.log('Testing position fix implementation...');
    
    // Look for our target keyword in the San Francisco location
    const targetKeywordText = 'mobile app development company in san francisco';
    const targetDomain = 'tekrevol.com';
    
    // Fetch all keywords
    const keywords = await storage.getKeywords();
    
    // Find our target keyword
    const targetKeyword = keywords.find(k => 
      k.keyword.toLowerCase() === targetKeywordText
    );
    
    if (!targetKeyword) {
      console.error(`Target keyword "${targetKeywordText}" not found in database`);
      return;
    }
    
    console.log(`Found target keyword: ${targetKeyword.keyword} (ID: ${targetKeyword.id})`);
    
    // Get the location for this keyword
    const location = await storage.getLocation(targetKeyword.locationId);
    if (!location) {
      console.error(`Location not found for keyword ID ${targetKeyword.id}`);
      return;
    }
    
    console.log(`Location: ${location.name} (ID: ${location.id})`);
    
    // Execute a direct search using the DataForSEO API function
    console.log(`Running direct DataForSEO search for "${targetKeyword.keyword}" in ${location.name}...`);
    const searchResults = await searchWithDataForSEO(targetKeyword, targetDomain, location);
    
    // Display the results
    console.log('\nSearch Results:');
    searchResults.forEach(result => {
      if (result.position === -1) {
        console.log(`- Not found in results (${result.resultType})`);
      } else {
        console.log(`- Position ${result.position} (${result.resultType}): ${result.url}`);
      }
    });
    
    // Find the main organic result
    const organicResult = searchResults.find(r => r.resultType === 'organic');
    
    if (organicResult) {
      console.log('\nORGANIC RESULT:');
      console.log(`Position: ${organicResult.position}`);
      console.log(`URL: ${organicResult.url || 'Not found'}`);
      
      // Verify if the position matches our expected position
      if (organicResult.position === 7) {
        console.log('\n✅ SUCCESS: Position matches expected position 7');
      } else {
        const difference = Math.abs(organicResult.position - 7);
        console.log(`\n❌ MISMATCH: Position ${organicResult.position} does not match expected position 7 (off by ${difference})`);
      }
    } else {
      console.log('\nNo organic result found');
    }
    
  } catch (error) {
    console.error('Error testing position fix:', error);
  }
}

// Run the test
testPositionFix();