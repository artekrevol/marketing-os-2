/**
 * Script to directly analyze competitor websites by fetching their content
 * This provides basic competitor insights without relying on external APIs
 * 
 * Run with: node direct-analysis.js
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import postgres from 'postgres';
import { config } from 'dotenv';

// Load environment variables
config();

// Initialize database connection
const sql = postgres(process.env.DATABASE_URL || '', {
  max: 10,
  idle_timeout: 30
});

// The keyword ID for "mobile health app developers"
const TARGET_KEYWORD_ID = 360; // Update this with the actual keyword ID

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
 * Get the most recent batch ID from the database
 * @returns {Promise<number>} - The most recent batch ID
 */
async function getLatestBatchId() {
  try {
    const result = await sql`
      SELECT id FROM "keywordBatches" 
      ORDER BY "startTime" DESC 
      LIMIT 1
    `;
    
    if (result && result.length > 0) {
      return result[0].id;
    }
    
    return 0; // Default to 0 if no batches exist
  } catch (error) {
    console.error('Error getting latest batch ID:', error);
    return 0;
  }
}

/**
 * Get or create a competitor record in the database
 * @param {Object} competitor - The competitor data
 * @returns {Promise<number>} - The competitor ID
 */
async function getOrCreateCompetitor(competitor, keywordId, batchId) {
  try {
    // Check if competitor already exists
    const existing = await sql`
      SELECT id FROM competitors 
      WHERE domain = ${competitor.domain} 
      AND url = ${competitor.url}
      AND "keywordId" = ${keywordId}
      AND "batchId" = ${batchId}
      LIMIT 1
    `;
    
    if (existing && existing.length > 0) {
      return existing[0].id;
    }
    
    // Create new competitor record
    const created = await sql`
      INSERT INTO competitors (
        "keywordId", domain, url, title, position, "batchId", date
      ) VALUES (
        ${keywordId}, 
        ${competitor.domain}, 
        ${competitor.url}, 
        ${competitor.title || ''}, 
        ${competitor.position}, 
        ${batchId}, 
        ${new Date()}
      )
      RETURNING id
    `;
    
    return created[0].id;
  } catch (error) {
    console.error('Error creating competitor:', error);
    throw error;
  }
}

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
    
    // Extract headings
    const h1 = $('h1').map((_, el) => $(el).text().trim()).get();
    const h2 = $('h2').map((_, el) => $(el).text().trim()).get();
    const h3 = $('h3').map((_, el) => $(el).text().trim()).get();
    const h4 = $('h4').map((_, el) => $(el).text().trim()).get();
    const h5 = $('h5').map((_, el) => $(el).text().trim()).get();
    const h6 = $('h6').map((_, el) => $(el).text().trim()).get();
    
    // Extract text content for keyword analysis
    const bodyText = $('body').text().replace(/\\s+/g, ' ').trim();
    const keywordDensity = calculateKeywordDensity(bodyText);
    
    // Extract images
    const images = $('img').map((_, el) => ({
      url: $(el).attr('src') || '',
      alt: $(el).attr('alt') || null
    })).get().filter(img => img.url && !img.url.startsWith('data:'));
    
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
      images: images.slice(0, 10), // Limit to 10 images
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
 * Save competitor insights to the database
 * @param {Object} analysis - The analysis data
 * @param {number} competitorId - The competitor ID
 * @returns {Promise<number>} - The insight ID
 */
