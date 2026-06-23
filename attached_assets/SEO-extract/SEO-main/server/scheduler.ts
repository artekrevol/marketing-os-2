import cron from 'node-cron';
import { storage } from './storage';
import { crawlKeywords } from './crawler';
import { db } from './db';
import { competitors, rankings, competitorInsights } from '../shared/schema';
import { asc, desc, eq, sql, isNotNull } from 'drizzle-orm';
import { getCompetitorInsights, isTaskCompleted, getOnPageTaskResult } from './onPageAPI';

let scheduledTask: cron.ScheduledTask | null = null;
let competitorAnalysisTask: cron.ScheduledTask | null = null;
let backgroundTaskChecker: cron.ScheduledTask | null = null;

/**
 * Parse cron expression from schedule
 */
export const parseCronExpression = (expression: string): string => {
  if (!expression || typeof expression !== 'string') {
    console.warn('Invalid cron expression: empty or not a string. Defaulting to daily.');
    return '0 4 * * *';
  }
  
  // Return the expression if it's already a valid cron expression
  if (cron.validate(expression)) {
    return expression;
  }
  
  // Handle special values
  if (expression === 'daily') {
    return '0 4 * * *'; // 4am every day
  }
  
  if (expression === 'weekly') {
    return '0 4 * * 1'; // 4am every Monday
  }
  
  if (expression === 'monthly') {
    return '0 4 1 * *'; // 4am on the 1st of every month
  }
  
  // Log warning for invalid expressions
  console.warn(`Invalid cron expression: "${expression}". Defaulting to daily (0 4 * * *).`);
  // Default to daily at 4am if invalid
  return '0 4 * * *';
};

/**
 * Calculate the next run date given a cron expression
 */
export const calculateNextRun = (cronExpression: string): Date => {
  const parsedExpression = parseCronExpression(cronExpression);
  // Create a new Date object for calculation
  const now = new Date();
  // Add one day as a simple next run calculation
  const nextDate = new Date(now);
  nextDate.setDate(now.getDate() + 1);
  nextDate.setHours(4, 0, 0, 0); // Set to 4 AM
  return nextDate;
};

/**
 * Crawl competitor insights for the top ranking competitors
 * This function analyzes the top competitors for each keyword
 */
export const crawlCompetitorInsights = async (): Promise<void> => {
  try {
    console.log('Starting competitor insights crawl...');
    
    // Get the latest rankings
    const latestRankings = await db.select({
      keywordId: rankings.keywordId,
      rankingDate: rankings.date,
      maxId: sql<number>`MAX(${rankings.id})`.as('max_id')
    })
    .from(rankings)
    .groupBy(rankings.keywordId, rankings.date)
    .orderBy(desc(rankings.date));
    
    // Get a list of unique keyword IDs from the latest rankings
    const keywordIdsSet = new Set<number>();
    latestRankings.forEach(r => keywordIdsSet.add(r.keywordId));
    const keywordIds = Array.from(keywordIdsSet);
    console.log(`Found ${keywordIds.length} keywords with rankings to analyze`);
    
    // For each keyword, get the top 3 competitors
    for (const keywordId of keywordIds) {
      console.log(`Processing competitors for keyword ID ${keywordId}...`);
      
      // Get the top competitors for this keyword
      const topCompetitors = await db.select()
        .from(competitors)
        .where(eq(competitors.keywordId, keywordId))
        .orderBy(asc(competitors.position))
        .limit(3); // Only analyze the top 3 competitors
      
      if (topCompetitors.length === 0) {
        console.log(`No competitors found for keyword ID ${keywordId}`);
        continue;
      }
      
      console.log(`Found ${topCompetitors.length} competitors for keyword ID ${keywordId}`);
      
      // Process each competitor
      for (const competitor of topCompetitors) {
        try {
          console.log(`Analyzing competitor ${competitor.domain} (ID: ${competitor.id}) for keyword ID ${keywordId}...`);
          // Start the analysis (this function handles storing the task ID if it doesn't complete immediately)
          await getCompetitorInsights(competitor.id);
        } catch (competitorError) {
          console.error(`Error analyzing competitor ${competitor.id}:`, competitorError);
        }
      }
    }
    
    console.log('Competitor insights crawl completed.');
  } catch (error) {
    console.error('Error in competitor insights crawl:', error);
  }
};

/**
 * Background task checker for incomplete OnPage API tasks
 * This function checks for insights with taskIds that haven't completed yet
 * and updates them when the tasks finish
 */
