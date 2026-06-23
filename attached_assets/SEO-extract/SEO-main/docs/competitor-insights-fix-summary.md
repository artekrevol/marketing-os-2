# Competitor Insights Loading Fix Summary

## Issues Identified

1. **Cache Not Being Invalidated**: After a crawl completes, the competitor insights cache was not being invalidated, causing the frontend to show stale data even after new insights were stored.

2. **Insufficient Logging**: There wasn't enough logging to debug why insights weren't loading or displaying correctly.

3. **Potential Data Mapping Issue**: Needed to verify that competitor IDs match between the API response and frontend display.

## Fixes Applied

### 1. Cache Invalidation (`server/routes.ts`)
- Added cache invalidation for competitor insights when a crawl completes
- Invalidates `/api/competitor-insights/by-keyword/${keywordId}` for each keyword that was crawled
- Also invalidates `/api/competitors` cache

### 2. Enhanced Logging (`server/competitorInsightsRoutes.ts`)
- Added detailed logging to the `/api/competitor-insights/by-keyword/:keywordId` endpoint:
  - Logs number of competitors found
  - Logs competitor IDs being queried
  - Logs number of insights retrieved
  - Logs details for first few insights (H1, H2, Density status)
  - Logs response time

### 3. Enhanced Frontend Logging (`client/src/pages/CompetitorAnalysis.tsx`)
- Added detailed logging in the frontend:
  - Logs when insights are being fetched
  - Logs response time
  - Logs number of insights received
  - Logs sample insight data (H1, H2, Density status)
  - Logs competitor-to-insight mapping for first few competitors

### 4. Enhanced Crawler Logging (`server/crawler.ts`)
- Added logging when insights are stored:
  - Logs H1, H2, and Keyword Density status for each stored insight
  - This helps verify that insights are actually being fetched and stored correctly

## Testing Steps

1. **Run a Crawl**:
   ```bash
   # The app should be running. Navigate to the Competitor Analysis page
   # Select a keyword and click "Refresh Data" or run a crawl from the dashboard
   ```

2. **Check Server Logs**:
   - Look for logs like:
     - `📊 Fetching insights for X top competitors...`
     - `✅ Stored insights for domain.com (X/10)`
     - `H1: ✅ (X), H2: ✅ (X), Density: ✅ (X)`
   - After crawl completes, look for:
     - `Cache invalidated after crawl completion`

3. **Check Frontend Console**:
   - Open browser DevTools (F12)
   - Go to Console tab
   - Select a keyword in the Competitor Analysis page
   - Look for logs like:
     - `[Frontend] Fetching insights for keyword X...`
     - `[Frontend] Received insights for X competitors (bulk query, Xms)`
     - `[Frontend] Sample insight: H1=true, H2=true, Density=true`
     - `[Frontend] Competitor X: hasInsight=true, hasH1=true, hasH2=true`

4. **Verify Data Display**:
   - After selecting a keyword, the table should show:
     - H1, H2, H3 columns populated (not just "—")
     - Keyword Density column showing percentages
   - If data is still not showing:
     - Check browser console for errors
     - Check server logs for API errors
     - Verify that insights were actually stored (check database or server logs)

## Expected Behavior

1. **During Crawl**:
   - Crawler fetches insights for top 10 competitors
   - Insights are stored in database with H1, H2, H3, and keyword density data
   - Cache is invalidated after crawl completes

2. **When Loading Competitor Analysis Page**:
   - Selecting a keyword triggers two parallel API calls:
     - `/api/competitors?keywordId=X` (fast, cached)
     - `/api/competitor-insights/by-keyword/X` (may take 1-2 seconds if not cached)
   - Insights are mapped to competitors by competitor ID
   - Table displays H1, H2, H3, and Keyword Density for each competitor

3. **Performance**:
   - First load after crawl: ~1-2 seconds (database query)
   - Subsequent loads: <100ms (cached)
   - Cache expires after 5 minutes

## Troubleshooting

If insights are still not showing:

1. **Check if insights were stored**:
   - Look at server logs during crawl for "✅ Stored insights" messages
   - Check database: `SELECT * FROM competitorInsights WHERE competitorId IN (SELECT id FROM competitors WHERE keywordId = X) LIMIT 10;`

2. **Check API response**:
   - Open browser DevTools → Network tab
   - Select a keyword
   - Find the request to `/api/competitor-insights/by-keyword/X`
   - Check the response - it should be a JSON object with competitor IDs as keys

3. **Check cache**:
   - The cache might be serving stale data
   - Try clearing browser cache or wait 5 minutes for cache to expire
   - Or manually invalidate cache by restarting the server

4. **Check competitor ID matching**:
   - In browser console, check:
     - `competitors` array - note the `id` values
     - `insightsData` object - note the keys (should match competitor IDs)
   - If IDs don't match, that's the issue

## Next Steps

If the issue persists after these fixes:

1. Run a test crawl and capture all logs
2. Check the database directly to verify insights are stored
3. Test the API endpoint directly: `curl http://localhost:3000/api/competitor-insights/by-keyword/1`
4. Verify that the OnPage API is configured correctly and returning data

