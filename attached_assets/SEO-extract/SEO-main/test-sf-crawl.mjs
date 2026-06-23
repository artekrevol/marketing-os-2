// Test script to run a new crawl for the San Francisco keyword
import axios from 'axios';

async function testSanFranciscoCrawl() {
  try {
    console.log('Testing crawler with San Francisco keyword...');
    
    // Find the specific San Francisco keyword
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
    
    // Start a crawl with just this one keyword
    console.log('Starting a test crawl for San Francisco keyword...');
    const crawlResponse = await axios.post('http://localhost:5000/api/crawl', {
      keywordIds: [targetKeyword.id]
    });
    
    const result = crawlResponse.data;
    console.log('Crawl started:', result);
    
    // Poll for status until it completes or fails
    let crawlStatus = 'running';
    let statusData;
    
    console.log('Polling for crawler status...');
    while (crawlStatus === 'running') {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds between polls
      
      const statusResponse = await axios.get('http://localhost:5000/api/crawl/status');
      statusData = statusResponse.data;
      crawlStatus = statusData.status;
      
      console.log(`Crawl status: ${crawlStatus} - Progress: ${statusData.stats?.completed || 0}/${statusData.stats?.total || 0}`);
    }
    
    // Show final results
    if (crawlStatus === 'completed') {
      console.log('\n==== CRAWL COMPLETED SUCCESSFULLY ====');
      console.log(`Processed ${statusData.stats.completed} keywords with ${statusData.stats.failed} failures`);
      
      // Check the updated ranking
      const rankingResponse = await axios.get('http://localhost:5000/api/current-rankings?resultType=organic');
      const organicResults = rankingResponse.data;
      
      // Find our test keyword
      const keywordResult = organicResults.find(r => r.keywordId === targetKeyword.id);
      if (keywordResult) {
        console.log('\nNEW RANKING INFORMATION:');
        console.log(`Keyword: ${keywordResult.keyword}`);
        console.log(`Position: ${keywordResult.position}`);
        console.log(`Result Type: ${keywordResult.resultType}`);
        
        if (keywordResult.url) {
          console.log(`URL: ${keywordResult.url}`);
        }
        
        if (keywordResult.title) {
          console.log(`Title: ${keywordResult.title}`);
        }
        
        // Verify if the position matches our expected position (7)
        if (keywordResult.position == 7) {
          console.log('\n✅ SUCCESS: Position matches expected position 7');
        } else {
          const difference = Math.abs(keywordResult.position - 7);
          console.log(`\n❌ MISMATCH: Position ${keywordResult.position} does not match expected position 7 (off by ${difference})`);
        }
      } else {
        console.log('No results found for the test keyword');
      }
    } else {
      console.log('\n==== CRAWL FAILED ====');
      console.log('Reason:', statusData.message || 'Unknown error');
    }
    
  } catch (error) {
    console.error('Error testing crawler:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
  }
}

testSanFranciscoCrawl();