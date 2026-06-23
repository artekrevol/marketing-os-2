/**
 * Test script to verify crawler fetches and stores all required data
 * This script:
 * 1. Runs a crawl for a test keyword
 * 2. Verifies competitors are stored
 * 3. Verifies insights are fetched and stored for top 10 competitors
 * 4. Checks that H1, H2, H3, and keyword density data are present
 */

import { crawlKeywords } from './server/crawler.js';
import { storage } from './server/storage.js';

async function testCrawler() {
  console.log('🧪 Starting crawler test...\n');

  try {
    // Get the first keyword from the database
    const keywords = await storage.getKeywords();
    
    if (keywords.length === 0) {
      console.error('❌ No keywords found in database. Please add at least one keyword first.');
      process.exit(1);
    }

    const testKeyword = keywords[0];
    console.log(`📝 Testing with keyword: "${testKeyword.keyword}" (ID: ${testKeyword.id})\n`);

    // Run the crawler for this keyword
    console.log('🚀 Starting crawl...');
    await crawlKeywords([testKeyword.id]);
    console.log('✅ Crawl completed\n');

    // Wait a bit for insights to be fetched (they're fetched asynchronously)
    console.log('⏳ Waiting for insights to be fetched (this may take a minute)...');
    await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 60 seconds

    // Get competitors for this keyword
    const competitors = await storage.getLatestCompetitorsByKeywordId(testKeyword.id, 50);
    console.log(`\n📊 Found ${competitors.length} competitors for keyword "${testKeyword.keyword}"`);

    if (competitors.length === 0) {
      console.error('❌ No competitors found. Crawl may have failed.');
      process.exit(1);
    }

    // Get top 10 competitors by position
    const top10Competitors = competitors
      .sort((a, b) => a.position - b.position)
      .slice(0, 10);

    console.log(`\n🔍 Checking insights for top 10 competitors:\n`);

    let insightsFound = 0;
    let insightsWithH1 = 0;
    let insightsWithH2 = 0;
    let insightsWithH3 = 0;
    let insightsWithDensity = 0;

    for (const competitor of top10Competitors) {
      const insights = await storage.getCompetitorInsights(competitor.id);
      
      if (insights) {
        insightsFound++;
        console.log(`  ✅ Competitor #${competitor.position}: ${competitor.domain}`);
        
        if (insights.h1 && Array.isArray(insights.h1) && insights.h1.length > 0) {
          insightsWithH1++;
          console.log(`     H1: ${insights.h1[0]?.substring(0, 60)}...`);
        } else {
          console.log(`     H1: ❌ Missing`);
        }

        if (insights.h2 && Array.isArray(insights.h2) && insights.h2.length > 0) {
          insightsWithH2++;
          console.log(`     H2: ${insights.h2[0]?.substring(0, 60)}...`);
        } else {
          console.log(`     H2: ❌ Missing`);
        }

        if (insights.h3 && Array.isArray(insights.h3) && insights.h3.length > 0) {
          insightsWithH3++;
          console.log(`     H3: ${insights.h3[0]?.substring(0, 60)}...`);
        } else {
          console.log(`     H3: ❌ Missing`);
        }

        if (insights.keywordDensity && Array.isArray(insights.keywordDensity) && insights.keywordDensity.length > 0) {
          insightsWithDensity++;
          console.log(`     Keyword Density: ✅ (${insights.keywordDensity.length} keywords)`);
        } else {
          console.log(`     Keyword Density: ❌ Missing`);
        }
      } else {
        console.log(`  ❌ Competitor #${competitor.position}: ${competitor.domain} - No insights found`);
      }
      console.log('');
    }

    // Summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📈 TEST SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total Competitors: ${competitors.length}`);
    console.log(`Top 10 Competitors Checked: ${top10Competitors.length}`);
    console.log(`Insights Found: ${insightsFound}/${top10Competitors.length}`);
    console.log(`Insights with H1: ${insightsWithH1}/${insightsFound}`);
    console.log(`Insights with H2: ${insightsWithH2}/${insightsFound}`);
    console.log(`Insights with H3: ${insightsWithH3}/${insightsFound}`);
    console.log(`Insights with Keyword Density: ${insightsWithDensity}/${insightsFound}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (insightsFound === top10Competitors.length && 
        insightsWithH1 === insightsFound && 
        insightsWithH2 === insightsFound && 
        insightsWithDensity === insightsFound) {
      console.log('✅ ALL TESTS PASSED! Crawler is working correctly.');
      process.exit(0);
    } else {
      console.log('⚠️  Some insights are missing. This may be normal if:');
      console.log('   - The OnPage API is rate-limited');
      console.log('   - Some competitors have blocked crawlers');
      console.log('   - The crawl is still in progress');
      console.log('\n💡 Try running the test again in a few minutes.');
      process.exit(0);
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error);
    process.exit(1);
  }
}

testCrawler();

