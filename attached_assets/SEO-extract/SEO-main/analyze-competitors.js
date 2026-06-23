/**
 * Script to analyze competitors using the DataForSEO OnPage API
 * This will initiate analysis for the top competitors for a specific keyword
 * 
 * Run with: node analyze-competitors.js
 */

import { config } from 'dotenv';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from './server/db.js';
import { competitors } from './shared/schema.js';
import { eq } from 'drizzle-orm';

// Initialize dotenv
const __dirname = dirname(fileURLToPath(import.meta.url));
config();

// DataForSEO credentials from environment variables
const username = process.env.DATAFORSEO_USERNAME;
const password = process.env.DATAFORSEO_PASSWORD;

if (!username || !password) {
  console.error('DataForSEO credentials missing. Please set DATAFORSEO_USERNAME and DATAFORSEO_PASSWORD');
  process.exit(1);
}

/**
 * Create a new OnPage API task for a competitor URL
 * @param {string} url - The URL to analyze
 * @returns {Promise<string|null>} - Task ID if successful, null otherwise
 */
async function createOnPageTask(url) {
  try {
    const post_data = [{
      "target": url,
      "max_crawl_pages": 5,
      "load_resources": true,
      "enable_javascript": true,
      "enable_browser_rendering": true
    }];

    const response = await fetch('https://api.dataforseo.com/v3/on_page/task_post', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(username + ':' + password).toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(post_data)
    });

    const data = await response.json();
    console.log(`Task creation response for ${url}:`, JSON.stringify(data, null, 2));

    if (data?.tasks?.[0]?.id) {
      return data.tasks[0].id;
    }

    console.error(`Failed to create task for ${url}:`, data?.status_message || 'Unknown error');
    return null;
  } catch (error) {
    console.error(`Error creating task for ${url}:`, error);
    return null;
  }
}

/**
 * Analyze competitors for a specific keyword
 * @param {number} keywordId - The keyword ID to analyze competitors for
 */
async function analyzeCompetitors(keywordId) {
  try {
    console.log(`Analyzing competitors for keyword ID: ${keywordId}`);

    // Get competitors ordered by position
    const competitorsList = await db
      .select()
      .from(competitors)
      .where(eq(competitors.keywordId, keywordId))
      .orderBy(competitors.position);

    console.log(`Found ${competitorsList.length} competitors`);

    // Also include our own site (Tekrevol) if it's in the results
    const ourDomain = 'www.tekrevol.com';
    
    for (const competitor of competitorsList) {
      console.log(`Processing competitor: ${competitor.domain} (Position: ${competitor.position})`);
      
      // Start an OnPage API task for this competitor
      const taskId = await createOnPageTask(competitor.url);
      
      if (taskId) {
        console.log(`Successfully created task for ${competitor.domain}: ${taskId}`);
        
        // Here we would normally update the competitorInsights table with the taskId
        // But we'll let the scheduler handle that
      } else {
        console.log(`Failed to create task for ${competitor.domain}`);
      }
      
      // Add a small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Also analyze our own site if it's not already included
    if (!competitorsList.find(c => c.domain === ourDomain)) {
      console.log(`Adding our domain: ${ourDomain}`);
      
      // Find our ranking
      const tekrevolUrl = 'https://www.tekrevol.com/healthcare-app-development';
      
      // Start an OnPage API task for our domain
      const taskId = await createOnPageTask(tekrevolUrl);
      
      if (taskId) {
        console.log(`Successfully created task for ${ourDomain}: ${taskId}`);
      } else {
        console.log(`Failed to create task for ${ourDomain}`);
      }
    }

    console.log('Competitor analysis initiation complete');
  } catch (error) {
    console.error('Error analyzing competitors:', error);
  }
}

// Run the analysis for the "mobile health app developers" keyword (ID: 479)
analyzeCompetitors(479);