async function saveCompetitorInsights(analysis, competitorId) {
  try {
    // Prepare the data for PostgreSQL - convert arrays to PostgreSQL array format
    const h1Array = analysis.h1 ? analysis.h1.map(item => `"${item.replace(/"/g, '\\"')}"`).join(',') : '';
    const h2Array = analysis.h2 ? analysis.h2.map(item => `"${item.replace(/"/g, '\\"')}"`).join(',') : '';
    const h3Array = analysis.h3 ? analysis.h3.map(item => `"${item.replace(/"/g, '\\"')}"`).join(',') : '';
    const h4Array = analysis.h4 ? analysis.h4.map(item => `"${item.replace(/"/g, '\\"')}"`).join(',') : '';
    const h5Array = analysis.h5 ? analysis.h5.map(item => `"${item.replace(/"/g, '\\"')}"`).join(',') : '';
    const h6Array = analysis.h6 ? analysis.h6.map(item => `"${item.replace(/"/g, '\\"')}"`).join(',') : '';
    
    // Convert keywordDensity to a simplified format for storage
    const keywordDensityArray = analysis.keywordDensity 
      ? analysis.keywordDensity.map(kd => `"${kd.keyword.replace(/"/g, '\\"')}:${kd.count}:${kd.density.toFixed(2)}"`).join(',')
      : '';
    
    // Convert images to a simplified format for storage
    const imagesArray = analysis.images
      ? analysis.images.map(img => `"${img.url.replace(/"/g, '\\"')}|${img.alt ? img.alt.replace(/"/g, '\\"') : ''}"`).join(',')
      : '';
    
    // Check if insights already exist for this competitor
    const existing = await sql`
      SELECT id FROM "competitorInsights" 
      WHERE "competitorId" = ${competitorId}
      LIMIT 1
    `;
    
    if (existing && existing.length > 0) {
      // Update existing insights using raw SQL to avoid array formatting issues
      // Handle empty arrays properly
      const h1Sql = h1Array ? `ARRAY[${h1Array}]::text[]` : `'{}'::text[]`;
      const h2Sql = h2Array ? `ARRAY[${h2Array}]::text[]` : `'{}'::text[]`;
      const h3Sql = h3Array ? `ARRAY[${h3Array}]::text[]` : `'{}'::text[]`;
      const h4Sql = h4Array ? `ARRAY[${h4Array}]::text[]` : `'{}'::text[]`;
      const h5Sql = h5Array ? `ARRAY[${h5Array}]::text[]` : `'{}'::text[]`;
      const h6Sql = h6Array ? `ARRAY[${h6Array}]::text[]` : `'{}'::text[]`;
      const keywordDensitySql = keywordDensityArray ? `ARRAY[${keywordDensityArray}]::text[]` : `'{}'::text[]`;
      const imagesSql = imagesArray ? `ARRAY[${imagesArray}]::text[]` : `'{}'::text[]`;
      
      const updateSQL = `
        UPDATE "competitorInsights" SET
          url = $1,
          title = $2,
          description = $3,
          canonical = $4,
          "metaKeywords" = $5,
          "robotsTxt" = $6,
          h1 = ${h1Sql},
          h2 = ${h2Sql},
          h3 = ${h3Sql},
          h4 = ${h4Sql},
          h5 = ${h5Sql},
          h6 = ${h6Sql},
          "keywordDensity" = ${keywordDensitySql},
          images = ${imagesSql},
          "updatedAt" = $7
        WHERE id = $8
        RETURNING id
      `;
      
      const updated = await sql.unsafe(updateSQL, [
        analysis.url,
        analysis.title || '',
        analysis.description || '',
        analysis.canonical,
        analysis.metaKeywords,
        analysis.robotsTxt || '',
        new Date(),
        existing[0].id
      ]);
      
      console.log(`Updated existing insights for competitor ID ${competitorId}`);
      return existing[0].id;
    }
    
    // Create new competitor insights using raw SQL to avoid array formatting issues
    // Handle empty arrays properly
    const h1Sql = h1Array ? `ARRAY[${h1Array}]::text[]` : `'{}'::text[]`;
    const h2Sql = h2Array ? `ARRAY[${h2Array}]::text[]` : `'{}'::text[]`;
    const h3Sql = h3Array ? `ARRAY[${h3Array}]::text[]` : `'{}'::text[]`;
    const h4Sql = h4Array ? `ARRAY[${h4Array}]::text[]` : `'{}'::text[]`;
    const h5Sql = h5Array ? `ARRAY[${h5Array}]::text[]` : `'{}'::text[]`;
    const h6Sql = h6Array ? `ARRAY[${h6Array}]::text[]` : `'{}'::text[]`;
    const keywordDensitySql = keywordDensityArray ? `ARRAY[${keywordDensityArray}]::text[]` : `'{}'::text[]`;
    const imagesSql = imagesArray ? `ARRAY[${imagesArray}]::text[]` : `'{}'::text[]`;
    
    const insertSQL = `
      INSERT INTO "competitorInsights" (
        "competitorId", url, title, description, canonical, "metaKeywords",
        "robotsTxt", h1, h2, h3, h4, h5, h6, "keywordDensity", images
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        ${h1Sql},
        ${h2Sql},
        ${h3Sql},
        ${h4Sql},
        ${h5Sql},
        ${h6Sql},
        ${keywordDensitySql},
        ${imagesSql}
      )
      RETURNING id
    `;
    
    const created = await sql.unsafe(insertSQL, [
      competitorId,
      analysis.url,
      analysis.title || '',
      analysis.description || '',
      analysis.canonical,
      analysis.metaKeywords,
      analysis.robotsTxt || ''
    ]);
    
    console.log(`Created new insights for competitor ID ${competitorId}`);
    return created[0].id;
  } catch (error) {
    console.error('Error saving competitor insights:', error);
    throw error;
  }
}

/**
 * Analyze all competitors
 */
async function analyzeAllCompetitors() {
  console.log('Starting direct analysis for all competitors...');
  
  const results = [];
  let batchId = 0;
  
  try {
    // Get the latest batch ID for consistency
    batchId = await getLatestBatchId();
    console.log(`Using batch ID: ${batchId}`);
    
    // Get the keyword ID from the database if not specified
    let keywordId = TARGET_KEYWORD_ID;
    if (!keywordId) {
      // Try to find the keyword by name
      const keywordResult = await sql`
        SELECT id FROM keywords 
        WHERE keyword = ${'mobile health app developers'} 
        LIMIT 1
      `;
      
      if (keywordResult && keywordResult.length > 0) {
        keywordId = keywordResult[0].id;
        console.log(`Found keyword ID: ${keywordId}`);
      } else {
        console.warn('Keyword not found in database, using default ID');
      }
    }
    
    for (const competitor of competitors) {
      console.log(`Processing competitor: ${competitor.domain} (Position: ${competitor.position})`);
      
      try {
        const analysis = await analyzeWebsite(competitor.url, competitor.domain);
        analysis.position = competitor.position;
        
        // Handle case where analysis may have an error
        if (analysis.error) {
          console.log(`⚠️ Error analyzing ${competitor.domain}: ${analysis.error}`);
          // Still save the partial data with error info
          results.push(analysis);
          continue;
        }
        
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
        
        // Save to database if we have a valid keyword ID
        if (keywordId) {
          // First create or get the competitor record
          const competitorId = await getOrCreateCompetitor({
            domain: competitor.domain,
            url: competitor.url,
            title: analysis.title,
            position: competitor.position
          }, keywordId, batchId);
          
          console.log(`Competitor ID: ${competitorId}`);
          
          // Then save the insights
          const insightId = await saveCompetitorInsights(analysis, competitorId);
          console.log(`Saved insights with ID: ${insightId}`);
        }
        
        console.log('---');
        
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
  } catch (dbError) {
    console.error('Database error:', dbError);
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