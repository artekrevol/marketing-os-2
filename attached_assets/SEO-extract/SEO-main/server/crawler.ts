import { storage } from './storage';
import { Keyword, InsertRanking, Location, InsertKeywordBatch, InsertKeywordBatchItem, InsertCompetitor, keywordBatchItems, KeywordBatch, rankings, competitors, Ranking } from '@shared/schema';
import { searchWithDataForSEO } from './dataForSEO';
import { db } from './db';
import { getCompetitorInsights } from './onPageAPI';

// Constants for API rate limiting
// Make delay configurable via environment variable (default: 1 second for faster processing)
// DataForSEO typically allows 1-2 requests per second on most plans
const API_DELAY_MS = parseInt(process.env.CRAWLER_DELAY_MS || "1000", 10); // Default: 1 second (was 5 seconds)
const MAX_KEYWORDS_PER_BATCH = parseInt(process.env.MAX_KEYWORDS_PER_BATCH || "70", 10); // Maximum keywords to process in one batch
const MAX_RETRIES = 2; // Maximum retries for failed API calls
const PARALLEL_REQUESTS = parseInt(process.env.PARALLEL_CRAWL_REQUESTS || "1", 10); // Number of parallel requests (default: 1, set to 2-3 for faster processing)

/**
 * Sleep for a specified number of milliseconds
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Crawl Google search results for a set of keywords
 */
