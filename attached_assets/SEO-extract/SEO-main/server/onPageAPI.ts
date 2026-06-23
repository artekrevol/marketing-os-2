/**
 * DataForSEO OnPage API integration
 * This module handles the OnPage API calls to DataForSEO for getting competitor insights
 * including page headings, meta data, keyword density, etc.
 */

import fetch from 'node-fetch';
import { db } from './db';
import { competitors, competitorInsights, keywords, type Competitor } from '../shared/schema';
import { eq } from 'drizzle-orm';

interface OnPageTaskResult {
  version: string;
  status_code: number;
  status_message: string;
  time: string;
  cost: number;
  tasks_count: number;
  tasks_error: number;
  tasks: Array<{
    id: string;
    status_code: number;
    status_message: string;
    time: string;
    cost: number;
    result_count: number;
    path: string[];
    data: {
      api: string;
      function: string;
      target: string;
      max_crawl_pages: number;
      load_resources: boolean;
      enable_javascript: boolean;
      enable_browser_rendering: boolean;
    };
    result: any | null;
  }>;
}

interface OnPageAPIResponse {
  tasks: Array<{
    id: string;
    status_code: number;
    status_message: string;
    result: Array<{
      crawl_progress: string;
      crawl_status: {
        status_code: number;
        status_message: string;
      };
      items_count: number;
      items: Array<{
        meta: {
          title: string;
          description: string;
          canonical: string | null;
          charset: string;
          meta_keywords: string | null;
          robots_txt: string;
        };
        page_content: {
          h1: string[];
          h2: string[];
          h3: string[];
          h4: string[];
          h5: string[];
          h6: string[];
          content: {
            text: string;
            density: {
              [key: string]: {
                count: number;
                density: number;
              };
            };
          };
          images: Array<{
            url: string;
            alt: string | null;
          }>;
        };
      }>;
    }>;
  }>;
}

export interface CompetitorInsight {
  competitorId: number;
  domain?: string;
  url: string;
  title: string;
  description: string;
  canonical: string | null;
  metaKeywords: string | null;
  robotsTxt: string;
  h1: string[];
  h2: string[];
  h3: string[];
  h4: string[];
  h5: string[];
  h6: string[];
  keywordDensity: Array<{
    keyword: string;
    count: number;
    density: number;
  }>;
  images: Array<{
    url: string;
    alt: string | null;
  }>;
  taskId?: string | null;
}

/**
 * Create a new OnPage API task for a competitor URL
 * @param url The URL to analyze
 * @returns The task ID if successful, null otherwise
 */
export async function createOnPageTask(url: string): Promise<string | null> {
  const endpoint = 'https://api.dataforseo.com/v3/on_page/task_post';
  // Standardize environment variable names - check both variants for compatibility
  const apiLogin = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
  const apiPassword = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;

  if (!apiLogin || !apiPassword) {
    throw new Error('DataForSEO API credentials not found. Please set DATAFORSEO_API_LOGIN and DATAFORSEO_API_PASSWORD');
  }

  const auth = Buffer.from(`${apiLogin}:${apiPassword}`).toString('base64');

  try {
    console.log(`Creating OnPage task for URL: ${url}`);
    console.log(`Using auth: ${Buffer.from(`${process.env.DATAFORSEO_LOGIN}:xxx`).toString('base64')}`);

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

    const data = await response.json() as OnPageTaskResult;
    console.log(`OnPage API response data:`, JSON.stringify(data, null, 2));

    // Debug log the full structure
    console.log('Debugging task response:');
    console.log('data.tasks exists:', Boolean(data.tasks));
    console.log('data.tasks length:', data.tasks ? data.tasks.length : 0);

    if (data.tasks && data.tasks.length > 0) {
      console.log('task[0] keys:', Object.keys(data.tasks[0]));
      console.log('task[0].id value:', data.tasks[0].id);

      // Found the issue - we need to check the id explicitly
      const taskId = data.tasks[0].id;
      if (taskId) {
        console.log(`Task created with ID: ${taskId}`);
        return taskId;
      }
    }

    console.error('No task ID returned in the response');

    return null;
  } catch (error) {
    console.error('Error creating OnPage task:', error);
    return null;
  }
}

/**
 * Get the results of an OnPage API task
 * @param taskId The task ID to check
 * @returns The competitor insight data if available, null otherwise
 */
