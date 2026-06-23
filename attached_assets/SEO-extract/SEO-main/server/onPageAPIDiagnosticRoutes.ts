/**
 * Diagnostic routes for OnPage API task status
 * Helps debug task processing issues
 */

import { Request, Response } from "express";
import fetch from "node-fetch";
import { isTaskCompleted } from "./onPageAPI";

export function registerOnPageAPIDiagnosticRoutes(app: any) {
  /**
   * Get detailed status of an OnPage API task
   * Returns the raw API response for debugging
   */
  app.get("/api/test/onpage/status/:taskId", async (req: Request, res: Response) => {
    try {
      const taskId = req.params.taskId;

      if (!taskId) {
        return res.status(400).json({ message: "taskId is required" });
      }

      const endpoint = `https://api.dataforseo.com/v3/on_page/tasks_ready?id=${taskId}`;
      const apiLogin = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
      const apiPassword = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;

      if (!apiLogin || !apiPassword) {
        return res.status(500).json({ 
          message: "API credentials not configured" 
        });
      }

      const auth = Buffer.from(`${apiLogin}:${apiPassword}`).toString('base64');

      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({
          message: "Failed to check task status",
          error: errorText,
          httpStatus: response.status
        });
      }

      const apiData = await response.json();
      const isCompleted = await isTaskCompleted(taskId);

      // Extract useful information
      const task = apiData.tasks?.[0];
      const result = task?.result?.[0];
      const crawlStatus = result?.crawl_status;
      const crawlProgress = result?.crawl_progress;

      return res.json({
        taskId,
        isCompleted,
        rawResponse: apiData,
        summary: {
          statusCode: task?.status_code,
          statusMessage: task?.status_message,
          crawlProgress: crawlProgress || "unknown",
          crawlStatusCode: crawlStatus?.status_code,
          crawlStatusMessage: crawlStatus?.status_message,
          hasResult: !!result,
          resultCount: result ? Object.keys(result).length : 0
        },
        interpretation: {
          isProcessing: !isCompleted && (crawlProgress !== "100%" || crawlStatus?.status_code !== 20000),
          isCompleted: isCompleted,
          isStuck: !isCompleted && crawlProgress === "100%" && crawlStatus?.status_code === 20000,
          estimatedTimeRemaining: isCompleted ? "0" : "5-15 minutes typical"
        }
      });

    } catch (error) {
      console.error("[OnPage Diagnostic] Error:", error);
      return res.status(500).json({
        message: "Error checking task status",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

