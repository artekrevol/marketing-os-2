/**
 * Test script for checking the DataForSEO integration with fixed code
 * Run with: node test-fixed-crawler.js
 */

import axios from 'axios';

async function testFixedCrawler() {
  try {
    console.log('Testing crawler with a single keyword...');
    
    // Get the first keyword from the database
    const keywordsResponse = await axios.get('http://localhost:5000/api/keywords');
    const keywords = keywordsResponse.data;
    
    if (!keywords || keywords.length === 0) {
      console.error('No keywords found in the database');
      return;
    }
    
    // Select just the first keyword for testing
    const keywordToTest = keywords[0];
    console.log(`Selected keyword for testing: "${keywordToTest.keyword}" (ID: ${keywordToTest.id})`);
    
    // Start a crawl with just this one keyword
    console.log('Starting a test crawl with a single keyword...');
    const crawlResponse = await axios.post('http://localhost:5000/api/crawl', {
      keywordIds: [keywordToTest.id]
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
      
      // Check the results
      const rankingResponse = await axios.get('http://localhost:5000/api/current-rankings?resultType=organic');
      const organicResults = rankingResponse.data;
      
      // Find our test keyword
      const keywordResult = organicResults.find(r => r.keywordId === keywordToTest.id);
      if (keywordResult) {
        console.log('\nRESULTS FOR TEST KEYWORD:');
        console.log(`Keyword: ${keywordResult.keyword}`);
        console.log(`Position: ${keywordResult.position}`);
        console.log(`Result Type: ${keywordResult.resultType}`);
        if (keywordResult.url) {
          console.log(`URL: ${keywordResult.url}`);
        }
        if (keywordResult.title) {
          console.log(`Title: ${keywordResult.title}`);
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

testFixedCrawler();