export const crawlKeywords = async (keywordIds?: number[], existingBatchId?: number) => {
  let batch: KeywordBatch | undefined;
  try {
    // Use existing batch if provided, otherwise create a new one
    if (existingBatchId) {
      const existingBatch = await storage.getKeywordBatch(existingBatchId);
      if (!existingBatch) {
        throw new Error(`Batch ${existingBatchId} not found`);
      }
      batch = existingBatch;
      // Update batch status to running
      await storage.updateKeywordBatchStatus(batch.id, 'running', new Date());
    } else {
      // Create a new batch
      const batchData: InsertKeywordBatch = {
        status: 'running',
        startTime: new Date(),
        endTime: null
      };
      batch = await storage.createKeywordBatch(batchData);
    }

    if (!batch) {
      throw new Error('Failed to create or retrieve batch');
    }

    // TypeScript now knows batch is defined
    const currentBatch = batch;

    console.log(`Starting batch ${currentBatch.id}`);

    // Get keywords to process
    let keywords: Keyword[];
    if (keywordIds && keywordIds.length > 0) {
      // If specific keywords were requested
      keywords = await Promise.all(
        keywordIds.map(id => storage.getKeyword(id))
      ).then(results => results.filter((k): k is Keyword => k !== undefined));
    } else {
      // Get all keywords from storage
      keywords = await storage.getKeywords();
    }

    // Process all keywords (removed batch limit)
    console.log(`Processing all ${keywords.length} keywords (no batch limit applied)`);

    // Create batch items for all keywords upfront using bulk insert for speed
    console.log(`Creating batch items for ${keywords.length} keywords (bulk insert)...`);
    const startTime = Date.now();

    // Fetch existing items once (not per keyword!)
    const existingItems = await storage.getKeywordBatchItems(currentBatch.id);
    const existingKeywordIds = new Set(existingItems.map(item => item.keywordId));

    // Prepare batch items for keywords that don't already exist
    const newBatchItems: InsertKeywordBatchItem[] = keywords
      .filter(keyword => !existingKeywordIds.has(keyword.id))
      .map(keyword => ({
        batchId: currentBatch.id,
        keywordId: keyword.id,
        status: 'pending' as const,
        startTime: null,
        endTime: null,
        message: null
      }));

    // Bulk insert all new batch items at once
    if (newBatchItems.length > 0) {
      try {
        // Use drizzle's bulk insert capability if db is available
        // Wrap in transaction for atomicity
        if (db) {
          // Insert in chunks of 100 to avoid query size limits
          const CHUNK_SIZE = 100;
          // Use transaction to ensure all chunks are inserted atomically
          await db.transaction(async (tx) => {
            for (let i = 0; i < newBatchItems.length; i += CHUNK_SIZE) {
              const chunk = newBatchItems.slice(i, i + CHUNK_SIZE);
              await tx.insert(keywordBatchItems).values(chunk);
            }
          });

          const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
          console.log(`✅ Created ${newBatchItems.length} batch items in ${elapsed}s (bulk insert)`);
        } else {
          // Fallback to storage method if db is not available
          throw new Error('Database not available');
        }
      } catch (error) {
        console.error(`Error bulk creating batch items:`, error);
        // Fallback to individual inserts if bulk fails
        console.log(`Falling back to individual inserts...`);
        for (const item of newBatchItems) {
          try {
            await storage.createKeywordBatchItem(item);
          } catch (err) {
            // Skip duplicates
            if (err instanceof Error && err.message.includes('duplicate')) {
              continue;
            }
            console.error(`Error creating batch item:`, err);
          }
        }
      }
    } else {
      console.log(`All ${keywords.length} keywords already have batch items`);
    }

    console.log(`Processing ${keywords.length} keywords in batch ${currentBatch.id} (${PARALLEL_REQUESTS} parallel requests, ${API_DELAY_MS}ms delay)`);
    let completedCount = 0;
    let failedCount = 0;

    /**
     * Process a single keyword
     */
    const processKeyword = async (keyword: Keyword): Promise<{ success: boolean; error?: string }> => {
      let retryCount = 0;
      let success = false;

      while (retryCount <= MAX_RETRIES && !success) {
        try {
          if (retryCount > 0) {
            console.log(`Retry attempt ${retryCount} for keyword: ${keyword.keyword}`);
            // Add an exponential backoff delay on retries
            await sleep(API_DELAY_MS * Math.pow(2, retryCount));
          }

          console.log(`\nProcessing keyword: ${keyword.keyword}`);

          // Update batch item status to running (items were created upfront)
          // This will also set startTime automatically
          await storage.updateKeywordBatchItemStatus(
            currentBatch.id,
            keyword.id,
            'running'
          );

          // Get location if specified
          let location: Location | undefined;
          if (keyword.locationId) {
            location = await storage.getLocation(keyword.locationId);
          }

          // Determine the target domain to track
          // If keyword has a specific target URL set, extract the domain
          // Otherwise use a default domain
          let targetDomain = 'tekrevol.com'; // Default target domain

          if (keyword.targetUrl) {
            try {
              // Extract domain from URL - ensure URL has protocol
              const url = new URL(keyword.targetUrl.startsWith('http')
                ? keyword.targetUrl
                : `https://${keyword.targetUrl}`);
              targetDomain = url.hostname.replace('www.', '');
              console.log(`Using specific target domain: ${targetDomain} from URL: ${keyword.targetUrl}`);
            } catch (e) {
              console.log(`Invalid target URL in keyword (${keyword.targetUrl}), using default domain`);
            }
          }

          // Search for the keyword using DataForSEO
          console.log(`Sending API request for keyword "${keyword.keyword}" to DataForSEO...`);
          const searchData = await searchWithDataForSEO(
            keyword,
            targetDomain,
            location
          );

          // Extract results and competitors from response
          const results = searchData.results;
          const competitorResults = searchData.competitors;
          console.log(`Received ${results.length} results and ${competitorResults.length} competitors for keyword "${keyword.keyword}"`);

          // OPTIMIZED: Batch all database operations for this keyword in a single transaction
          if (results && results.length > 0 || (competitorResults && competitorResults.length > 0)) {
            const currentDate = new Date();

            // Batch fetch all previous rankings for this keyword at once (much more efficient)
            const allPreviousRankings = await storage.getRankingsByKeywordId(keyword.id);
            const previousRankingsByType = new Map<string, Ranking>();

            // Group by resultType and get the latest for each type
            for (const ranking of allPreviousRankings) {
              const type = ranking.resultType || 'organic';
              const existing = previousRankingsByType.get(type);
              if (!existing || (ranking.date && existing.date && new Date(ranking.date) > new Date(existing.date))) {
                previousRankingsByType.set(type, ranking);
              }
            }

            // Prepare all rankings for bulk insert
            const rankingsToInsert: InsertRanking[] = [];
            for (const result of results) {
              const resultType = result.resultType || 'organic';
              const previousRanking = previousRankingsByType.get(resultType);

              // Calculate position change
              const previousPosition = previousRanking?.position || -1;
              const positionChange = previousPosition > 0 ? previousPosition - result.position : 0;

              rankingsToInsert.push({
                keywordId: keyword.id,
                position: result.position,
                previousPosition: previousPosition,
                positionChange: positionChange,
                url: result.url || "",
                date: currentDate,
                resultType: resultType,
                title: result.title || "",
                domain: result.domain || "",
                isScheduled: true
              });
            }

            // Prepare all competitors for bulk insert
            // Sort by position first to ensure we get the top competitors
            const competitorsToInsert: InsertCompetitor[] = [];
            if (competitorResults && competitorResults.length > 0) {
              console.log(`Preparing ${competitorResults.length} competitors for bulk insert for keyword "${keyword.keyword}"`);

              // Sort competitors by position (ascending - position 1 is best)
              const sortedCompetitors = [...competitorResults].sort((a, b) => a.position - b.position);

              for (const competitor of sortedCompetitors) {
                competitorsToInsert.push({
                  keywordId: keyword.id,
                  domain: competitor.domain,
                  url: competitor.url,
                  title: competitor.title || "",
                  position: competitor.position,
                  batchId: currentBatch.id,
                  date: currentDate
                });
              }
            }

            // Bulk insert everything in a single transaction
            if (db && (rankingsToInsert.length > 0 || competitorsToInsert.length > 0)) {
              let allInsertedCompetitors: any[] = [];

              await db.transaction(async (tx) => {
                // Bulk insert rankings
                if (rankingsToInsert.length > 0) {
                  const CHUNK_SIZE = 50; // Insert rankings in chunks
                  for (let i = 0; i < rankingsToInsert.length; i += CHUNK_SIZE) {
                    const chunk = rankingsToInsert.slice(i, i + CHUNK_SIZE);
                    await tx.insert(rankings).values(chunk);
                  }
                  console.log(`✅ Bulk inserted ${rankingsToInsert.length} rankings for keyword "${keyword.keyword}"`);
                }

                // Bulk insert competitors
                if (competitorsToInsert.length > 0) {
                  const CHUNK_SIZE = 50; // Insert competitors in chunks
                  for (let i = 0; i < competitorsToInsert.length; i += CHUNK_SIZE) {
                    const chunk = competitorsToInsert.slice(i, i + CHUNK_SIZE);
                    const insertedCompetitors = await tx.insert(competitors).values(chunk).returning();
                    // Collect all inserted competitors
                    allInsertedCompetitors.push(...insertedCompetitors);
                  }
                  console.log(`✅ Bulk inserted ${competitorsToInsert.length} competitors for keyword "${keyword.keyword}"`);
                }
              });

              // Get top 10 competitors by position (they're already sorted by position from competitorResults)
              const topCompetitorsToProcess = allInsertedCompetitors
                .sort((a, b) => a.position - b.position)
                .slice(0, 10);

              // Fetch insights for top 10 competitors AFTER transaction is committed
              if (topCompetitorsToProcess.length > 0) {
                console.log(`📊 Fetching insights for ${topCompetitorsToProcess.length} top competitors of "${keyword.keyword}"...`);

                let successfulInsights = 0;
                let failedInsights = 0;

                // Fetch insights sequentially with rate limiting
                for (const storedCompetitor of topCompetitorsToProcess) {
                  try {
                    console.log(`  ⏳ Fetching insights for ${storedCompetitor.domain}...`);
                    const insights = await getCompetitorInsights(storedCompetitor.id, storedCompetitor);

                    if (insights) {
                      // Check if insights already exist for this competitor
                      const existingInsights = await storage.getCompetitorInsights(storedCompetitor.id);

                      if (existingInsights) {
                        // Delete old insights to replace with fresh data
                        await storage.deleteCompetitorInsight(existingInsights.id);
                      }

                      // Store the new insights
                      await storage.createCompetitorInsight({
                        competitorId: insights.competitorId,
                        url: insights.url,
                        title: insights.title,
                        description: insights.description,
                        canonical: insights.canonical,
                        metaKeywords: insights.metaKeywords,
                        h1: insights.h1,
                        h2: insights.h2,
                        h3: insights.h3,
                        h4: insights.h4,
                        h5: insights.h5,
                        h6: insights.h6,
                        keywordDensity: insights.keywordDensity,
                        robotsTxt: insights.robotsTxt,
                        images: insights.images,
                        taskId: null
                      });

                      successfulInsights++;
                      console.log(`  ✅ Stored insights for ${storedCompetitor.domain} (${successfulInsights}/${topCompetitorsToProcess.length})`);
                      
                      // Log insight details for debugging
                      const hasH1 = Array.isArray(insights.h1) && insights.h1.length > 0;
                      const hasH2 = Array.isArray(insights.h2) && insights.h2.length > 0;
                      const hasDensity = Array.isArray(insights.keywordDensity) && insights.keywordDensity.length > 0;
                      console.log(`     H1: ${hasH1 ? `✅ (${insights.h1.length})` : '❌'}, H2: ${hasH2 ? `✅ (${insights.h2.length})` : '❌'}, Density: ${hasDensity ? `✅ (${insights.keywordDensity.length})` : '❌'}`);
                    } else {
                      failedInsights++;
                      console.warn(`  ⚠️  Failed to fetch insights for ${storedCompetitor.domain} (${failedInsights} failed)`);
                    }

                    // Add small delay to avoid rate limiting (500ms between insights requests)
                    if (topCompetitorsToProcess.indexOf(storedCompetitor) < topCompetitorsToProcess.length - 1) {
                      await sleep(500);
                    }

                  } catch (error) {
                    failedInsights++;
                    console.error(`  ❌ Error fetching insights for ${storedCompetitor.domain}:`, error);
                    // Continue with next competitor even if this one fails
                  }
                }

                console.log(`✅ Insights fetching complete for "${keyword.keyword}": ${successfulInsights} successful, ${failedInsights} failed`);
              }
            } else {
              // Fallback to individual inserts if db is not available
              console.warn('Database not available, falling back to individual inserts');
              for (const ranking of rankingsToInsert) {
                await storage.createRanking(ranking);
              }
              for (const competitor of competitorsToInsert) {
                await storage.createCompetitor(competitor);
              }
            }
          }

          // Update batch item status
          await storage.updateKeywordBatchItemStatus(
            currentBatch.id,
            keyword.id,
            'completed'
          );

          success = true;
          console.log(`Successfully processed keyword: ${keyword.keyword}`);
          return { success: true };

        } catch (error) {
          retryCount++;
          console.error(`Error processing keyword ${keyword.keyword} (attempt ${retryCount}):`, error);

          if (retryCount > MAX_RETRIES) {
            // Update batch item status as failed after max retries
            await storage.updateKeywordBatchItemStatus(
              currentBatch.id,
              keyword.id,
              'failed',
              error instanceof Error ? error.message : 'Unknown error'
            );
            console.log(`Failed to process keyword after ${MAX_RETRIES} retries: ${keyword.keyword}`);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
          }
        }
      }
      return { success: false, error: 'Max retries exceeded' };
    };

    // Process keywords with controlled parallelism
    if (PARALLEL_REQUESTS > 1) {
      // Process in parallel batches
      for (let i = 0; i < keywords.length; i += PARALLEL_REQUESTS) {
        const keywordBatch = keywords.slice(i, i + PARALLEL_REQUESTS);
        const promises = keywordBatch.map(keyword => processKeyword(keyword));
        const results = await Promise.all(promises);

        // Count successes and failures
        results.forEach(result => {
          if (result.success) {
            completedCount++;
          } else {
            failedCount++;
          }
        });

        // Add delay between batches (not between individual requests in a batch)
        if (i + PARALLEL_REQUESTS < keywords.length) {
          console.log(`Waiting ${API_DELAY_MS / 1000} seconds before next batch (rate limiting)...`);
          await sleep(API_DELAY_MS);
        }
      }
    } else {
      // Sequential processing (original behavior)
      for (const keyword of keywords) {
        const result = await processKeyword(keyword);
        if (result.success) {
          completedCount++;
        } else {
          failedCount++;
        }

        // Add delay between keywords to respect rate limits (even after success)
        if (keywords.indexOf(keyword) < keywords.length - 1) {
          console.log(`Waiting ${API_DELAY_MS / 1000} seconds before next API request (rate limiting)...`);
          await sleep(API_DELAY_MS);
        }
      }
    }

    // Verify all items are completed or failed before marking batch as completed
    const finalItems = await storage.getKeywordBatchItems(currentBatch.id);
    const stillRunning = finalItems.filter(i => i.status === 'running').length;
    const stillPending = finalItems.filter(i => i.status === 'pending').length;

    if (stillRunning === 0 && stillPending === 0) {
      // All items are done, mark batch as completed
      await storage.updateKeywordBatchStatus(currentBatch.id, 'completed', new Date());
      console.log(`Batch ${currentBatch.id} completed. ${completedCount} keywords processed successfully, ${failedCount} failed.`);
    } else {
      // Some items are still running/pending, mark as failed (shouldn't happen but safety check)
      console.warn(`Batch ${currentBatch.id} finished but has ${stillRunning} running and ${stillPending} pending items. Marking as failed.`);
      await storage.updateKeywordBatchStatus(currentBatch.id, 'failed', new Date());
    }

    return { batchId: currentBatch.id, completedCount, failedCount };

  } catch (error) {
    console.error('Error in crawlKeywords:', error);
    // If batch was created but processing failed, mark it as failed
    if (batch) {
      try {
        await storage.updateKeywordBatchStatus(batch.id, 'failed', new Date());
      } catch (updateError) {
        console.error('Error updating batch status after failure:', updateError);
      }
    }
    throw error;
  }
};