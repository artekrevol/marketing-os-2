/**
 * Diagnostic routes for exploring API data
 * These routes are for development purposes to inspect raw data
 */

import { Request, Response } from "express";
import { db } from './db';
import { competitors, competitorInsights, keywords } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { createOnPageTask, getCompetitorInsights } from "./onPageAPI";
import { storage } from "./storage";

export function registerDiagnosticRoutes(app: any) {
  /**
   * Get raw competitor data with all available fields
   */
  app.get("/api/diagnostic/competitor/:id", async (req: Request, res: Response) => {
    try {
      const competitorId = Number(req.params.id);
      
      if (isNaN(competitorId)) {
        return res.status(400).json({ message: "Invalid competitor ID" });
      }
      
      // Get raw competitor data
      const competitor = await db.select().from(competitors).where(eq(competitors.id, competitorId)).limit(1);
      
      if (!competitor || competitor.length === 0) {
        return res.status(404).json({ message: "Competitor not found" });
      }
      
      // Get related keyword
      const competitorKeywordId = competitor[0].keywordId;
      const keywordData = await db.select().from(keywords).where(eq(keywords.id, competitorKeywordId)).limit(1);
      
      // Get competitor insights
      const insightData = await db.select().from(competitorInsights)
        .where(eq(competitorInsights.competitorId, competitorId))
        .limit(1);
      
      // Return all raw data
      res.json({
        competitor: competitor[0],
        relatedKeyword: keywordData && keywordData.length > 0 ? keywordData[0] : null,
        insight: insightData && insightData.length > 0 ? insightData[0] : null,
      });
    } catch (error) {
      console.error("Error in diagnostic route:", error);
      res.status(500).json({ message: "Error fetching diagnostic data", error: String(error) });
    }
  });

  /**
   * Generate new competitor insights and return all raw data
   */
  app.post("/api/diagnostic/competitor/:id/analyze", async (req: Request, res: Response) => {
    try {
      const competitorId = Number(req.params.id);
      
      if (isNaN(competitorId)) {
        return res.status(400).json({ message: "Invalid competitor ID" });
      }
      
      // Delete existing insights to force a refresh
      const existingInsights = await storage.getCompetitorInsights(competitorId);
      if (existingInsights) {
        await storage.deleteCompetitorInsight(existingInsights.id);
      }
      
      // Generate new insights
      const insights = await getCompetitorInsights(competitorId);
      
      if (!insights) {
        return res.status(500).json({ message: "Failed to generate insights" });
      }
      
      // Return all raw data
      res.json({
        rawInsightData: insights,
        message: "New insights generated successfully"
      });
    } catch (error) {
      console.error("Error in diagnostic analyze route:", error);
      res.status(500).json({ message: "Error analyzing competitor", error: String(error) });
    }
  });
}