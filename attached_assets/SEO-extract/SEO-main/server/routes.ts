import express, { type Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { z } from "zod";
import { 
  insertKeywordSchema, 
  insertLocationSchema,
  insertScheduleSchema,
  insertDashboardLayoutSchema
} from "@shared/schema";
import * as schema from "@shared/schema";
import { db } from "./db";
import { and, eq, desc, isNotNull, sql } from "drizzle-orm";
import { crawlKeywords } from "./crawler";
import { initializeScheduler, calculateNextRun, parseCronExpression } from "./scheduler";
import { registerCompetitorInsightsRoutes } from "./competitorInsightsRoutes";
import { registerDiagnosticRoutes } from "./diagnosticRoutes";
import { registerOnPageAPITestRoutes } from "./onPageAPITestRoutes";
import { registerOnPageAPIDiagnosticRoutes } from "./onPageAPIDiagnosticRoutes";
import { registerKeywordResearchAPITestRoutes } from "./keywordResearchAPITestRoutes";
import { serverCache, cacheMiddleware } from "./cache";

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // Initialize the crawler scheduler (only if database is available)
  if (db) {
    await initializeScheduler().catch((error) => {
      console.error('Failed to initialize scheduler:', error);
      console.log('Scheduler will not run, but the app will continue.');
    });
  } else {
    console.log('Database not configured. Scheduler will not be initialized.');
  }
  
  // Register competitor insights routes
  registerCompetitorInsightsRoutes(app);
  
  // Register diagnostic routes for development
  registerDiagnosticRoutes(app);
  
  // Register OnPage API test routes
  registerOnPageAPITestRoutes(app);
  
  // Register OnPage API diagnostic routes
  registerOnPageAPIDiagnosticRoutes(app);
  
  // Register Keyword Research API test routes
  registerKeywordResearchAPITestRoutes(app);

  // Project export route
  app.get('/export', (_req: Request, res: Response) => {
    res.sendFile('export-instructions.html', { root: './public' });
  });

  // Allow direct access to zip chunks for downloading
  app.use('/zip-chunks', express.static('zip-chunks'));

  // Add health check endpoint for deployment monitoring
  app.get('/api/health', async (_req: Request, res: Response) => {
    const health: any = {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development'
    };

    // Check database connectivity
    if (db) {
      try {
        await db.execute(sql`SELECT 1`);
        health.database = { connected: true };
      } catch (error) {
        health.database = { connected: false, error: String(error) };
        health.status = 'degraded';
      }
    } else {
      health.database = { connected: false, reason: 'DATABASE_URL not configured' };
    }

    // Check API credentials
    health.apiCredentials = {
      dataForSEO: {
        configured: !!(process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN) &&
                     !!(process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD)
      }
    };

    // Get active batch count for monitoring
    if (db) {
      try {
        const { keywordBatches } = await import('@shared/schema');
        const activeBatches = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(keywordBatches)
          .where(eq(keywordBatches.status, 'running'));
        health.activeBatches = activeBatches[0]?.count || 0;
      } catch (error) {
        // Ignore errors in monitoring data
      }
    }

    // Cache statistics
    health.cache = {
      size: serverCache.size(),
      keys: serverCache.keys().length
    };

    const statusCode = health.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(health);
  });

  // API Routes - all prefixed with /api

  // Dashboard stats (cached for 1 minute)
  app.get("/api/dashboard/stats", cacheMiddleware(60000), async (_req: Request, res: Response) => {
    try {
      const keywords = await storage.getKeywords();
      const locations = await storage.getLocations();
      const rankings = await storage.getRankings();
      const averagePosition = await storage.getAverageRankingPosition();
      const topTenCount = await storage.getTopTenCount();
      const schedule = await storage.getActiveSchedule();

      res.json({
        keywordCount: keywords.length,
        locationCount: locations.length,
        averagePosition,
        topTenCount,
        lastRun: schedule?.lastRun,
        nextRun: schedule?.nextRun
      });
    } catch (error) {
      res.status(500).json({ message: "Error fetching dashboard stats" });
    }
  });

  // Keywords (cached for 2 minutes)
  app.get("/api/keywords", cacheMiddleware(120000), async (_req: Request, res: Response) => {
    try {
      const keywords = await storage.getKeywords();
      res.json(keywords);
    } catch (error) {
      res.status(500).json({ message: "Error fetching keywords" });
    }
  });
  
  // Keyword Groups API endpoints (cached for 2 minutes)
  app.get("/api/keyword-groups", cacheMiddleware(120000), async (_req: Request, res: Response) => {
    try {
      const groups = await storage.getKeywordGroups();
      res.json(groups);
    } catch (error) {
      console.error("Error fetching keyword groups:", error);
      res.status(500).json({ error: "Failed to fetch keyword groups" });
    }
  });
  
  app.get("/api/keyword-groups/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const group = await storage.getKeywordGroup(id);
      
      if (!group) {
        return res.status(404).json({ error: "Keyword group not found" });
      }
      
      res.json(group);
    } catch (error) {
      console.error("Error fetching keyword group:", error);
      res.status(500).json({ error: "Failed to fetch keyword group" });
    }
  });
  
  app.get("/api/keyword-groups/:id/keywords", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const keywords = await storage.getKeywordsByGroupId(id);
      res.json(keywords);
    } catch (error) {
      console.error("Error fetching keywords for group:", error);
      res.status(500).json({ error: "Failed to fetch keywords for group" });
    }
  });
  
  app.get("/api/keyword-groups/:id/subgroups", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const subgroups = await storage.getKeywordGroupsByParentId(id);
      res.json(subgroups);
    } catch (error) {
      console.error("Error fetching subgroups:", error);
      res.status(500).json({ error: "Failed to fetch subgroups" });
    }
  });
  
  app.post("/api/keyword-groups", async (req: Request, res: Response) => {
    // Invalidate cache when groups are created
    serverCache.delete('/api/keyword-groups');
    try {
      const groupData = req.body;
      const newGroup = await storage.createKeywordGroup(groupData);
      res.status(201).json(newGroup);
    } catch (error) {
      console.error("Error creating keyword group:", error);
      res.status(500).json({ error: "Failed to create keyword group" });
    }
  });
  
  app.put("/api/keyword-groups/:id", async (req: Request, res: Response) => {
    // Invalidate cache when groups are updated
    serverCache.delete('/api/keyword-groups');
    try {
      const id = parseInt(req.params.id);
      const groupData = req.body;
      const updatedGroup = await storage.updateKeywordGroup(id, groupData);
      
      if (!updatedGroup) {
        return res.status(404).json({ error: "Keyword group not found" });
      }
      
      res.json(updatedGroup);
    } catch (error) {
      console.error("Error updating keyword group:", error);
      res.status(500).json({ error: "Failed to update keyword group" });
    }
  });
  
  app.delete("/api/keyword-groups/:id", async (req: Request, res: Response) => {
    // Invalidate cache when groups are deleted
    serverCache.delete('/api/keyword-groups');
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteKeywordGroup(id);
      
      if (!success) {
        return res.status(404).json({ error: "Keyword group not found" });
      }
      
      res.status(204).end();
    } catch (error) {
      console.error("Error deleting keyword group:", error);
      res.status(500).json({ error: "Failed to delete keyword group" });
    }
  });

  app.get("/api/keywords/rankings", async (req: Request, res: Response) => {
    try {
      // Get result type from query parameter, default to 'organic'
      const resultType = (req.query.resultType as string) || 'organic';
      
      // Default target domain
      const TARGET_DOMAIN = 'tekrevol.com';
      
      // Get all keywords
      const keywords = await storage.getKeywords();
      
      const result = await Promise.all(
        keywords.map(async (keyword) => {
          // Get all rankings for this keyword
          const allRankings = await storage.getRankingsByKeywordId(keyword.id);
          
          // Filter rankings by result type
          const typeRankings = allRankings.filter(r => r.resultType === resultType);
          
          // Further filter to only include Tekrevol domains
          const rankings = typeRankings.filter(r => {
            // If domain is present, check if it includes tekrevol.com
            if (r.domain) {
              return r.domain.toLowerCase().includes(TARGET_DOMAIN);
            }
            // If URL is present but domain is not, check URL
            if (r.url) {
              return r.url.toLowerCase().includes(TARGET_DOMAIN);
            }
            return false;
          });
          
          // Sort by date (newest first)
          rankings.sort((a, b) => {
            const dateA = a.date ? new Date(a.date).getTime() : 0;
            const dateB = b.date ? new Date(b.date).getTime() : 0;
            return dateB - dateA;
          });
          
          const latestRanking = rankings.length > 0 ? rankings[0] : null;
          const previousRanking = rankings.length > 1 ? rankings[1] : null;

          // Get location if set
          let location = null;
          if (keyword.locationId) {
            location = await storage.getLocation(keyword.locationId);
          }

          // Use stored positionChange if available, otherwise calculate it
          let change = latestRanking?.positionChange ?? 0;
          if (change === 0 && latestRanking && previousRanking) {
            change = previousRanking.position - latestRanking.position;
          }

          return {
            ...keyword,
            latestRanking,
            location: location?.name || "All Locations",
            change
          };
        })
      );

      // Sort by position (lowest first)
      result.sort((a, b) => {
        const posA = a.latestRanking?.position || 100;
        const posB = b.latestRanking?.position || 100;
        return posA - posB;
      });

      res.json(result);
    } catch (error) {
      console.error('Error in /api/keywords/rankings:', error);
      res.status(500).json({ message: "Error fetching keywords with rankings" });
    }
  });

  app.post("/api/keywords", async (req: Request, res: Response) => {
    // Invalidate cache when keywords are added
    serverCache.delete('/api/keywords');
    serverCache.delete('/api/dashboard/stats');
    try {
      // Validate input with nullable fields
      const schema = z.object({
        keyword: z.string().min(1),
        targetUrl: z.string().nullable().optional(),
        locationId: z.number().nullable().optional(),
        group: z.string().nullable().optional(),
        trackDaily: z.boolean().default(true)
      });

      const data = schema.parse(req.body);

      // Set defaults for nullable fields
      const keywordData = {
        keyword: data.keyword,
        targetUrl: data.targetUrl || null,
        locationId: data.locationId || null,
        group: data.group || null,
        trackDaily: data.trackDaily ?? true
      };

      // Create keyword
      const keyword = await storage.createKeyword(keywordData);
      res.status(201).json(keyword);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid keyword data", errors: error.errors });
      } else {
        console.error('Error creating keyword:', error);
        res.status(500).json({ message: "Error creating keyword" });
      }
    }
  });

  // Bulk add keywords
  app.post("/api/keywords/bulk", async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        keywords: z.array(z.string()),
        targetUrl: z.string().nullable().optional(),
        locationId: z.number().nullable().optional(),
        group: z.string().nullable().optional(),
        trackDaily: z.boolean().default(true)
      });

      const { keywords, ...commonProps } = schema.parse(req.body);

      const results = await Promise.all(
        keywords.map(async (keywordText) => {
          try {
            // Set defaults for nullable fields if not provided
            const keywordData = {
              keyword: keywordText,
              targetUrl: commonProps.targetUrl || null,
              locationId: commonProps.locationId || null,
              group: commonProps.group || null,
              trackDaily: commonProps.trackDaily ?? true
            };

            const keyword = await storage.createKeyword(keywordData);
            return { success: true, keyword };
          } catch (error) {
            return { success: false, keyword: keywordText, error: String(error) };
          }
        })
      );

      const successCount = results.filter(r => r.success).length;

      res.status(201).json({
        message: `Added ${successCount} of ${keywords.length} keywords`,
        results
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        console.error('Error adding keywords:', error);
        res.status(500).json({ message: "Error adding keywords" });
      }
    }
  });

  app.put("/api/keywords/:id", async (req: Request, res: Response) => {
    // Invalidate cache when keywords are updated
    serverCache.delete('/api/keywords');
    serverCache.delete('/api/dashboard/stats');
    try {
      const id = parseInt(req.params.id);

      // Validate input (partial schema)
      const validatedData = insertKeywordSchema.partial().parse(req.body);

      // Update keyword
      const keyword = await storage.updateKeyword(id, validatedData);

      if (!keyword) {
        return res.status(404).json({ message: "Keyword not found" });
      }

      res.json(keyword);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid keyword data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Error updating keyword" });
      }
    }
  });

  app.delete("/api/keywords/:id", async (req: Request, res: Response) => {
    // Invalidate cache when keywords are deleted
    serverCache.delete('/api/keywords');
    serverCache.delete('/api/dashboard/stats');
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteKeyword(id);

      if (!success) {
        return res.status(404).json({ message: "Keyword not found" });
      }

      res.json({ message: "Keyword deleted" });
    } catch (error) {
      res.status(500).json({ message: "Error deleting keyword" });
    }
  });
  
  // Delete all keywords endpoint
  app.delete("/api/keywords", async (_req: Request, res: Response) => {
    // Invalidate cache when all keywords are deleted
    serverCache.delete('/api/keywords');
    serverCache.delete('/api/dashboard/stats');
    serverCache.delete('/api/current-rankings');
    serverCache.delete('/api/rankings/history');
    try {
      const count = await storage.deleteAllKeywords();
      res.json({ 
        message: `Successfully deleted all keywords`, 
        count 
      });
    } catch (error) {
      console.error('Error in delete all keywords:', error);
      res.status(500).json({ message: "Error deleting all keywords" });
    }
  });

  // Rankings
  app.get("/api/rankings", async (req: Request, res: Response) => {
    try {
      const keywordId = req.query.keywordId ? parseInt(req.query.keywordId as string) : undefined;

      if (keywordId) {
        const rankings = await storage.getRankingsByKeywordId(keywordId);
        return res.json(rankings);
      }

      const rankings = await storage.getRankings();
      res.json(rankings);
    } catch (error) {
      res.status(500).json({ message: "Error fetching rankings" });
    }
  });
  
  // Export rankings data
  app.get("/api/export/rankings", async (req: Request, res: Response) => {
    try {
      // Get parameters from query
      const format = (req.query.format as string) || 'csv';
      const resultType = (req.query.resultType as string) || 'organic';
      const filterKeyword = req.query.keyword as string;
      const filterLocation = req.query.locationId ? parseInt(req.query.locationId as string) : undefined;
      const filterGroup = req.query.groupId ? parseInt(req.query.groupId as string) : undefined;
      
      // Get all current rankings with keywords and locations
      const keywords = await storage.getKeywords();
      const locations = await storage.getLocations();
      const locationMap = new Map(locations.map(l => [l.id, l]));
      
      // Get results and format properly
      let results = await Promise.all(
        keywords
        .filter(k => {
          // Apply filters if specified
          if (filterKeyword && !k.keyword.toLowerCase().includes(filterKeyword.toLowerCase())) {
            return false;
          }
          if (filterLocation && k.locationId !== filterLocation) {
            return false;
          }
          if (filterGroup && k.groupId !== filterGroup) {
            return false;
          }
          return true;
        })
        .map(async (keyword) => {
          const latestRanking = await storage.getLatestRankingsByKeywordId(keyword.id, resultType);
          if (!latestRanking) return null;
          
          const location = keyword.locationId ? locationMap.get(keyword.locationId) : null;
          
          return {
            keywordId: keyword.id,
            keyword: keyword.keyword,
            targetUrl: keyword.targetUrl,
            group: keyword.group,
            groupId: keyword.groupId,
            locationId: keyword.locationId,
            locationName: location?.name || 'Unknown',
            locationCode: location?.code || null,
            position: latestRanking.position,
            positionChange: latestRanking.positionChange,
            url: latestRanking.url,
            lastChecked: latestRanking.date,
            resultType: latestRanking.resultType,
            title: latestRanking.title,
            domain: latestRanking.domain
          };
        })
      );

      // Filter out null results
      results = results.filter(Boolean);

      // Format date for filename
      const dateStr = new Date().toISOString().split('T')[0];
      
      if (format === 'json') {
        // Return JSON format
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=rankings-export-${dateStr}.json`);
        return res.json(results);
      } else if (format === 'csv') {
        // Return CSV format
        const csvContent = [
          // CSV Header
          ['Keyword', 'Location', 'Group', 'Position', 'Position Change', 'Target URL', 'Ranking URL', 'Domain', 'Title', 'Result Type', 'Last Checked'].join(','),
          // CSV Rows
          ...results.map(r => {
            if (!r) return '';
            const position = r.position === -1 ? 'Not ranked' : r.position;
            const date = r.lastChecked ? new Date(r.lastChecked).toISOString() : '';
            
            return [
              `"${r.keyword?.replace(/"/g, '""') || ''}"`,
              `"${r.locationName?.replace(/"/g, '""') || ''}"`,
              `"${r.group || ''}"`,
              position,
              r.positionChange || 0,
              `"${r.targetUrl || ''}"`,
              `"${r.url || ''}"`,
              `"${r.domain || ''}"`,
              `"${r.title?.replace(/"/g, '""') || ''}"`,
              `"${r.resultType || ''}"`,
              date
            ].join(',');
          })
        ].join('\n');
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=rankings-export-${dateStr}.csv`);
        return res.send(csvContent);
      } else if (format === 'excel') {
        // For Excel format, we'll return CSV with a different Content-Type
        // Most browsers will open this in Excel
        const csvContent = [
          // CSV Header
          ['Keyword', 'Location', 'Group', 'Position', 'Position Change', 'Target URL', 'Ranking URL', 'Domain', 'Title', 'Result Type', 'Last Checked'].join(','),
          // CSV Rows
          ...results.map(r => {
            if (!r) return '';
            const position = r.position === -1 ? 'Not ranked' : r.position;
            const date = r.lastChecked ? new Date(r.lastChecked).toISOString() : '';
            
            return [
              `"${r.keyword?.replace(/"/g, '""') || ''}"`,
              `"${r.locationName?.replace(/"/g, '""') || ''}"`,
              `"${r.group || ''}"`,
              position,
              r.positionChange || 0,
              `"${r.targetUrl || ''}"`,
              `"${r.url || ''}"`,
              `"${r.domain || ''}"`,
              `"${r.title?.replace(/"/g, '""') || ''}"`,
              `"${r.resultType || ''}"`,
              date
            ].join(',');
          })
        ].join('\n');
        
        res.setHeader('Content-Type', 'application/vnd.ms-excel');
        res.setHeader('Content-Disposition', `attachment; filename=rankings-export-${dateStr}.xls`);
        return res.send(csvContent);
      } else {
        return res.status(400).json({ message: "Unsupported export format" });
      }
    } catch (error) {
      console.error('Error exporting rankings:', error);
      res.status(500).json({ message: "Error exporting rankings data" });
    }
  });

  // Current rankings with keywords and locations
  // Note: Cache middleware must be applied directly in route definitions (see below)
  // The following routes have caching applied inline:
  app.get("/api/current-rankings", cacheMiddleware(60000), async (req: Request, res: Response) => {
    try {
      // Get result type from query parameter, default to 'organic'
      // If resultType is 'best', we'll get the best ranking regardless of type
      const resultType = (req.query.resultType as string) || 'organic';
      const useBestRanking = resultType === 'best';
      
      // Default target domain
      const TARGET_DOMAIN = 'tekrevol.com';
      
      // Get all keywords
      const keywords = await storage.getKeywords();

      // Get latest ranking for each keyword and include location data
      const result = await Promise.all(
        keywords.map(async (keyword) => {
          // Get all rankings for this keyword
          const allRankings = await storage.getRankingsByKeywordId(keyword.id);
          
          // Filter rankings to only include Tekrevol domains
          const tekRankings = allRankings.filter(r => {
            // If domain is present, check if it includes tekrevol.com
            if (r.domain) {
              return r.domain.toLowerCase().includes(TARGET_DOMAIN);
            }
            // If URL is present but domain is not, check URL
            if (r.url) {
              return r.url.toLowerCase().includes(TARGET_DOMAIN);
            }
            return false;
          });
          
          // Get the latest rankings by type, grouping them by resultType
          const rankingsByType: Record<string, typeof tekRankings> = {};
          tekRankings.forEach(ranking => {
            const resultType = ranking.resultType || 'organic';
            if (!rankingsByType[resultType]) {
              rankingsByType[resultType] = [];
            }
            rankingsByType[resultType].push(ranking);
          });
          
          // Sort each type by date to get latest
          Object.keys(rankingsByType).forEach(type => {
            rankingsByType[type].sort((a, b) => {
              const dateA = a.date ? new Date(a.date).getTime() : 0;
              const dateB = b.date ? new Date(b.date).getTime() : 0;
              return dateB - dateA;
            });
          });
          
          // Get the latest ranking for each type
          const latestByType: Record<string, typeof tekRankings[0] | undefined> = {};
          Object.keys(rankingsByType).forEach(type => {
            latestByType[type] = rankingsByType[type][0];
          });
          
          // Get the best ranking across all types or the requested type
          let bestRanking: typeof tekRankings[0] | undefined;
          
          if (useBestRanking) {
            // Find the best ranking across all result types
            let bestPosition = Number.MAX_SAFE_INTEGER;
            
            Object.values(latestByType).forEach(ranking => {
              if (ranking && typeof ranking.position === 'number' && ranking.position < bestPosition) {
                bestPosition = ranking.position;
                bestRanking = ranking;
              }
            });
          } else {
            // Use the requested type
            bestRanking = latestByType[resultType];
          }
          
          // Get location if set
          let location = null;
          if (keyword.locationId) {
            location = await storage.getLocation(keyword.locationId);
          }

          return {
            keyword: keyword.keyword,
            keywordId: keyword.id,
            targetUrl: keyword.targetUrl,
            group: keyword.group,
            locationName: location?.name || "Global",
            locationCode: location?.code || null,
            position: bestRanking?.position || "Not ranked",
            positionChange: bestRanking?.positionChange || null,
            url: bestRanking?.url || null,
            lastChecked: bestRanking?.date || null,
            resultType: bestRanking?.resultType || resultType,
            title: bestRanking?.title || null,
            domain: bestRanking?.domain || null
          };
        })
      );

      res.json(result);
    } catch (error) {
      console.error('Error fetching current rankings:', error);
      res.status(500).json({ message: "Error fetching current rankings" });
    }
  });

  app.get("/api/rankings/history", cacheMiddleware(120000), async (req: Request, res: Response) => {
    try {
      // Get result type from query parameter, default to 'organic'
      const resultType = (req.query.resultType as string) || 'organic';
      
      // Default target domain
      const TARGET_DOMAIN = 'tekrevol.com';
      
      // Get recent rankings for charting
      const keywords = await storage.getKeywords();
      const result = await Promise.all(
        keywords.map(async (keyword) => {
          // Get all rankings and filter by result type
          const allRankings = await storage.getRankingsByKeywordId(keyword.id);
          // First filter by result type
          const typeRankings = allRankings.filter(r => r.resultType === resultType);
          
          // Further filter to only include Tekrevol domains
          const rankings = typeRankings.filter(r => {
            // If domain is present, check if it includes tekrevol.com
            if (r.domain) {
              return r.domain.toLowerCase().includes(TARGET_DOMAIN);
            }
            // If URL is present but domain is not, check URL
            if (r.url) {
              return r.url.toLowerCase().includes(TARGET_DOMAIN);
            }
            return false;
          });
          
          // Sort rankings by date (ascending for charts)
          rankings.sort((a, b) => {
            const dateA = a.date ? new Date(a.date).getTime() : 0;
            const dateB = b.date ? new Date(b.date).getTime() : 0;
            return dateA - dateB;
          });
          
          return {
            keyword: keyword.keyword,
            keywordId: keyword.id,
            rankings: rankings.map(r => ({
              position: r.position,
              date: r.date,
              url: r.url,
              resultType: r.resultType,
              title: r.title,
              domain: r.domain
            }))
          };
        })
      );

      res.json(result);
    } catch (error) {
      console.error('Error fetching ranking history:', error);
      res.status(500).json({ message: "Error fetching ranking history" });
    }
  });

  // Locations (cached for 5 minutes)
  app.get("/api/locations", cacheMiddleware(300000), async (_req: Request, res: Response) => {
    try {
      const locations = await storage.getLocations();
      res.json(locations);
    } catch (error) {
      res.status(500).json({ message: "Error fetching locations" });
    }
  });

  app.post("/api/locations", async (req: Request, res: Response) => {
    // Invalidate cache when locations are created
    serverCache.delete('/api/locations');
    try {
      // Validate input
      const validatedData = insertLocationSchema.parse(req.body);

      // Create location
      const location = await storage.createLocation(validatedData);
      res.status(201).json(location);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid location data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Error creating location" });
      }
    }
  });

  app.put("/api/locations/:id", async (req: Request, res: Response) => {
    // Invalidate cache when locations are updated
    serverCache.delete('/api/locations');
    try {
      const id = parseInt(req.params.id);

      // Validate input (partial schema)
      const validatedData = insertLocationSchema.partial().parse(req.body);

      // Update location
      const location = await storage.updateLocation(id, validatedData);

      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }

      res.json(location);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid location data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Error updating location" });
      }
    }
  });

  app.delete("/api/locations/:id", async (req: Request, res: Response) => {
    // Invalidate cache when locations are deleted
    serverCache.delete('/api/locations');
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteLocation(id);

      if (!success) {
        return res.status(404).json({ message: "Location not found" });
      }

      res.json({ message: "Location deleted" });
    } catch (error) {
      res.status(500).json({ message: "Error deleting location" });
    }
  });

  // Scheduler
  app.get("/api/schedule", async (_req: Request, res: Response) => {
    try {
      const schedule = await storage.getActiveSchedule();
      res.json(schedule || { isActive: false });
    } catch (error) {
      res.status(500).json({ message: "Error fetching schedule" });
    }
  });

  app.post("/api/schedule", async (req: Request, res: Response) => {
    try {
      // Validate input
      const validatedData = insertScheduleSchema.parse(req.body);

      // Create schedule
      const schedule = await storage.createSchedule(validatedData);

      // Calculate next run time
      const nextRun = calculateNextRun(schedule.cronExpression);

      // Update schedule with next run time
      await storage.updateScheduleRunInfo(
        schedule.id,
        new Date(),
        nextRun
      );

      // Reinitialize scheduler
      await initializeScheduler();

      res.status(201).json(schedule);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid schedule data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Error creating schedule" });
      }
    }
  });

  app.put("/api/schedule/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);

      // Validate input (partial schema)
      const validatedData = insertScheduleSchema.partial().parse(req.body);

      // Update schedule
      const schedule = await storage.updateSchedule(id, validatedData);

      if (!schedule) {
        return res.status(404).json({ message: "Schedule not found" });
      }

      // If cron expression changed, calculate new next run time
      if (validatedData.cronExpression) {
        const nextRun = calculateNextRun(validatedData.cronExpression);
        await storage.updateScheduleRunInfo(
          id,
          schedule.lastRun || new Date(),
          nextRun
        );
      }

      // Reinitialize scheduler
      await initializeScheduler();

      res.json(schedule);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid schedule data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Error updating schedule" });
      }
    }
  });

  // Crawler
  app.post("/api/crawl", async (req: Request, res: Response) => {
    try {
      // Check if DataForSEO API credentials are configured
      if (!process.env.DATAFORSEO_API_LOGIN || !process.env.DATAFORSEO_API_PASSWORD) {
        return res.status(400).json({ 
          message: "DataForSEO API credentials are not configured",
          error: "API_CREDENTIALS_MISSING"
        });
      }

      const schema = z.object({
        keywordIds: z.array(z.number()).optional()
      });

      const { keywordIds } = schema.parse(req.body);

      // DataForSEO allows many requests, but we'll still add a reasonable limit
      // to ensure performance and avoid excessive API usage
      let limitedKeywordIds = keywordIds;
      if (keywordIds && keywordIds.length > 150) {
        console.log(`Limiting keyword crawl from ${keywordIds.length} to 150 keywords to manage API usage`);
        limitedKeywordIds = keywordIds.slice(0, 150);
      }

      // Create a batch first to return the batch ID
      let batch;
      try {
        batch = await storage.createKeywordBatch({ status: 'queued' });
      } catch (batchError) {
        console.error('Failed to create batch:', batchError);
        return res.status(500).json({ 
          message: "Failed to create crawl batch",
          error: batchError instanceof Error ? batchError.message : String(batchError)
        });
      }

      // Invalidate cache when crawl starts
      serverCache.delete('/api/crawl/status');
      serverCache.delete('/api/current-rankings');
      serverCache.delete('/api/rankings/history');
      serverCache.delete('/api/dashboard/stats');
      
      // Start crawling in the background, passing the existing batch ID
      crawlKeywords(limitedKeywordIds, batch.id)
        .then(result => {
          console.log('API Crawl completed:', result);
          // Invalidate cache again when crawl completes
          serverCache.delete('/api/crawl/status');
          serverCache.delete('/api/current-rankings');
          serverCache.delete('/api/rankings/history');
          serverCache.delete('/api/dashboard/stats');
          serverCache.delete('/api/competitors');
          // Invalidate competitor insights cache for all keywords that were crawled
          if (limitedKeywordIds && limitedKeywordIds.length > 0) {
            limitedKeywordIds.forEach(keywordId => {
              serverCache.delete(`/api/competitor-insights/by-keyword/${keywordId}`);
            });
          } else {
            // If all keywords were crawled, clear all insights caches
            // Note: This is a simple approach - in production you might want to track all keyword IDs
            serverCache.delete('/api/competitor-insights');
          }
          console.log('Cache invalidated after crawl completion');
        })
        .catch(error => {
          console.error('API Crawl failed:', error);

          // Update batch status on error
          if (batch) {
            storage.updateKeywordBatchStatus(batch.id, 'failed', new Date())
              .catch(err => console.error('Failed to update batch status:', err));
          }
        });

      res.json({ 
        message: "API Crawling started",
        keywords: keywordIds ? keywordIds.length : 'all tracked keywords',
        batchId: batch.id
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        console.error('Error starting API crawl:', error);
        res.status(500).json({ 
          message: error instanceof Error ? error.message : "Error starting API crawl" 
        });
      }
    }
  });

  app.get("/api/crawl/status", cacheMiddleware(5000), async (_req: Request, res: Response) => {
    try {
      const batch = await storage.getLatestKeywordBatch();

      if (!batch) {
        return res.json({ status: 'none', message: 'No crawl has been run yet' });
      }

      const items = await storage.getKeywordBatchItems(batch.id);

      const completed = items.filter(item => item.status === 'completed').length;
      const failed = items.filter(item => item.status === 'failed').length;
      const pending = items.filter(item => item.status === 'pending').length;
      const running = items.filter(item => item.status === 'running').length;

      // Check if batch has been running for too long (more than 10 minutes)
      if (batch.status === 'running' && batch.startTime) {
        const startTime = new Date(batch.startTime);
        const currentTime = new Date();
        const runningTimeMs = currentTime.getTime() - startTime.getTime();
        const runningTimeMinutes = runningTimeMs / (1000 * 60);

        // If running for more than 10 minutes and no progress made in the last 2 minutes
        if (runningTimeMinutes > 10) {
          // Since there's no updatedAt field, we'll need to use a different approach
          // Check if the number of completed or failed items has increased in the last 2 minutes
          // We can only detect if the batch is stuck by checking if the batch startTime is older than 10 minutes
          // and there's been no progress (all items still in the same state)
          const anyProgressMade = running > 0; // As long as something is running, we assume progress is being made

          if (!anyProgressMade) {
            console.log(`Batch ${batch.id} has been running for ${runningTimeMinutes.toFixed(1)} minutes with no recent progress. Marking as failed.`);
            await storage.updateKeywordBatchStatus(batch.id, 'failed', currentTime);

            // Update all running and pending items as failed
            for (const item of items.filter(i => i.status === 'running' || i.status === 'pending')) {
              await storage.updateKeywordBatchItemStatus(
                batch.id,
                item.keywordId,
                'failed',
                'Batch timed out due to API rate limits'
              );
            }

            return res.json({ 
              batchId: batch.id, 
              status: 'failed', 
              message: 'Batch timed out due to API rate limits',
              startTime: batch.startTime,
              endTime: currentTime,
              createdAt: batch.createdAt,
              stats: {
                total: items.length,
                completed,
                failed: failed + running + pending,
                pending: 0,
                running: 0
              }
            });
          }
        }
      }

      // Check if the batch is stuck - handle both pending items and stuck running items
      if (batch.status === 'running' && batch.startTime) {
        const startTime = new Date(batch.startTime);
        const currentTime = new Date();
        const runningTimeMs = currentTime.getTime() - startTime.getTime();
        const runningTimeMinutes = runningTimeMs / (1000 * 60);
        
        // Check if batch has been running for more than 15 minutes (increased from 10)
        // and there are stuck items (running items with no progress, or pending items)
        const isStuck = runningTimeMinutes > 15 && (running > 0 || pending > 0);
        
        // Also check if there's a running item that's been stuck for a long time
        // Use updatedAt if available, otherwise fall back to startTime
        let hasStuckRunningItem = false;
        if (running > 0) {
          const runningItems = items.filter(i => i.status === 'running');
          for (const item of runningItems) {
            // Prefer updatedAt for more accurate progress detection, fall back to startTime
            const lastUpdateTime = (item as any).updatedAt ? new Date((item as any).updatedAt) : (item.startTime ? new Date(item.startTime) : null);
            if (lastUpdateTime) {
              const itemStuckTime = currentTime.getTime() - lastUpdateTime.getTime();
              const itemStuckMinutes = itemStuckTime / (1000 * 60);
              // If a single item has been running for more than 5 minutes without update, it's likely stuck
              if (itemStuckMinutes > 5) {
                hasStuckRunningItem = true;
                break;
              }
            }
          }
        }

        if (isStuck || hasStuckRunningItem) {
          console.log(`Batch ${batch.id} appears stuck. Running for ${runningTimeMinutes.toFixed(1)} minutes. Marking stuck items as failed.`);

          // Mark all stuck running items as failed
          const runningItems = items.filter(i => i.status === 'running');
          for (const item of runningItems) {
            let shouldMarkFailed = false;
            if (item.startTime) {
              const itemStartTime = new Date(item.startTime);
              const itemRunningTime = currentTime.getTime() - itemStartTime.getTime();
              const itemRunningMinutes = itemRunningTime / (1000 * 60);
              // Mark as failed if running for more than 5 minutes
              if (itemRunningMinutes > 5) {
                shouldMarkFailed = true;
              }
            } else {
              // If no startTime, mark as failed if batch has been running for more than 15 minutes
              shouldMarkFailed = runningTimeMinutes > 15;
            }
            
            if (shouldMarkFailed) {
              await storage.updateKeywordBatchItemStatus(
                batch.id,
                item.keywordId,
                'failed',
                'Timed out - item was stuck in running state'
              );
            }
          }

          // Mark all pending items as failed
          for (const item of items.filter(i => i.status === 'pending')) {
            await storage.updateKeywordBatchItemStatus(
              batch.id,
              item.keywordId,
              'failed',
              'Timed out waiting to be processed'
            );
          }

          // Update batch status if all items are now completed or failed
          const updatedItems = await storage.getKeywordBatchItems(batch.id);
          const stillRunning = updatedItems.filter(i => i.status === 'running').length;
          const stillPending = updatedItems.filter(i => i.status === 'pending').length;
          
          if (stillRunning === 0 && stillPending === 0) {
            await storage.updateKeywordBatchStatus(batch.id, 'completed', new Date());
            return res.json({
              batchId: batch.id,
              status: 'completed',
              startTime: batch.startTime,
              endTime: new Date(),
              createdAt: batch.createdAt,
              message: 'Batch completed after clearing stuck items',
              stats: {
                total: updatedItems.length,
                completed: updatedItems.filter(i => i.status === 'completed').length,
                failed: updatedItems.filter(i => i.status === 'failed').length,
                pending: 0,
                running: 0
              }
            });
          }
        }
      }

      // Auto-complete batch if all items are done but batch is still marked as running
      // Only auto-complete if we have items and all are done
      if (batch.status === 'running' && items.length > 0 && running === 0 && pending === 0 && (completed + failed) === items.length) {
        console.log(`Auto-completing batch ${batch.id} - all ${items.length} items are done (${completed} completed, ${failed} failed)`);
        await storage.updateKeywordBatchStatus(batch.id, 'completed', new Date());
        return res.json({
          batchId: batch.id,
          status: 'completed',
          startTime: batch.startTime,
          endTime: new Date(),
          createdAt: batch.createdAt,
          message: 'Batch completed - all items processed',
          stats: {
            total: items.length,
            completed,
            failed,
            pending: 0,
            running: 0
          }
        });
      }
      
      // Don't auto-complete if batch has no items yet (crawler might still be starting)
      if (batch.status === 'running' && items.length === 0) {
        console.log(`Batch ${batch.id} is running but has no items yet - crawler may still be initializing`);
      }

      res.json({
        batchId: batch.id,
        status: batch.status,
        startTime: batch.startTime,
        endTime: batch.endTime,
        createdAt: batch.createdAt,
        stats: {
          total: items.length,
          completed,
          failed,
          pending,
          running
        }
      });
    } catch (error) {
      console.error('Error fetching crawl status:', error);
      res.status(500).json({ message: "Error fetching crawl status" });
    }
  });

  // Add a new endpoint to cancel and reset a stuck batch
  app.post("/api/crawl/reset", async (_req: Request, res: Response) => {
    // Invalidate cache when crawl is reset
    serverCache.delete('/api/crawl/status');
    serverCache.delete('/api/current-rankings');
    serverCache.delete('/api/rankings/history');
    serverCache.delete('/api/dashboard/stats');
    try {
      const batch = await storage.getLatestKeywordBatch();

      if (!batch) {
        return res.status(404).json({ message: 'No batch found to reset' });
      }

      // Only reset if the batch is in 'running' or 'queued' status
      if (batch.status !== 'running' && batch.status !== 'queued') {
        return res.status(400).json({ 
          message: `Batch is already in "${batch.status}" status. Only running or queued batches can be reset.` 
        });
      }

      // Calculate run time if available and provide detailed info
      let runTimeInfo = '';
      let stuckMessage = '';
      if (batch.startTime) {
        const startTime = new Date(batch.startTime);
        const currentTime = new Date();
        const runningTimeMs = currentTime.getTime() - startTime.getTime();
        const runningTimeMinutes = Math.floor(runningTimeMs / (1000 * 60));
        runTimeInfo = `Batch was running for ${runningTimeMinutes} minutes before reset.`;

        if (runningTimeMinutes > 5) {
          stuckMessage = 'Batch appears to have been stuck due to API rate limiting. Try processing fewer keywords and waiting longer between batch runs.';
        }
      }

      console.log(`Manually resetting batch ${batch.id}${runTimeInfo}`);

      // Get batch items to calculate statistics
      const items = await storage.getKeywordBatchItems(batch.id);
      const completed = items.filter(i => i.status === 'completed').length;
      const failed = items.filter(i => i.status === 'failed').length;
      const running = items.filter(i => i.status === 'running').length;
      const pending = items.filter(i => i.status === 'pending').length;

      // Check if all items are actually completed - if so, mark as completed instead of failed
      const allDone = (completed + failed) === items.length && running === 0 && pending === 0;
      
      if (allDone && failed === 0) {
        // All items completed successfully, just mark batch as completed
        await storage.updateKeywordBatchStatus(batch.id, 'completed', new Date());
        console.log(`Batch ${batch.id} marked as completed - all items were already done`);
      } else {
        // Mark the batch as failed
        await storage.updateKeywordBatchStatus(batch.id, 'failed', new Date());
      }

      // Mark all running and pending items as failed
      let pendingCount = 0;
      let runningCount = 0;

      // Update all running and pending items
      for (const item of items) {
        if (item.status === 'running' || item.status === 'pending') {
          const resetReason = stuckMessage || 
            (item.status === 'running' ? 'Manually reset while running' : 'Manually reset before processing');

          await storage.updateKeywordBatchItemStatus(
            batch.id,
            item.keywordId,
            'failed',
            resetReason
          );

          if (item.status === 'pending') pendingCount++;
          if (item.status === 'running') runningCount++;
        }
      }

      // Create detailed message with item statistics
      const total = items.length;
      const statusSummary = `Items: ${completed} completed, ${failed} failed, ${runningCount} interrupted, ${pendingCount} unprocessed`;

      return res.json({ 
        success: true, 
        message: `Batch ${batch.id} has been reset and marked as failed${runTimeInfo}. ${statusSummary}`,
        batchId: batch.id,
        statistics: {
          completed,
          failed,
          running: runningCount,
          pending: pendingCount,
          total
        }
      });
    } catch (error) {
      console.error('Error resetting crawl batch:', error);
      res.status(500).json({ message: "Error resetting crawl batch" });
    }
  });

  app.get("/api/crawl/results/:batchId", async (req: Request, res: Response) => {
    try {
      const batchId = parseInt(req.params.batchId);
      const batch = await storage.getKeywordBatch(batchId);

      if (!batch) {
        return res.status(404).json({ message: "Batch not found" });
      }

      const items = await storage.getKeywordBatchItems(batchId);

      // Get keywords for each item
      const results = await Promise.all(
        items.map(async (item) => {
          const keyword = await storage.getKeyword(item.keywordId);
          return {
            ...item,
            keyword
          };
        })
      );

      res.json({
        batch,
        results
      });
    } catch (error) {
      res.status(500).json({ message: "Error fetching crawl results" });
    }
  });

  // Dashboard Layouts (cached for 5 minutes)
  app.get("/api/dashboard/layouts", cacheMiddleware(300000), async (req: Request, res: Response) => {
    try {
      // Default user ID (1) for now - this would be the authenticated user's ID in a real app
      const userId = req.query.userId ? parseInt(req.query.userId as string) : 1;
      const layouts = await storage.getDashboardLayouts(userId);
      res.json(layouts);
    } catch (error) {
      console.error('Error fetching dashboard layouts:', error);
      res.status(500).json({ message: "Error fetching dashboard layouts" });
    }
  });

  app.get("/api/dashboard/layouts/active", cacheMiddleware(300000), async (req: Request, res: Response) => {
    try {
      // Default user ID (1) for now - this would be the authenticated user's ID in a real app
      const userId = req.query.userId ? parseInt(req.query.userId as string) : 1;
      const layout = await storage.getActiveDashboardLayout(userId);
      
      if (!layout) {
        // If no active layout exists, return a default one
        return res.json({
          id: 0,
          userId,
          name: "Default Layout",
          layouts: {}, // Empty layout config
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }
      
      res.json(layout);
    } catch (error) {
      console.error('Error fetching active dashboard layout:', error);
      res.status(500).json({ message: "Error fetching active dashboard layout" });
    }
  });

  app.post("/api/dashboard/layouts", async (req: Request, res: Response) => {
    try {
      // Validate input
      const layoutSchema = insertDashboardLayoutSchema.extend({
        userId: z.number().default(1), // Default user ID (1) for now
      });
      
      const validatedData = layoutSchema.parse(req.body);
      
      // Create layout
      const layout = await storage.createDashboardLayout(validatedData);
      res.status(201).json(layout);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid layout data", errors: error.errors });
      } else {
        console.error('Error creating dashboard layout:', error);
        res.status(500).json({ message: "Error creating dashboard layout" });
      }
    }
  });

  app.put("/api/dashboard/layouts/:id", async (req: Request, res: Response) => {
    // Invalidate cache when layouts are updated
    serverCache.delete('/api/dashboard/layouts');
    serverCache.delete('/api/dashboard/layouts/active');
    try {
      const id = parseInt(req.params.id);
      
      // Validate input (partial schema)
      const validatedData = insertDashboardLayoutSchema.partial().parse(req.body);
      
      // Update layout
      const layout = await storage.updateDashboardLayout(id, validatedData);
      
      if (!layout) {
        return res.status(404).json({ message: "Dashboard layout not found" });
      }
      
      res.json(layout);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid layout data", errors: error.errors });
      } else {
        console.error('Error updating dashboard layout:', error);
        res.status(500).json({ message: "Error updating dashboard layout" });
      }
    }
  });

  app.delete("/api/dashboard/layouts/:id", async (req: Request, res: Response) => {
    // Invalidate cache when layouts are deleted
    serverCache.delete('/api/dashboard/layouts');
    serverCache.delete('/api/dashboard/layouts/active');
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteDashboardLayout(id);
      
      if (!success) {
        return res.status(404).json({ message: "Dashboard layout not found" });
      }
      
      res.json({ message: "Dashboard layout deleted" });
    } catch (error) {
      console.error('Error deleting dashboard layout:', error);
      res.status(500).json({ message: "Error deleting dashboard layout" });
    }
  });

  // Competitors
  app.get("/api/competitors", async (req: Request, res: Response) => {
    try {
      const keywordId = req.query.keywordId ? parseInt(req.query.keywordId as string) : undefined;
      const domain = req.query.domain as string | undefined;
      // Increase default limit to 50 to show more competitors
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const unfiltered = req.query.unfiltered === 'true';
      const batchId = req.query.batchId ? parseInt(req.query.batchId as string) : undefined;
      
      console.log(`[API] /api/competitors called with keywordId=${keywordId}, limit=${limit}, batchId=${batchId}`);
      
      // If batchId is provided, return competitors from that specific batch
      if (batchId) {
        const batchCompetitors = await storage.getCompetitorsByBatchId(batchId);
        
        if (unfiltered) {
          // Skip filtering if unfiltered=true
          return res.json(batchCompetitors.slice(0, limit));
        }
        
        // Filter by keywordId if provided
        let filteredByKeyword = batchCompetitors;
        if (keywordId) {
          filteredByKeyword = batchCompetitors.filter(comp => comp.keywordId === keywordId);
        }
        
        // Filter blacklisted competitors
        const filteredCompetitors = [];
        for (const competitor of filteredByKeyword) {
          const isBlacklisted = await storage.isCompetitorBlacklisted(competitor.domain, competitor.keywordId);
          if (!isBlacklisted) {
            filteredCompetitors.push(competitor);
          }
        }
        
        // Apply the limit
        return res.json(filteredCompetitors.slice(0, limit));
      }
      
      if (keywordId) {
        // First try to use the dedicated competitor functionality
        // This uses data from the competitors table directly
        try {
          // Our storage function now handles deduplication and gets competitors
          // from multiple batches to ensure diversity
          const latestCompetitors = await storage.getLatestCompetitorsByKeywordId(keywordId, limit * 2); // Get more to account for filtering
          console.log(`[API] Found ${latestCompetitors.length} competitors from latest batch for keyword ${keywordId}`);
          
          if (latestCompetitors.length > 0) {
            if (unfiltered) {
              // Skip filtering if unfiltered=true
              return res.json(latestCompetitors.slice(0, limit));
            }
            
            // Filter out blacklisted competitors
            const filteredCompetitors = [];
            for (const competitor of latestCompetitors) {
              const isBlacklisted = await storage.isCompetitorBlacklisted(competitor.domain, keywordId);
              if (!isBlacklisted) {
                filteredCompetitors.push(competitor);
              }
            }
            
            // Apply the limit - no need to deduplicate again as storage function already did this
            const limitedCompetitors = filteredCompetitors.slice(0, limit);
            
            return res.json(limitedCompetitors);
          }
          
          // If no dedicated competitors found, fall back to getting all competitors
          const allHistoryCompetitors = await storage.getCompetitorsByKeywordId(keywordId);
          console.log(`[API] No competitors in latest batch, found ${allHistoryCompetitors.length} total competitors in history for keyword ${keywordId}`);
          
          if (allHistoryCompetitors.length > 0) {
            if (unfiltered) {
              // Skip filtering if unfiltered=true
              return res.json(allHistoryCompetitors.slice(0, limit));
            }
            
            // Filter out blacklisted competitors
            const filteredCompetitors = [];
            for (const competitor of allHistoryCompetitors) {
              const isBlacklisted = await storage.isCompetitorBlacklisted(competitor.domain, keywordId);
              if (!isBlacklisted) {
                filteredCompetitors.push(competitor);
              }
            }
            
            // Remove duplicate domains (keep only the first entry for each domain)
            const uniqueCompetitors = [];
            const seenDomains = new Set();
            
            for (const comp of filteredCompetitors) {
              if (!seenDomains.has(comp.domain)) {
                seenDomains.add(comp.domain);
                uniqueCompetitors.push(comp);
              }
            }
            
            // Sort by position and limit
            const sortedCompetitors = uniqueCompetitors
              .sort((a, b) => (a.position || 100) - (b.position || 100))
              .slice(0, limit);
              
            return res.json(sortedCompetitors);
          }
        } catch (error) {
          console.error(`Error fetching from competitors table: ${error}`);
        }
        
        // If we reach here, no competitors found in dedicated table
        // Fallback to searching the most recent crawl batch
        const keyword = await storage.getKeyword(keywordId);
        if (keyword) {
          try {
            // Start a new crawl just for this keyword to get fresh competitor data
            await crawlKeywords([keywordId]);
            
            // Now try again to get the competitors from the freshly updated data
            const freshCompetitors = await storage.getLatestCompetitorsByKeywordId(keywordId, limit * 2);
            
            if (freshCompetitors.length > 0) {
              if (unfiltered) {
                // Skip filtering if unfiltered=true
                return res.json(freshCompetitors.slice(0, limit));
              }
              
              // Filter out blacklisted competitors
              const filteredCompetitors = [];
              for (const competitor of freshCompetitors) {
                const isBlacklisted = await storage.isCompetitorBlacklisted(competitor.domain, keywordId);
                if (!isBlacklisted) {
                  filteredCompetitors.push(competitor);
                }
              }
              
              // Remove duplicate domains (keep only the first entry for each domain)
              const uniqueCompetitors = [];
              const seenDomains = new Set();
              
              for (const comp of filteredCompetitors) {
                if (!seenDomains.has(comp.domain)) {
                  seenDomains.add(comp.domain);
                  uniqueCompetitors.push(comp);
                }
              }
              
              // Apply the limit after filtering
              const limitedCompetitors = uniqueCompetitors.slice(0, limit);
              
              return res.json(limitedCompetitors);
            }
          } catch (crawlError) {
            console.error(`Error crawling for competitor data: ${crawlError}`);
          }
        }
      }
      
      if (domain) {
        // Get competitors by domain
        const domainCompetitors = await storage.getCompetitorsByDomain(domain);
        console.log(`Found ${domainCompetitors.length} competitors for domain ${domain}`);
        
        // Sort by position (lowest first)
        const sortedCompetitors = domainCompetitors
          .sort((a, b) => (a.position || 100) - (b.position || 100))
          .slice(0, limit);
        
        return res.json(sortedCompetitors);
      }
      
      // If no filter parameters provided, return top competitors from all keywords
      try {
        // Get the latest batch ID
        const latestBatch = await storage.getLatestKeywordBatch();
        if (!latestBatch) {
          return res.json([]);
        }
        
        // Get competitors from the latest batch
        const allCompetitors = await storage.getCompetitorsByBatchId(latestBatch.id);
        
        // Filter out blacklisted competitors
        const filteredCompetitors = [];
        for (const competitor of allCompetitors) {
          const isBlacklisted = await storage.isCompetitorBlacklisted(competitor.domain);
          if (!isBlacklisted) {
            filteredCompetitors.push(competitor);
          }
        }
        
        // Remove duplicate domains (keep only the first entry for each domain)
        const uniqueCompetitors = [];
        const seenDomains = new Set();
        
        for (const comp of filteredCompetitors) {
          if (!seenDomains.has(comp.domain)) {
            seenDomains.add(comp.domain);
            uniqueCompetitors.push(comp);
          }
        }
        
        // Sort by position and limit
        const sortedCompetitors = uniqueCompetitors
          .sort((a, b) => (a.position || 100) - (b.position || 100))
          .slice(0, limit * 2); // Return more competitors when no filter is specified
        
        return res.json(sortedCompetitors);
      } catch (error) {
        console.error('Error fetching all competitors:', error);
        res.json([]);
      }
    } catch (error) {
      console.error('Error fetching competitors:', error);
      res.status(500).json({ message: "Error fetching competitors" });
    }
  });

  // Get blacklisted competitors
  app.get("/api/blacklisted-competitors", async (req: Request, res: Response) => {
    try {
      const { keywordId } = req.query;
      
      let blacklist;
      if (keywordId) {
        const id = parseInt(keywordId as string);
        if (isNaN(id)) {
          return res.status(400).json({ message: "Invalid keywordId format" });
        }
        blacklist = await storage.getBlacklistedCompetitorsForKeyword(id);
      } else {
        blacklist = await storage.getBlacklistedCompetitors();
      }
      
      res.json(blacklist);
    } catch (error) {
      console.error("Error fetching blacklisted competitors:", error);
      res.status(500).json({ message: "Failed to fetch blacklisted competitors" });
    }
  });
  
  // Add a competitor to blacklist
  app.post("/api/blacklisted-competitors", async (req: Request, res: Response) => {
    // Invalidate cache when blacklist is updated
    serverCache.delete('/api/competitors');
    try {
      const { domain, keywordId, reason } = req.body;
      
      if (!domain) {
        return res.status(400).json({ message: "Missing domain parameter" });
      }
      
      const blacklistedCompetitor = await storage.createBlacklistedCompetitor({
        domain,
        keywordId: keywordId ? parseInt(keywordId) : null,
        reason: reason || null
      });
      
      res.status(201).json(blacklistedCompetitor);
    } catch (error) {
      console.error("Error creating blacklisted competitor:", error);
      res.status(500).json({ message: "Failed to blacklist competitor" });
    }
  });
  
  // Remove a competitor from blacklist
  app.delete("/api/blacklisted-competitors/:id", async (req: Request, res: Response) => {
    // Invalidate cache when blacklist is updated
    serverCache.delete('/api/competitors');
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID format" });
      }
      
      const success = await storage.deleteBlacklistedCompetitor(id);
      if (success) {
        res.status(204).end();
      } else {
        res.status(404).json({ message: "Blacklisted competitor not found" });
      }
    } catch (error) {
      console.error("Error deleting blacklisted competitor:", error);
      res.status(500).json({ message: "Failed to remove competitor from blacklist" });
    }
  });
  
  // Import and register the competitor insights routes
  registerCompetitorInsightsRoutes(app);

  return httpServer;
}