export async function getOnPageTaskResult(taskId: string, competitorId: number): Promise<CompetitorInsight | null> {
  try {
    // First, try to get the actual competitor data from our database
    const competitor = await db.select().from(competitors).where(eq(competitors.id, competitorId)).limit(1);

    if (!competitor || competitor.length === 0) {
      console.error(`Competitor with ID ${competitorId} not found in database`);
      return null;
    }

    const url = competitor[0].url;
    const domain = competitor[0].domain;
    const title = competitor[0].title || 'Competitor Website';
    const keywordId = competitor[0].keywordId;

    // Fetch the keyword from the database to use for relevance
    const keywordResult = await db.select().from(keywords).where(eq(keywords.id, keywordId)).limit(1);
    const keywordText = keywordResult && keywordResult.length > 0 ? keywordResult[0].keyword : '';

    console.log(`Fetching OnPage API results for task ${taskId} - competitor ${domain} (${url})`);

    // Request the actual OnPage API results
    const endpoint = `https://api.dataforseo.com/v3/on_page/pages`;
    // Standardize environment variable names - check both variants for compatibility
    const apiLogin = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
    const apiPassword = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;

    if (!apiLogin || !apiPassword) {
      throw new Error('DataForSEO API credentials not found. Please set DATAFORSEO_API_LOGIN and DATAFORSEO_API_PASSWORD');
    }

    const auth = Buffer.from(`${apiLogin}:${apiPassword}`).toString('base64');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([
        {
          id: taskId,
          limit: 1 // We only need the main page data
        }
      ])
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API error response for task ${taskId}: ${errorText}`);
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const apiData = await response.json() as OnPageAPIResponse;
    console.log(`Received OnPage API data for task ${taskId}`);

    // Validate the response structure
    if (!apiData.tasks || apiData.tasks.length === 0 || !apiData.tasks[0].result || apiData.tasks[0].result.length === 0) {
      console.error(`Invalid OnPage API response structure for task ${taskId}`);
      console.error(`Response structure:`, JSON.stringify(apiData, null, 2).substring(0, 1000));
      throw new Error('Invalid API response structure');
    }

    // Extract the page data from the response
    const pageData = apiData.tasks[0].result[0].items[0];

    if (!pageData) {
      console.error(`No page data found in OnPage API response for task ${taskId}`);
      console.error(`Available data:`, JSON.stringify(apiData.tasks[0].result[0], null, 2).substring(0, 1000));
      throw new Error('No page data found in API response');
    }

    // Log what data we're getting from the API
    console.log(`[OnPage API] Page data structure check for task ${taskId}:`);
    console.log(`  - Has page_content: ${!!pageData.page_content}`);
    console.log(`  - Has h1: ${!!pageData.page_content?.h1}, count: ${pageData.page_content?.h1?.length || 0}`);
    console.log(`  - Has h2: ${!!pageData.page_content?.h2}, count: ${pageData.page_content?.h2?.length || 0}`);
    console.log(`  - Has content.density: ${!!pageData.page_content?.content?.density}`);
    console.log(`  - Density keys count: ${pageData.page_content?.content?.density ? Object.keys(pageData.page_content.content.density).length : 0}`);

    // Process the keyword density data
    const densityData = pageData.page_content?.content?.density || {};
    const keywordDensity: Array<{ keyword: string, count: number, density: number }> = [];

    // Convert the density object to an array
    for (const [keyword, data] of Object.entries(densityData)) {
      keywordDensity.push({
        keyword,
        count: data.count,
        density: data.density
      });
    }

    // Sort by density (highest first)
    keywordDensity.sort((a, b) => b.density - a.density);

    // Create the insight object from actual API data
    const insight: CompetitorInsight = {
      competitorId,
      domain,
      url,
      title: pageData.meta?.title || title,
      description: pageData.meta?.description || '',
      canonical: pageData.meta?.canonical || null,
      metaKeywords: pageData.meta?.meta_keywords || null,
      robotsTxt: pageData.meta?.robots_txt || '',
      h1: pageData.page_content?.h1 || [],
      h2: pageData.page_content?.h2 || [],
      h3: pageData.page_content?.h3 || [],
      h4: pageData.page_content?.h4 || [],
      h5: pageData.page_content?.h5 || [],
      h6: pageData.page_content?.h6 || [],
      keywordDensity,
      images: pageData.page_content?.images || [],
      taskId
    };

    // Log the insight data we're storing
    console.log(`[OnPage API] Insight data prepared for competitor ${competitorId}:`);
    console.log(`  - H1 tags: ${insight.h1.length}`);
    console.log(`  - H2 tags: ${insight.h2.length}`);
    console.log(`  - Keyword density entries: ${insight.keywordDensity.length}`);
    if (insight.h1.length > 0) {
      console.log(`  - Sample H1: "${insight.h1[0].substring(0, 60)}..."`);
    }
    if (insight.keywordDensity.length > 0) {
      console.log(`  - Top keyword: "${insight.keywordDensity[0].keyword}" (${insight.keywordDensity[0].density.toFixed(4)}%)`);
    }

    // Store the insight in the database so it can be retrieved later
    try {
      // Check if we already have an insight for this competitor
      const existingInsight = await db.select().from(competitorInsights)
        .where(eq(competitorInsights.competitorId, competitorId))
        .limit(1);

      if (existingInsight && existingInsight.length > 0) {
        // Update existing insight
        await db.update(competitorInsights)
          .set({
            url: insight.url,
            title: insight.title,
            description: insight.description,
            canonical: insight.canonical,
            metaKeywords: insight.metaKeywords,
            robotsTxt: insight.robotsTxt,
            h1: insight.h1,
            h2: insight.h2,
            h3: insight.h3,
            h4: insight.h4,
            h5: insight.h5,
            h6: insight.h6,
            keywordDensity: insight.keywordDensity,
            images: insight.images,
            taskId: insight.taskId,
            updatedAt: new Date()
          })
          .where(eq(competitorInsights.id, existingInsight[0].id));

        console.log(`Updated existing competitor insight for ${domain}`);
      } else {
        // Create new insight
        await db.insert(competitorInsights).values({
          competitorId: insight.competitorId,
          url: insight.url,
          title: insight.title,
          description: insight.description,
          canonical: insight.canonical,
          metaKeywords: insight.metaKeywords,
          robotsTxt: insight.robotsTxt,
          h1: insight.h1,
          h2: insight.h2,
          h3: insight.h3,
          h4: insight.h4,
          h5: insight.h5,
          h6: insight.h6,
          keywordDensity: insight.keywordDensity,
          images: insight.images,
          taskId: insight.taskId,
          createdAt: new Date(),
          updatedAt: new Date()
        });

        console.log(`Created new competitor insight for ${domain}`);
      }
    } catch (dbError) {
      console.error('Error storing competitor insight in database:', dbError);
      // Continue returning the insight even if storage fails
    }

    return insight;
  } catch (error) {
    console.error('Error getting OnPage task result:', error);
    return null;
  }
}

/**
 * Check if task is completed
 * @param taskId The task ID to check
 * @returns true if completed, false otherwise
 */
export async function isTaskCompleted(taskId: string): Promise<boolean> {
  const endpoint = `https://api.dataforseo.com/v3/on_page/tasks_ready?id=${taskId}`;
  // Standardize environment variable names - check both variants for compatibility
  const apiLogin = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
  const apiPassword = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;

  if (!apiLogin || !apiPassword) {
    throw new Error('DataForSEO API credentials not found. Please set DATAFORSEO_API_LOGIN and DATAFORSEO_API_PASSWORD');
  }

  const auth = Buffer.from(`${apiLogin}:${apiPassword}`).toString('base64');

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

    interface TaskResponse {
      tasks?: Array<{
        id?: string;
        status_code?: number;
        status_message?: string;
        result?: Array<{
          id?: string;
          target?: string;
          date_posted?: string;
          tag?: string;
          // Alternative structure (for pages endpoint)
          crawl_progress?: string;
          crawl_status?: {
            status_code?: number;
            status_message?: string;
          };
          status?: string;
        }>;
      }>;
    }

    const data = await response.json() as TaskResponse;
    console.log(`[OnPage API] Tasks ready response for task ${taskId}:`, JSON.stringify(data, null, 2));

    // The tasks_ready endpoint returns a list of task IDs that are ready
    // If our taskId appears in the result array, it means it's completed
    const hasTasksArray = Boolean(data.tasks);
    const hasNonEmptyTasksArray = hasTasksArray && data.tasks!.length > 0;
    const hasTaskResult = hasNonEmptyTasksArray && Boolean(data.tasks![0].result);
    
    let isCompleted = false;
    
    if (hasTaskResult && data.tasks![0].result) {
      // Check if our taskId is in the result list (tasks_ready endpoint format)
      const taskInResult = data.tasks![0].result.some((item: any) => item.id === taskId);
      
      // Also check for status field (alternative format)
      const hasStatusComplete = data.tasks![0].result.some((item: any) => item.status === 'complete');
      
      isCompleted = taskInResult || hasStatusComplete;
      
      console.log(`[OnPage API] Task ${taskId} completion check:`, {
        taskInResult,
        hasStatusComplete,
        isCompleted,
        resultCount: data.tasks![0].result.length
      });
    }

    return isCompleted;
  } catch (error) {
    console.error('Error checking task status:', error);
    return false;
  }
}



