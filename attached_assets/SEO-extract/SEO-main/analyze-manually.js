/**
 * Script to manually analyze competitor websites
 * This will initiate analysis for the specified competitor URLs
 * 
 * Run with: node analyze-manually.js
 */

// Load environment variables
import { config } from 'dotenv';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

// Initialize dotenv
const __dirname = dirname(fileURLToPath(import.meta.url));
config();

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

// DataForSEO credentials from environment variables
const username = process.env.DATAFORSEO_USERNAME;
const password = process.env.DATAFORSEO_PASSWORD;

console.log(`Username available: ${!!username}`);
console.log(`Password available: ${!!password}`);

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
 * Analyze all competitors
 */
async function analyzeAllCompetitors() {
  console.log('Starting analysis for all competitors...');
  
  for (const competitor of competitors) {
    console.log(`Processing competitor: ${competitor.domain} (Position: ${competitor.position})`);
    
    // Start an OnPage API task for this competitor
    const taskId = await createOnPageTask(competitor.url);
    
    if (taskId) {
      console.log(`Successfully created task for ${competitor.domain}: ${taskId}`);
    } else {
      console.log(`Failed to create task for ${competitor.domain}`);
    }
    
    // Add a small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('Competitor analysis initiation complete');
}

// Execute the analysis
analyzeAllCompetitors();