/**
 * Script to analyze the latest batch of keyword rankings
 * 
 * This script:
 * 1. Finds keywords in 1st position
 * 2. Finds keywords that weren't found in search results
 * 3. Reports them categorized by result type (organic, other_organic, local_pack)
 */

const axios = require('axios');

async function analyzeRankings() {
  try {
    // Get the current rankings
    const response = await axios.get('http://localhost:5000/api/current-rankings?resultType=organic');
    const organicResults = response.data;
    
    const otherOrganic = await axios.get('http://localhost:5000/api/current-rankings?resultType=other_organic');
    const otherOrganicResults = otherOrganic.data;
    
    const localPack = await axios.get('http://localhost:5000/api/current-rankings?resultType=local_pack');
    const localPackResults = localPack.data;

    // Find keywords in 1st position for organic results
    const topOrganicKeywords = organicResults.filter(r => r.position === 1);
    console.log('\n==== KEYWORDS IN 1ST POSITION (ORGANIC) ====');
    if (topOrganicKeywords.length === 0) {
      console.log('No keywords found in 1st position for organic results');
    } else {
      topOrganicKeywords.forEach(k => {
        console.log(`- ${k.keyword} (Location: ${k.locationName})`);
      });
    }

    // Find keywords in 1st position for other organic results
    const topOtherOrganicKeywords = otherOrganicResults.filter(r => r.position === 1);
    console.log('\n==== KEYWORDS IN 1ST POSITION (OTHER ORGANIC) ====');
    if (topOtherOrganicKeywords.length === 0) {
      console.log('No keywords found in 1st position for other organic results');
    } else {
      topOtherOrganicKeywords.forEach(k => {
        console.log(`- ${k.keyword} (Location: ${k.locationName})`);
      });
    }

    // Find keywords in 1st position for local pack results
    const topLocalPackKeywords = localPackResults.filter(r => r.position === 1);
    console.log('\n==== KEYWORDS IN 1ST POSITION (LOCAL PACK) ====');
    if (topLocalPackKeywords.length === 0) {
      console.log('No keywords found in 1st position for local pack results');
    } else {
      topLocalPackKeywords.forEach(k => {
        console.log(`- ${k.keyword} (Location: ${k.locationName})`);
      });
    }

    // Find keywords not found in search results for each type
    const notFoundOrganic = organicResults.filter(r => r.position === -1);
    console.log('\n==== KEYWORDS NOT FOUND (ORGANIC) ====');
    if (notFoundOrganic.length === 0) {
      console.log('All keywords were found in organic results');
    } else {
      notFoundOrganic.forEach(k => {
        console.log(`- ${k.keyword} (Location: ${k.locationName})`);
      });
    }

    // Count total keywords
    console.log('\n==== SUMMARY ====');
    console.log(`Total keywords tracked: ${organicResults.length}`);
    console.log(`Keywords in 1st position (organic): ${topOrganicKeywords.length}`);
    console.log(`Keywords in 1st position (other organic): ${topOtherOrganicKeywords.length}`);
    console.log(`Keywords in 1st position (local pack): ${topLocalPackKeywords.length}`);
    console.log(`Keywords not found in organic results: ${notFoundOrganic.length}`);
  } catch (error) {
    console.error('Error analyzing rankings:', error.message);
  }
}

// Run the analysis
analyzeRankings();