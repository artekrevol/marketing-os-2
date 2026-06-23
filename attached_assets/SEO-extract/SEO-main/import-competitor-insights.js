/**
 * Script to import competitor insights from the JSON file into the database
 * 
 * Run with: node import-competitor-insights.js
 */

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
 * Create competitor insight in the database
 * @param {Object} insight - The insight data
 * @param {number} competitorId - The competitor ID
 * @returns {Promise<number>} - The insight ID
 */
async function createCompetitorInsight(insight, competitorId) {
  try {
    // First check if insight already exists
    const existing = await sql`
      SELECT id FROM "competitorInsights"
      WHERE "competitorId" = ${competitorId}
      LIMIT 1
    `;
    
    if (existing && existing.length > 0) {
      console.log(`Insight already exists for competitor ID ${competitorId}`);
      return existing[0].id;
    }
    
    // Create a new insight
    const created = await sql`
      INSERT INTO "competitorInsights" (
        "competitorId",
        url,
        title,
        description,
        canonical,
        "metaKeywords",
        "robotsTxt",
        h1,
        h2,
        h3,
        h4,
        h5,
        h6,
        "keywordDensity",
        images
      ) VALUES (
        ${competitorId},
        ${insight.url},
        ${insight.title || ''},
        ${insight.description || ''},
        ${insight.canonical},
        ${insight.metaKeywords},
        ${insight.robotsTxt || ''},
        ${insight.h1 ? insight.h1 : []},
        ${insight.h2 ? insight.h2 : []},
        ${insight.h3 ? insight.h3 : []},
        ${insight.h4 ? insight.h4 : []},
        ${insight.h5 ? insight.h5 : []},
        ${insight.h6 ? insight.h6 : []},
        ${insight.keywordDensity ? insight.keywordDensity.map(kd => ({ 
          keyword: kd.keyword, 
          count: kd.count, 
          density: kd.density 
        })) : []},
        ${insight.images ? insight.images.map(img => ({ 
          url: img.url, 
          alt: img.alt 
        })) : []}
      )
      RETURNING id
    `;
    
    return created[0].id;
  } catch (error) {
    console.error(`Error creating insight for competitor ID ${competitorId}:`, error);
    // Try a simplified insertion if it failed
    try {
      console.log('Attempting simplified insight insertion...');
      const simplifiedInsight = await sql`
        INSERT INTO "competitorInsights" (
          "competitorId",
          url,
          title,
          description
        ) VALUES (
          ${competitorId},
          ${insight.url},
          ${insight.title || ''},
          ${insight.description || ''}
        )
        RETURNING id
      `;
      
      return simplifiedInsight[0].id;
    } catch (simplifiedError) {
      console.error('Simplified insertion also failed:', simplifiedError);
      throw error;
    }
  }
}

/**
 * Import competitor insights from the JSON file
 */
async function importCompetitorInsights() {
  try {
    console.log('Loading competitor insights from JSON file...');
    
    // Read the JSON file
    const data = await fs.readFile('competitor-insights.json', 'utf8');
    const insights = JSON.parse(data);
    
    console.log(`Loaded ${insights.length} competitor insights`);
    
    // Get the latest batch ID for consistency
    const batchId = await getLatestBatchId();
    console.log(`Using batch ID: ${batchId}`);
    
    // Process each insight
    for (const insight of insights) {
      if (insight.error) {
        console.log(`Skipping competitor with error: ${insight.domain}`);
        continue;
      }
      
      try {
        // Create or get competitor record
        const keywordId = insight.keywordId || 360; // 360 for "mobile health app developers"
        const competitorId = await getOrCreateCompetitor({
          domain: insight.domain,
          url: insight.url,
          title: insight.title,
          position: insight.position
        }, keywordId, batchId);
        
        console.log(`Created/found competitor ID ${competitorId} for ${insight.domain}`);
        
        // Create insight record
        const insightId = await createCompetitorInsight(insight, competitorId);
        console.log(`Created insight ID ${insightId} for competitor ID ${competitorId}`);
      } catch (error) {
        console.error(`Error processing insight for ${insight.domain}:`, error);
      }
    }
    
    console.log('Import complete!');
  } catch (error) {
    console.error('Error importing competitor insights:', error);
  } finally {
    // Close the database connection
    await sql.end();
  }
}

// Execute the import
importCompetitorInsights();