# OnPage API Data Assessment

## Date: 2025-11-28

## Assessment Results

### ✅ API DOES Provide H Tags and Density Data

Based on code analysis of `server/onPageAPI.ts`, the OnPage API response structure includes:

1. **H Tags** (as string arrays):
   - `page_content.h1: string[]`
   - `page_content.h2: string[]`
   - `page_content.h3: string[]`
   - `page_content.h4: string[]`
   - `page_content.h5: string[]`
   - `page_content.h6: string[]`

2. **Keyword Density** (as object):
   - `page_content.content.density: { [keyword: string]: { count: number, density: number } }`

3. **Other Data**:
   - Meta tags (title, description, canonical, etc.)
   - Images array
   - Robots.txt

### Issue Identified

**Problem**: Tasks are timing out before completion.

**Root Cause**: 
- Current timeout: 5 minutes (30 attempts × 10 seconds)
- OnPage API tasks can take 5-15 minutes depending on:
  - Site complexity
  - JavaScript rendering requirements
  - Page size
  - Server response time

**Evidence**:
- Insight stored with `description: "Analysis in progress..."`
- Empty arrays for H tags and density
- Task ID stored but task not completed

### Solution Implemented

1. **Increased Timeout**:
   - Changed from 5 minutes to 15 minutes
   - Changed check interval from 10 seconds to 15 seconds
   - Max attempts: 60 (60 × 15 seconds = 15 minutes)

2. **Enhanced Logging**:
   - Added detailed logging when fetching task results
   - Logs H tag counts and density data counts
   - Logs sample data (first H1, top keyword)
   - Better error messages with response structure

3. **Better Error Handling**:
   - Added null-safe operators (`?.`) to prevent crashes
   - More detailed error messages
   - Logs response structure when validation fails

### Next Steps

1. **Background Task Checker** (Recommended):
   - Create a periodic job that checks for incomplete tasks
   - Updates insights when tasks complete
   - Runs every 5-10 minutes

2. **Monitor First Crawl**:
   - Run a new crawl and monitor logs
   - Verify tasks complete within 15 minutes
   - Check if H tags and density are populated

3. **If Still Timing Out**:
   - Consider making insight fetching fully asynchronous
   - Don't wait during crawl; check later
   - Implement background task checker

## Code Changes

### `server/onPageAPI.ts`

1. **Increased timeout** (lines ~503-520):
   - `maxAttempts`: 30 → 60
   - `checkInterval`: 10000ms → 15000ms
   - Total timeout: 5 minutes → 15 minutes

2. **Enhanced logging** (lines ~250-280):
   - Logs API response structure
   - Logs H tag counts
   - Logs density data counts
   - Logs sample data

3. **Better error handling** (lines ~265-300):
   - Added null-safe operators
   - More detailed validation errors
   - Logs insight data being stored

## Testing

To verify the fix works:

1. Run a new crawl for a few keywords
2. Monitor server logs for:
   - `✅ Task {taskId} completed successfully`
   - `[OnPage API] Insight data prepared: H1 tags: X, Keyword density entries: Y`
3. Check the database/API to verify insights have H tags and density data

## Expected Behavior

- **First 5 minutes**: Tasks are still processing
- **5-15 minutes**: Tasks should complete
- **After completion**: Insights should have:
  - H1, H2, H3 arrays populated
  - Keyword density array with data
  - Full meta information

