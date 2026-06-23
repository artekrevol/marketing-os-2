/**
 * Routes for the competitor insights API
 * These routes handle fetching and analyzing competitor insights
 */

import { Request, Response } from "express";
import { getCompetitorInsights } from "./onPageAPI";
import { storage } from "./storage";
import { cacheMiddleware } from "./cache";

export function registerCompetitorInsightsRoutes(app: any) {
  /**
   * Get insights for a specific competitor
   */
  /**
   * Get insights for a specific competitor (from database only)
   * Insights are now automatically fetched and stored during crawl
   */
  app.get("/api/competitor-insights/:competitorId", async (req: Request, res: Response) => {
    try {
      const competitorId = Number(req.params.competitorId);

      if (isNaN(competitorId)) {
        return res.status(400).json({ message: "Invalid competitor ID" });
      }

      console.log(`[API] Fetching insights for competitor ${competitorId} from database`);

      // Get existing insights from the database only
      // Insights should already be stored during crawl
      const existingInsights = await storage.getCompetitorInsights(competitorId);

      if (existingInsights) {
        console.log(`[API] Found existing insights for competitor ${competitorId}:`, {
          hasH1: Array.isArray(existingInsights.h1) && existingInsights.h1.length > 0,
          hasH2: Array.isArray(existingInsights.h2) && existingInsights.h2.length > 0,
          hasKeywordDensity: Array.isArray(existingInsights.keywordDensity) && existingInsights.keywordDensity.length > 0
        });
        return res.json(existingInsights);
      }

      // If no insights exist, return 404
      // Insights should be fetched automatically during crawl
      console.warn(`[API] No insights found for competitor ${competitorId} - they should be fetched during crawl`);
      return res.status(404).json({
        message: "No insights available. Insights are automatically fetched during keyword crawl. Please run a crawl for this keyword.",
        needsAnalysis: false
      });
    } catch (error) {
      console.error(`[API] Error getting competitor insights for ${req.params.competitorId}:`, error);
      res.status(500).json({
        message: "Failed to get competitor insights",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * Get all competitor insights (with caching)
   */
  app.get("/api/competitor-insights", cacheMiddleware(300000), async (_req: Request, res: Response) => {
    try {
      const insights = await storage.getAllCompetitorInsights();
      res.json(insights);
    } catch (error) {
      console.error("Error getting all competitor insights:", error);
      res.status(500).json({ message: "Failed to get competitor insights" });
    }
  });

  /**
   * Get insights for all competitors of a specific keyword (optimized endpoint)
   * This endpoint uses a single bulk query instead of individual lookups for much better performance
   */
  app.get("/api/competitor-insights/by-keyword/:keywordId", cacheMiddleware(300000), async (req: Request, res: Response) => {
    const startTime = Date.now();
    try {
      const keywordId = Number(req.params.keywordId);

      if (isNaN(keywordId)) {
        return res.status(400).json({ message: "Invalid keyword ID" });
      }

      console.log(`[API] Fetching insights for keyword ${keywordId} competitors (optimized bulk query)`);

      // First, get all competitors for this keyword
      const competitors = await storage.getLatestCompetitorsByKeywordId(keywordId, 50);
      console.log(`[API] Found ${competitors.length} competitors for keyword ${keywordId}`);

      if (competitors.length === 0) {
        console.log(`[API] No competitors found for keyword ${keywordId}`);
        return res.json({});
      }

      // Extract competitor IDs
      const competitorIds = competitors.map(c => c.id);
      console.log(`[API] Competitor IDs to query: [${competitorIds.slice(0, 10).join(', ')}${competitorIds.length > 10 ? '...' : ''}]`);

      // Fetch all insights in a single bulk query (much faster than individual queries)
      const insights = await storage.getCompetitorInsightsByCompetitorIds(competitorIds);
      console.log(`[API] Retrieved ${insights.length} insights from database`);

      // Create a map for quick lookup
      const insightsMap: Record<number, any> = {};
      for (const insight of insights) {
        insightsMap[insight.competitorId] = insight;
        
        // Log details for first few insights for debugging
        if (Object.keys(insightsMap).length <= 3) {
          const hasH1 = Array.isArray(insight.h1) && insight.h1.length > 0;
          const hasH2 = Array.isArray(insight.h2) && insight.h2.length > 0;
          const hasDensity = Array.isArray(insight.keywordDensity) && insight.keywordDensity.length > 0;
          console.log(`[API] Insight for competitor ${insight.competitorId}: H1=${hasH1}, H2=${hasH2}, Density=${hasDensity}`);
        }
      }

      const elapsed = Date.now() - startTime;
      console.log(`[API] Found insights for ${Object.keys(insightsMap).length} out of ${competitors.length} competitors (bulk query, ${elapsed}ms)`);

      res.json(insightsMap);
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.error(`[API] Error getting insights for keyword ${req.params.keywordId} (${elapsed}ms):`, error);
      res.status(500).json({
        message: "Failed to get competitor insights for keyword",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });


  /**
   * Analyze a competitor to get insights
   */
  app.post("/api/competitor-insights/analyze", async (req: Request, res: Response) => {
    try {
      const { competitorId } = req.body;

      if (!competitorId) {
        return res.status(400).json({ message: "Competitor ID is required" });
      }

      // Fetch the competitor data
      const competitor = await storage.getCompetitor(competitorId);

      if (!competitor) {
        return res.status(404).json({ message: "Competitor not found" });
      }

      // To avoid long-running requests, we'll just start the analysis process
      // and return a status message. In a production app, we would use a queue system
      // like Redis or RabbitMQ for this.

      // Check if we already have insights for this competitor
      // Delete existing insights to force a refresh with improved data
      const existingInsights = await storage.getCompetitorInsights(competitorId);
      if (existingInsights) {
        console.log(`Deleting existing insights for competitor ID ${competitorId} to refresh data`);
        await storage.deleteCompetitorInsight(existingInsights.id);
      }

      // Start the analysis in the background
      // This is a simple version - in production we would use a proper task queue
      setTimeout(async () => {
        try {
          console.log(`Starting background analysis for competitor ID ${competitorId}`);
          const insights = await getCompetitorInsights(competitorId);

          if (insights) {
            // Store the insights in the database
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
              taskId: null // We don't need to store this for now
            });
            console.log(`Successfully stored insights for competitor ID ${competitorId}`);
          } else {
            console.error(`Failed to get insights for competitor ID ${competitorId}`);
          }
        } catch (error) {
          console.error(`Background analysis error for competitor ID ${competitorId}:`, error);
        }
      }, 0);

      // Return immediately with status information
      res.status(202).json({
        message: "Analysis started in background",
        status: "processing",
        competitorId: competitorId
      });
    } catch (error) {
      console.error("Error processing competitor analysis request:", error);
      res.status(500).json({ message: "Failed to analyze competitor" });
    }
  });
}