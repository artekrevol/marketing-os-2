/**
 * Test routes for OnPage API to see what data is available
 * This allows testing a single API call without wasting money on multiple calls
 */

import { Request, Response } from "express";
import fetch from "node-fetch";
import { createOnPageTask, isTaskCompleted, getOnPageTaskResult } from "./onPageAPI";
import { db } from "./db";
import { competitors } from "../shared/schema";
import { eq } from "drizzle-orm";

export function registerOnPageAPITestRoutes(app: any) {
  /**
   * Check status of an OnPage API task
   */
  app.get("/api/test/onpage", async (req: Request, res: Response) => {
    try {
      const taskId = req.query.taskId as string;

      if (!taskId) {
        return res.status(400).json({ message: "taskId query parameter is required" });
      }

      // Get detailed status from DataForSEO API
      const statusEndpoint = `https://api.dataforseo.com/v3/on_page/tasks_ready?id=${taskId}`;
      const apiLogin = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
      const apiPassword = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;
      const auth = Buffer.from(`${apiLogin}:${apiPassword}`).toString('base64');

      const statusResponse = await fetch(statusEndpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        }
      });

      if (!statusResponse.ok) {
        const errorText = await statusResponse.text();
        return res.status(500).json({
          message: "Failed to check task status",
          error: errorText
        });
      }

      const statusData = await statusResponse.json();
      
      // Log the response structure for debugging
      console.log(`[OnPage Test] Status response for task ${taskId}:`, JSON.stringify(statusData, null, 2));
      
      const task = statusData.tasks?.[0];
      const result = task?.result?.[0];
      const crawlStatus = result?.crawl_status;
      const crawlProgress = result?.crawl_progress || result?.status || "unknown";

      const isCompleted = await isTaskCompleted(taskId);

      if (!isCompleted) {
        // Provide detailed status information
        return res.json({
          success: false,
          taskId,
          status: "processing",
          message: "Task is still processing",
          details: {
            statusCode: task?.status_code,
            statusMessage: task?.status_message,
            crawlProgress: crawlProgress,
            crawlStatusCode: crawlStatus?.status_code,
            crawlStatusMessage: crawlStatus?.status_message,
            hasResult: !!result,
            resultKeys: result ? Object.keys(result) : [],
            estimatedTimeRemaining: "5-15 minutes typical (can take up to 15 minutes)"
          },
          rawStatusResponse: statusData,
          note: "This task is being processed by DataForSEO. Check back in a few minutes."
        });
      }

      // Task is completed, fetch results
      const endpoint = `https://api.dataforseo.com/v3/on_page/pages`;
      // Reuse apiLogin, apiPassword, and auth from above

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([{
          id: taskId,
          limit: 1
        }])
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(500).json({
          message: "Failed to fetch task results",
          error: errorText
        });
      }

      const apiData = await response.json();

      return res.json({
        success: true,
        taskId,
        rawApiResponse: apiData,
        processedData: apiData.tasks?.[0]?.result?.[0]?.items?.[0] || null,
        note: "This is the complete data structure returned by the OnPage API"
      });

    } catch (error) {
      console.error("[OnPage Test] Error:", error);
      return res.status(500).json({
        message: "Error checking OnPage API task",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * Test OnPage API with a single URL
   * This creates a task and returns the task ID for async processing
   */
  app.post("/api/test/onpage", async (req: Request, res: Response) => {
    try {
      const { url } = req.body;

      if (!url) {
        return res.status(400).json({ 
          message: "URL is required",
          example: { url: "https://example.com" }
        });
      }

      console.log(`[OnPage Test] Starting test for URL: ${url}`);

      // Create a new task
      const taskId = await createOnPageTask(url);

      if (!taskId) {
        return res.status(500).json({ 
          message: "Failed to create OnPage task",
          error: "Could not create task"
        });
      }

      console.log(`[OnPage Test] Task created: ${taskId}`);

      // Return immediately with task ID for async processing
      // Frontend will poll for results using GET /api/test/onpage?taskId=...
      return res.json({
        message: "Task created",
        taskId,
        url,
        status: "processing",
        estimatedTime: "5-15 minutes",
        note: "Task is processing. The page will automatically check for completion."
      });

    } catch (error) {
      console.error("[OnPage Test] Error:", error);
      res.status(500).json({
        message: "Error testing OnPage API",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * Test OnPage API with a competitor from database
   * Uses an existing competitor URL
   */
  app.post("/api/test/onpage/competitor/:competitorId", async (req: Request, res: Response) => {
    try {
      const competitorId = Number(req.params.competitorId);

      if (isNaN(competitorId)) {
        return res.status(400).json({ message: "Invalid competitor ID" });
      }

      const competitor = await db.select()
        .from(competitors)
        .where(eq(competitors.id, competitorId))
        .limit(1);

      if (!competitor || competitor.length === 0) {
        return res.status(404).json({ message: "Competitor not found" });
      }

      const url = competitor[0].url;

      // Use the same logic as main test endpoint
      // Create a new task
      const taskId = await createOnPageTask(url);

      if (!taskId) {
        return res.status(500).json({ 
          message: "Failed to create OnPage task",
          error: "Could not create task"
        });
      }

      // Return task ID for async processing
      res.json({
        message: "Task created",
        taskId,
        url,
        status: "processing",
        note: "Task is processing. Use the frontend to check status."
      });

    } catch (error) {
      console.error("[OnPage Test] Error:", error);
      res.status(500).json({
        message: "Error testing OnPage API",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

