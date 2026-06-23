// Simple test script for San Francisco position verification
const axios = require('axios');

async function testSanFranciscoPositions() {
  try {
    console.log('Testing San Francisco keyword positions...');
    
    // Check if the specific San Francisco keyword exists
    const keywordsResponse = await axios.get('http://localhost:5000/api/keywords');
    const keywords = keywordsResponse.data;
    
    // Look for our target San Francisco keyword
    const targetKeyword = keywords.find(k => 
      k.keyword.toLowerCase() === 'mobile app development company in san francisco'
    );
    
    if (!targetKeyword) {
      console.log('Target keyword "mobile app development company in san francisco" not found');
      return;
    }

    console.log(`Found target keyword: "${targetKeyword.keyword}" (ID: ${targetKeyword.id})`);
    
    // Get current rankings to see the position
    const rankingsResponse = await axios.get('http://localhost:5000/api/current-rankings?resultType=organic');
    const organicRankings = rankingsResponse.data;
    
    // Find our target keyword in the rankings
    const keywordRanking = organicRankings.find(r => r.keywordId === targetKeyword.id);
    
    if (keywordRanking) {
      console.log('\nCURRENT RANKING INFORMATION:');
      console.log(`Keyword: ${keywordRanking.keyword}`);
      console.log(`Position: ${keywordRanking.position}`);
      console.log(`Result Type: ${keywordRanking.resultType}`);
      console.log(`URL: ${keywordRanking.url || 'N/A'}`);
      console.log(`Title: ${keywordRanking.title || 'N/A'}`);
      console.log(`Last Checked: ${keywordRanking.lastChecked || 'N/A'}`);
      
      // Verify if the position matches our expected position (7)
      if (keywordRanking.position == 7) {
        console.log('\n✅ SUCCESS: Position matches expected position 7');
      } else {
        const difference = Math.abs(keywordRanking.position - 7);
        console.log(`\n❌ MISMATCH: Position ${keywordRanking.position} does not match expected position 7 (off by ${difference})`);
      }
    } else {
      console.log('No rankings found for the target keyword');
    }
    
  } catch (error) {
    console.error('Error testing San Francisco positions:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
  }
}

testSanFranciscoPositions();