export const checkIncompleteOnPageTasks = async (): Promise<void> => {
  try {
    console.log('[Background Task Checker] Checking for incomplete OnPage API tasks...');
    
    // Find all insights that have a taskId but are incomplete (empty H1/H2/density)
    // We'll check insights that:
    // 1. Have a taskId
    // 2. Have empty H1 array OR empty keywordDensity array
    // 3. Were created/updated more than 5 minutes ago (to avoid checking tasks that just started)
    
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const incompleteInsights = await db.select()
      .from(competitorInsights)
      .where(
        sql`${competitorInsights.taskId} IS NOT NULL 
            AND (
              array_length(${competitorInsights.h1}, 1) IS NULL
              OR ${competitorInsights.keywordDensity} = '[]'::jsonb
              OR ${competitorInsights.description} = 'Analysis in progress...'
            )
            AND ${competitorInsights.updatedAt} < ${fiveMinutesAgo}`
      )
      .limit(20); // Check up to 20 at a time to avoid overwhelming the API
    
    if (incompleteInsights.length === 0) {
      console.log('[Background Task Checker] No incomplete tasks found');
      return;
    }
    
    console.log(`[Background Task Checker] Found ${incompleteInsights.length} incomplete tasks to check`);
    
    let completedCount = 0;
    let stillPendingCount = 0;
    let errorCount = 0;
    
    for (const insight of incompleteInsights) {
      if (!insight.taskId) continue;
      
      try {
        console.log(`[Background Task Checker] Checking task ${insight.taskId} for competitor ${insight.competitorId}...`);
        
        const isCompleted = await isTaskCompleted(insight.taskId);
        
        if (isCompleted) {
          console.log(`[Background Task Checker] ✅ Task ${insight.taskId} is now completed! Fetching results...`);
          
          // Fetch and update the insight
          const updatedInsight = await getOnPageTaskResult(insight.taskId, insight.competitorId);
          
          if (updatedInsight) {
            completedCount++;
            console.log(`[Background Task Checker] ✅ Updated insight for competitor ${insight.competitorId} with complete data`);
          } else {
            errorCount++;
            console.error(`[Background Task Checker] ⚠️  Failed to fetch results for task ${insight.taskId}`);
          }
        } else {
          stillPendingCount++;
          console.log(`[Background Task Checker] ⏳ Task ${insight.taskId} is still processing...`);
        }
        
        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 seconds between checks
        
      } catch (error) {
        errorCount++;
        console.error(`[Background Task Checker] ❌ Error checking task ${insight.taskId}:`, error);
      }
    }
    
    console.log(`[Background Task Checker] Summary: ${completedCount} completed, ${stillPendingCount} still pending, ${errorCount} errors`);
    
  } catch (error) {
    console.error('[Background Task Checker] Error in background task checker:', error);
  }
};

/**
 * Initialize the scheduler
 */
export const initializeScheduler = async (): Promise<void> => {
  try {
    // Stop any existing tasks
    if (scheduledTask) {
      scheduledTask.stop();
    }
    
    if (competitorAnalysisTask) {
      competitorAnalysisTask.stop();
    }
    
    if (backgroundTaskChecker) {
      backgroundTaskChecker.stop();
    }
    
    // Get the active schedule
    const schedule = await storage.getActiveSchedule();
    
    if (!schedule || !schedule.isActive) {
      console.log('No active schedule found. Automatic crawling is disabled.');
      return;
    }
    
    // Parse cron expression
    const cronExpression = parseCronExpression(schedule.cronExpression);
    
    // Calculate next run time
    const nextRun = calculateNextRun(cronExpression);
    
    // Update schedule with next run time
    await storage.updateScheduleRunInfo(
      schedule.id,
      schedule.lastRun || new Date(),
      nextRun
    );
    
    // Schedule keyword crawl task
    scheduledTask = cron.schedule(cronExpression, async () => {
      console.log('Running scheduled keyword crawl...');
      
      try {
        // Run the crawl
        await crawlKeywords();
        
        // Update schedule info
        const now = new Date();
        const updatedSchedule = await storage.getActiveSchedule();
        
        if (updatedSchedule) {
          const nextRun = calculateNextRun(updatedSchedule.cronExpression);
          await storage.updateScheduleRunInfo(updatedSchedule.id, now, nextRun);
        }
      } catch (error) {
        console.error('Error in scheduled keyword crawl:', error);
      }
    });
    
    // Schedule competitor analysis task to run 30 minutes after the keyword crawl
    // This gives enough time for the keyword crawl to complete and identifies new competitors
    const competitorCronExpression = cronExpression.replace(/^(\d+) (\d+)/, (_, minutes, hours) => {
      // Add 30 minutes to the current time
      let newMinutes = parseInt(minutes) + 30;
      let newHours = parseInt(hours);
      
      // Handle hour rollover if minutes > 59
      if (newMinutes >= 60) {
        newMinutes = newMinutes - 60;
        newHours = (newHours + 1) % 24;
      }
      
      return `${newMinutes} ${newHours}`;
    });
    
    competitorAnalysisTask = cron.schedule(competitorCronExpression, async () => {
      console.log('Running scheduled competitor analysis...');
      
      try {
        // Run the competitor analysis
        await crawlCompetitorInsights();
      } catch (error) {
        console.error('Error in scheduled competitor analysis:', error);
      }
    });
    
    console.log(`Keyword crawler initialized. Next run: ${nextRun.toLocaleString()}`);
    
    // Calculate the competitor analysis next run time (30 minutes after keyword crawl)
    const compAnalysisNextRun = new Date(nextRun);
    compAnalysisNextRun.setMinutes(compAnalysisNextRun.getMinutes() + 30);
    console.log(`Competitor analysis initialized. Next run: ${compAnalysisNextRun.toLocaleString()}`);
    
    // Schedule background task checker to run every 10 minutes
    // This checks for incomplete OnPage API tasks and updates them when they complete
    backgroundTaskChecker = cron.schedule('*/10 * * * *', async () => {
      console.log('[Scheduler] Running background OnPage task checker...');
      try {
        await checkIncompleteOnPageTasks();
      } catch (error) {
        console.error('[Scheduler] Error in background task checker:', error);
      }
    });
    
    console.log('Background OnPage task checker initialized. Runs every 10 minutes.');
  } catch (error) {
    console.error('Error initializing scheduler:', error);
  }
};