/**
 * Get competitor insights by analyzing the website with DataForSEO OnPage API
 * This is a convenience method that wraps the task creation, waiting, and result fetching
 * @param competitorId The ID of the competitor in our database
 * @param competitorObject Optional competitor object to avoid DB lookup
 * @returns The competitor insight data if successful, null otherwise
 */
export async function getCompetitorInsights(competitorId: number, competitorObject?: Competitor): Promise<CompetitorInsight | null> {
  if (!db) {
    throw new Error("Database not initialized");
  }

  try {
    // Get the competitor URL from our database or use provided object
    let competitor: Competitor[] = [];

    if (competitorObject) {
      competitor = [competitorObject];
    } else {
      competitor = await db.select().from(competitors).where(eq(competitors.id, competitorId)).limit(1);
    }

    if (!competitor || competitor.length === 0) {
      throw new Error(`Competitor with ID ${competitorId} not found`);
    }

    const url = competitor[0].url;

    // Check if we already have a task ID stored for this competitor
    const existingInsight = await db.select().from(competitorInsights)
      .where(eq(competitorInsights.competitorId, competitorId))
      .limit(1);

    let taskId: string | null = null;

    // If we have an existing insight with a taskId, use that
    if (existingInsight && existingInsight.length > 0 && existingInsight[0].taskId) {
      taskId = existingInsight[0].taskId;
      console.log(`Using existing task ID ${taskId} for competitor ${competitorId}`);

      // Check if the task is completed
      const isCompleted = await isTaskCompleted(taskId);

      if (isCompleted) {
        console.log(`Task ${taskId} is already completed, fetching results`);
        return await getOnPageTaskResult(taskId, competitorId);
      }

      console.log(`Task ${taskId} is not yet completed, creating a new task`);
    }

    // Create a new task
    taskId = await createOnPageTask(url);

    if (!taskId) {
      throw new Error('Failed to create OnPage task');
    }

    console.log(`Task ${taskId} created for competitor ${competitorId}`);

    // Now wait for the task to complete with a reasonable timeout
    // OnPage API tasks can take 5-15 minutes depending on site complexity
    // We'll check every 15 seconds for up to 15 minutes
    const maxAttempts = 60; // 60 * 15 seconds = 15 minutes
    const checkInterval = 15000; // 15 seconds
    let attempts = 0;
    let isCompleted = false;

    console.log(`Waiting for OnPage API task ${taskId} to complete (max ${maxAttempts * checkInterval / 1000 / 60} minutes)...`);

    while (!isCompleted && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      attempts++;
      
      if (attempts % 4 === 0) { // Log every minute (4 * 15 seconds)
        console.log(`Checking if task ${taskId} is completed (attempt ${attempts}/${maxAttempts}, ~${Math.round(attempts * checkInterval / 1000 / 60)} minutes elapsed)...`);
      }
      
      isCompleted = await isTaskCompleted(taskId);

      if (isCompleted) {
        console.log(`✅ Task ${taskId} completed successfully after ${attempts} attempts (~${Math.round(attempts * checkInterval / 1000 / 60)} minutes)`);
        break;
      }
    }

    if (!isCompleted) {
      console.log(`⚠️  Task ${taskId} did not complete within ${maxAttempts * checkInterval / 1000 / 60} minutes`);
      console.log(`   Storing the task ID for later retrieval via background task checker`);

      // Store the task ID so we can check it later
      if (existingInsight && existingInsight.length > 0) {
        await db.update(competitorInsights)
          .set({ taskId, updatedAt: new Date() })
          .where(eq(competitorInsights.id, existingInsight[0].id));
      } else {
        // Create a minimal insight record just to store the task ID
        await db.insert(competitorInsights).values({
          competitorId,
          url,
          title: competitor[0].title || 'Processing',
          description: 'Analysis in progress...',
          canonical: null,
          metaKeywords: null,
          robotsTxt: '',
          h1: [],
          h2: [],
          h3: [],
          h4: [],
          h5: [],
          h6: [],
          keywordDensity: [],
          images: [],
          taskId,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }

      return null; // The task is still running, so return null
    }

    // Get the results
    return await getOnPageTaskResult(taskId, competitorId);
  } catch (error) {
    console.error('Error getting competitor insights:', error);
    return null;
  }
}