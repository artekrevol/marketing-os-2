/**
 * Test script for DataForSEO OnPage API integration
 * This will test the process of analyzing a website using the OnPage API
 * 
 * To run: node test-dataforseo-insights.js
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

async function testDataForSEOInsights() {
  console.log('Testing DataForSEO OnPage API integration...');
  
  // Sample URL to analyze
  const url = 'https://clutch.co/app-developers/miami';
  
  // 1. Create OnPage task
  const taskId = await createOnPageTask(url);
  
  if (!taskId) {
    console.error('Failed to create OnPage task');
    return;
  }
  
  console.log(`Task created with ID: ${taskId}`);
  
  // 2. Check if task is completed
  let completed = false;
  const maxAttempts = 10;
  let attempts = 0;
  
  while (!completed && attempts < maxAttempts) {
    console.log(`Checking task status (attempt ${attempts + 1})...`);
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
    completed = await isTaskCompleted(taskId);
    attempts++;
  }
  
  if (!completed) {
    console.error('Task did not complete in the allotted time');
    return;
  }
  
  console.log('Task completed successfully');
  
  // 3. Get the results
  const result = await getOnPageTaskResult(taskId);
  
  if (!result) {
    console.error('Failed to get task results');
    return;
  }
  
  console.log('Task results:');
  console.log(JSON.stringify(result, null, 2));
}

/**
 * Create a new OnPage API task for a URL
 */
async function createOnPageTask(url) {
  const endpoint = 'https://api.dataforseo.com/v3/on_page/task_post';
  const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString('base64');
  
  try {
    console.log(`Creating OnPage task for URL: ${url}`);
    console.log(`Using auth: ${Buffer.from(`${process.env.DATAFORSEO_LOGIN}:***`).toString('base64')}`);
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([
        {
          target: url,
          max_crawl_pages: 1, // Limit to the target page only for competitor analysis
          load_resources: true,
          enable_javascript: true,
          enable_browser_rendering: true,
        }
      ])
    });
    
    console.log(`OnPage API response status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API error response: ${errorText}`);
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`OnPage API response:`, JSON.stringify(data, null, 2));
    
    if (data.tasks && data.tasks.length > 0 && data.tasks[0].id) {
      return data.tasks[0].id;
    }
    
    console.error('No task ID returned in the response');
    return null;
  } catch (error) {
    console.error('Error creating OnPage task:', error);
    return null;
  }
}

/**
 * Check if a task is completed
 */
async function isTaskCompleted(taskId) {
  const endpoint = `https://api.dataforseo.com/v3/on_page/tasks_ready?id=${taskId}`;
  const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString('base64');
  
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Task status response:', JSON.stringify(data, null, 2));
    
    return Boolean(
      data.tasks && 
      data.tasks.length > 0 && 
      data.tasks[0].result && 
      data.tasks[0].result.length > 0 &&
      data.tasks[0].result[0].status === 'complete'
    );
  } catch (error) {
    console.error('Error checking task status:', error);
    return false;
  }
}

/**
 * Get the results of an OnPage task
 */
async function getOnPageTaskResult(taskId) {
  const endpoint = `https://api.dataforseo.com/v3/on_page/pages?id=${taskId}&limit=1`;
  const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString('base64');
  
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data.tasks && 
        data.tasks.length > 0 && 
        data.tasks[0].result && 
        data.tasks[0].result.length > 0 &&
        data.tasks[0].result[0].items &&
        data.tasks[0].result[0].items.length > 0) {
      
      const item = data.tasks[0].result[0].items[0];
      
      // Transform the keyword density object into an array
      const densityData = item.page_content.content.density || {};
      const keywordDensity = Object.entries(densityData).map(([keyword, data]) => ({
        keyword,
        count: data.count,
        density: data.density
      }));
      
      // Sort by density descending
      keywordDensity.sort((a, b) => b.density - a.density);
      
      return {
        url: item.url,
        title: item.meta.title || '',
        description: item.meta.description || '',
        canonical: item.meta.canonical,
        metaKeywords: item.meta.meta_keywords,
        robotsTxt: item.meta.robots_txt || '',
        h1: item.page_content.h1 || [],
        h2: item.page_content.h2 || [],
        h3: item.page_content.h3 || [],
        h4: item.page_content.h4 || [],
        h5: item.page_content.h5 || [],
        h6: item.page_content.h6 || [],
        keywordDensity: keywordDensity.slice(0, 50), // Limit to top 50 keywords
        images: item.page_content.images || [],
        taskId: taskId
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error getting OnPage task result:', error);
    return null;
  }
}

// Run the test
testDataForSEOInsights().catch(error => {
  console.error('Error running test:', error);
  process.exit(1);
});