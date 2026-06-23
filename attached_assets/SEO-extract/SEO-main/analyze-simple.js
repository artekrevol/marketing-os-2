/**
 * Simplified script to analyze competitor websites and save the data to a JSON file
 * This avoids the complexity of direct database insertion
 * 
 * Run with: node analyze-simple.js
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';

// Competitor URLs to analyze - these are the URLs we found in our search
const competitors = [
  { domain: 'topflightapps.com', url: 'https://topflightapps.com/healthcare/healthcare-app-developer/', position: 1 },
  { domain: 'clutch.co', url: 'https://clutch.co/app-developers/health-wellness', position: 2 },
  { domain: 'www.itransition.com', url: 'https://www.itransition.com/healthcare/mobile', position: 3 },
  { domain: 'www.tekrevol.com', url: 'https://www.tekrevol.com/healthcare-app-development', position: 4 },
  { domain: 'www.bluelabellabs.com', url: 'https://www.bluelabellabs.com/healthcare-mobile-app-development/', position: 5 },
  { domain: 'www.chetu.com', url: 'https://www.chetu.com/mobile-health-application-development.php', position: 6 },
  { domain: 'www.osplabs.com', url: 'https://www.osplabs.com/healthcare-app-development-services/', position: 7 },
  { domain: 'www.scnsoft.com', url: 'https://www.scnsoft.com/healthcare/mobile', position: 8 },
  { domain: 'www.dogtownmedia.com', url: 'https://www.dogtownmedia.com/app-development-services/healthcare-app-developer/', position: 9 },
  { domain: 'www.elinext.com', url: 'https://www.elinext.com/industries/healthcare/mhealth-app-development/', position: 10 }
];

/**
 * Calculate keyword density from text
 * @param {string} text - Text content to analyze
 * @param {number} minLength - Minimum word length to consider
 * @returns {Array} - Array of {keyword, count, density} objects
 */
function calculateKeywordDensity(text, minLength = 4) {
  // Remove special characters and convert to lowercase
  const cleanText = text.toLowerCase().replace(/[^\w\s]/g, '');
  const words = cleanText.split(/\s+/);
  
  // Count word frequencies
  const wordCounts = {};
  let totalWords = 0;
  
  words.forEach(word => {
    if (word.length >= minLength) {
      totalWords++;
      wordCounts[word] = (wordCounts[word] || 0) + 1;
    }
  });
  
  // Calculate keyword density
  const keywordDensity = Object.entries(wordCounts)
    .map(([word, count]) => ({
      keyword: word,
      count,
      density: (count / totalWords) * 100
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20); // Only keep top 20 keywords
  
  return keywordDensity;
}

/**
 * Analyze a website and extract key information
 * @param {string} url - The URL to analyze
 * @returns {Promise<object>} - Website analysis data
 */
async function analyzeWebsite(url, domain) {
  try {
    console.log(`Analyzing ${url}...`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Extract basic page information
    const title = $('title').text().trim();
    const description = $('meta[name="description"]').attr('content') || '';
    const canonical = $('link[rel="canonical"]').attr('href') || null;
    const metaKeywords = $('meta[name="keywords"]').attr('content') || null;
    const robotsTxt = $('meta[name="robots"]').attr('content') || '';
    
    // Extract headings (limit to first 5 of each type to avoid overly long entries)
    const h1 = $('h1').map((_, el) => $(el).text().trim()).get().slice(0, 5);
    const h2 = $('h2').map((_, el) => $(el).text().trim()).get().slice(0, 5);
    const h3 = $('h3').map((_, el) => $(el).text().trim()).get().slice(0, 5);
    const h4 = $('h4').map((_, el) => $(el).text().trim()).get().slice(0, 5);
    const h5 = $('h5').map((_, el) => $(el).text().trim()).get().slice(0, 5);
    const h6 = $('h6').map((_, el) => $(el).text().trim()).get().slice(0, 5);
    
    // Extract text content for keyword analysis
    const bodyText = $('body').text().replace(/\\s+/g, ' ').trim();
    const keywordDensity = calculateKeywordDensity(bodyText);
    
    // Extract images (limit to 5 to avoid overly long entries)
    const images = $('img').map((_, el) => ({
      url: $(el).attr('src') || '',
      alt: $(el).attr('alt') || null
    })).get().filter(img => img.url && !img.url.startsWith('data:')).slice(0, 5);
    
    return {
      domain,
      url,
      title,
      description,
      canonical,
      metaKeywords,
      robotsTxt,
      h1,
      h2,
      h3,
      h4,
      h5,
      h6,
      keywordDensity,
      images,
      analyzedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error(`Error analyzing ${url}:`, error.message);
    return {
      domain,
      url,
      error: error.message,
      analyzedAt: new Date().toISOString()
    };
  }
}

/**
 * Analyze all competitors
 */
async function analyzeAllCompetitors() {
  console.log('Starting direct analysis for all competitors...');
  
  const results = [];
  
  for (const competitor of competitors) {
    console.log(`Processing competitor: ${competitor.domain} (Position: ${competitor.position})`);
    
    try {
      const analysis = await analyzeWebsite(competitor.url, competitor.domain);
      analysis.position = competitor.position;
      analysis.keywordId = 360; // For mobile health app developers
      
      // Handle case where analysis may have an error
      if (analysis.error) {
        console.log(`⚠️ Error analyzing ${competitor.domain}: ${analysis.error}`);
        // Still save the partial data with error info
        results.push(analysis);
      } else {
        results.push(analysis);
        
        // Output the summary
        console.log(`✅ Analyzed ${competitor.domain}:`);
        console.log(`- Title: ${analysis.title || 'No title found'}`);
        console.log(`- H1 headings: ${analysis.h1 ? analysis.h1.length : 0}`);
        
        if (analysis.keywordDensity && analysis.keywordDensity.length > 0) {
          console.log(`- Top keywords: ${analysis.keywordDensity.slice(0, 5).map(k => k.keyword).join(', ')}`);
        } else {
          console.log(`- Top keywords: None found`);
        }
        
        console.log(`- Images: ${analysis.images ? analysis.images.length : 0}`);
        console.log('---');
      }
      
      // Add a small delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`Failed to analyze ${competitor.domain}:`, error);
      
      // Add the failed competitor to the results with error info
      results.push({
        domain: competitor.domain,
        url: competitor.url,
        position: competitor.position,
        error: error.message || 'Unknown error',
        analyzedAt: new Date().toISOString()
      });
    }
  }
  
  try {
    // Save the analysis results to a JSON file
    await fs.writeFile('competitor-insights.json', JSON.stringify(results, null, 2));
    console.log('✅ Analysis complete! Results saved to competitor-insights.json');
    
    // Also save a backup copy with timestamp
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    await fs.writeFile(`competitor-insights-${timestamp}.json`, JSON.stringify(results, null, 2));
    console.log(`✅ Backup saved to competitor-insights-${timestamp}.json`);
  } catch (writeError) {
    console.error('Error saving results:', writeError);
  }
  
  return results;
}

// Execute the analysis
analyzeAllCompetitors();