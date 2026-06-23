/**
 * Test routes for Keyword Research API to see what data is available
 * This allows testing a single API call without wasting money on multiple calls
 * 
 * DataForSEO Keyword Research API (Labs API) endpoints:
 * - Keywords For Site: Get keywords for a domain
 * - Keyword Suggestions: Get keyword ideas based on seed keyword
 * - Related Keywords: Find semantically related keywords
 * - Keyword Ideas: Get non-obvious relevant keywords
 * - Bulk Keyword Difficulty: Assess ranking difficulty
 */

import { Request, Response } from "express";
import fetch from "node-fetch";

export function registerKeywordResearchAPITestRoutes(app: any) {
  /**
   * Get keyword suggestions based on a seed keyword
   */
  app.post("/api/test/keyword-research/suggestions", async (req: Request, res: Response) => {
    try {
      const { keyword, locationCode, languageCode } = req.body;

      if (!keyword) {
        return res.status(400).json({ 
          message: "keyword is required",
          example: { keyword: "seo tools", locationCode: 2840, languageCode: "en" }
        });
      }

      console.log(`[Keyword Research Test] Getting suggestions for: ${keyword}`);

      // DataForSEO Labs API endpoint
      // Note: If you get 404, your account might not have Labs API access
      const endpoint = `https://api.dataforseo.com/v3/dataforseo_labs/google/keywords_for_keywords/live`;
      const apiLogin = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
      const apiPassword = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;

      if (!apiLogin || !apiPassword) {
        return res.status(500).json({ 
          message: "API credentials not configured" 
        });
      }

      const auth = Buffer.from(`${apiLogin}:${apiPassword}`).toString('base64');

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([{
          keyword: keyword,
          location_code: locationCode || 2840, // United States default
          language_code: languageCode || "en",
          limit: 10,
          offset: 0,
          sort_by: "relevance",
          include_serp_info: true,
          include_subdomains: false
        }])
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Keyword Research Test] API error (${response.status}): ${errorText}`);
        
        // Parse error response if possible
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { raw: errorText };
        }
        
        return res.status(response.status).json({
          message: "Failed to fetch keyword suggestions",
          error: errorData,
          httpStatus: response.status,
          note: response.status === 404 
            ? "This endpoint might not be available with your DataForSEO subscription. Labs API may require a different plan."
            : "Check your API credentials and subscription tier."
        });
      }

      const apiData = await response.json();
      console.log(`[Keyword Research Test] Received response for keyword: ${keyword}`);

      return res.json({
        success: true,
        keyword,
        rawApiResponse: apiData,
        processedData: apiData.tasks?.[0]?.result?.[0] || null,
        note: "This is the complete data structure returned by the Keyword Research API"
      });

    } catch (error) {
      console.error("[Keyword Research Test] Error:", error);
      return res.status(500).json({
        message: "Error fetching keyword suggestions",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * Get keywords for a specific site/domain
   */
  app.post("/api/test/keyword-research/site-keywords", async (req: Request, res: Response) => {
    try {
      const { target, locationCode, languageCode } = req.body;

      if (!target) {
        return res.status(400).json({ 
          message: "target (domain) is required",
          example: { target: "tekrevol.com", locationCode: 2840, languageCode: "en" }
        });
      }

      console.log(`[Keyword Research Test] Getting keywords for site: ${target}`);

      const endpoint = `https://api.dataforseo.com/v3/dataforseo_labs/google/keywords_for_site/live`;
      const apiLogin = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
      const apiPassword = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;

      if (!apiLogin || !apiPassword) {
        return res.status(500).json({ 
          message: "API credentials not configured" 
        });
      }

      const auth = Buffer.from(`${apiLogin}:${apiPassword}`).toString('base64');

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([{
          target: target,
          location_code: locationCode || 2840,
          language_code: languageCode || "en",
          limit: 10,
          offset: 0,
          filters: [],
          order_by: ["relevance", "desc"]
        }])
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Keyword Research Test] API error: ${errorText}`);
        return res.status(response.status).json({
          message: "Failed to fetch site keywords",
          error: errorText,
          httpStatus: response.status
        });
      }

      const apiData = await response.json();
      console.log(`[Keyword Research Test] Received response for site: ${target}`);

      return res.json({
        success: true,
        target,
        rawApiResponse: apiData,
        processedData: apiData.tasks?.[0]?.result?.[0] || null,
        note: "This is the complete data structure returned by the Keyword Research API"
      });

    } catch (error) {
      console.error("[Keyword Research Test] Error:", error);
      return res.status(500).json({
        message: "Error fetching site keywords",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * Get related keywords
   */
  app.post("/api/test/keyword-research/related", async (req: Request, res: Response) => {
    try {
      const { keyword, locationCode, languageCode } = req.body;

      if (!keyword) {
        return res.status(400).json({ 
          message: "keyword is required",
          example: { keyword: "seo tools", locationCode: 2840, languageCode: "en" }
        });
      }

      console.log(`[Keyword Research Test] Getting related keywords for: ${keyword}`);

      const endpoint = `https://api.dataforseo.com/v3/dataforseo_labs/google/related_keywords/live`;
      const apiLogin = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
      const apiPassword = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;

      if (!apiLogin || !apiPassword) {
        return res.status(500).json({ 
          message: "API credentials not configured" 
        });
      }

      const auth = Buffer.from(`${apiLogin}:${apiPassword}`).toString('base64');

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([{
          keyword: keyword,
          location_code: locationCode || 2840,
          language_code: languageCode || "en",
          limit: 10,
          offset: 0,
          include_serp_info: true
        }])
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Keyword Research Test] API error: ${errorText}`);
        return res.status(response.status).json({
          message: "Failed to fetch related keywords",
          error: errorText,
          httpStatus: response.status
        });
      }

      const apiData = await response.json();
      console.log(`[Keyword Research Test] Received response for keyword: ${keyword}`);

      return res.json({
        success: true,
        keyword,
        rawApiResponse: apiData,
        processedData: apiData.tasks?.[0]?.result?.[0] || null,
        note: "This is the complete data structure returned by the Keyword Research API"
      });

    } catch (error) {
      console.error("[Keyword Research Test] Error:", error);
      return res.status(500).json({
        message: "Error fetching related keywords",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * Get keyword difficulty
   */
  app.post("/api/test/keyword-research/difficulty", async (req: Request, res: Response) => {
    try {
      const { keywords, locationCode, languageCode } = req.body;

      if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
        return res.status(400).json({ 
          message: "keywords array is required",
          example: { keywords: ["seo tools", "keyword research"], locationCode: 2840, languageCode: "en" }
        });
      }

      console.log(`[Keyword Research Test] Getting difficulty for keywords: ${keywords.join(", ")}`);

      const endpoint = `https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_difficulty/live`;
      const apiLogin = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
      const apiPassword = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;

      if (!apiLogin || !apiPassword) {
        return res.status(500).json({ 
          message: "API credentials not configured" 
        });
      }

      const auth = Buffer.from(`${apiLogin}:${apiPassword}`).toString('base64');

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([{
          keywords: keywords,
          location_code: locationCode || 2840,
          language_code: languageCode || "en"
        }])
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Keyword Research Test] API error: ${errorText}`);
        return res.status(response.status).json({
          message: "Failed to fetch keyword difficulty",
          error: errorText,
          httpStatus: response.status
        });
      }

      const apiData = await response.json();
      console.log(`[Keyword Research Test] Received difficulty response`);

      return res.json({
        success: true,
        keywords,
        rawApiResponse: apiData,
        processedData: apiData.tasks?.[0]?.result?.[0] || null,
        note: "This is the complete data structure returned by the Keyword Research API"
      });

    } catch (error) {
      console.error("[Keyword Research Test] Error:", error);
      return res.status(500).json({
        message: "Error fetching keyword difficulty",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

