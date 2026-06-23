# Debug Checklist for SEO Rank Tracking Platform

## Critical Bugs Found & Fixed

### 1. ✅ **FIXED: Type Mismatch in `getLatestRankingsByKeywordId`**
**Location**: `server/storage.ts`
- **Issue**: Interface definition (line 56) didn't match implementation (line 310)
- **Interface**: `getLatestRankingsByKeywordId(keywordId: number): Promise<Ranking | undefined>`
- **Implementation**: `getLatestRankingsByKeywordId(keywordId: number, resultType: string = 'organic'): Promise<Ranking | undefined>`
- **Impact**: TypeScript wouldn't catch calls with wrong signature, runtime errors possible
- **Fix Applied**: Updated interface to match implementation signature (added optional `resultType` parameter)

### 2. ✅ **FIXED: Cache Middleware Applied After Route Handlers**
**Location**: `server/routes.ts` (lines 549-555)
- **Issue**: Cache middleware was registered AFTER route handlers were defined (dead code)
- **Impact**: Caching wasn't working for those endpoints
- **Fix Applied**: Moved cache middleware to be applied directly in route definitions:
  - `/api/dashboard/stats` - 1 minute cache
  - `/api/keywords` - 2 minute cache
  - `/api/locations` - 5 minute cache
  - `/api/keyword-groups` - 2 minute cache
  - `/api/dashboard/layouts` - 5 minute cache
  - `/api/dashboard/layouts/active` - 5 minute cache

### 3. ✅ **FIXED: Missing Error Handling in Batch Creation**
**Location**: `server/crawler.ts`
- **Issue**: If `createKeywordBatch` failed, error wasn't properly handled
- **Impact**: Unhandled exception could crash the crawler
- **Fix Applied**: Added proper error handling to mark batch as failed if processing fails

## Potential Issues to Investigate

### Database Performance
- [ ] Check if indexes exist on frequently queried columns:
  - `rankings.keywordId`
  - `rankings.date`
  - `rankings.resultType`
  - `competitors.keywordId`
  - `competitors.batchId`
  - `keywords.locationId`
  - `keywords.groupId`

### Position Calculation
- [ ] Test position calculation with edge cases:
  - [ ] SERP with only ads (no organic results)
  - [ ] SERP with only local pack (no organic results)
  - [ ] SERP with mixed ads, organic, and local pack
  - [ ] Target domain appears multiple times in results

### Batch Processing
- [ ] Test batch timeout detection:
  - [ ] Batch stuck with no progress
  - [ ] Batch with partial completion
  - [ ] Batch reset while running
- [ ] Verify batch item status updates are atomic

### Location Code Mapping
- [ ] Test location code lookup for:
  - [ ] San Francisco (special case: 1014221)
  - [ ] Locations with missing dataForSEOLocationCode
  - [ ] Locations not in CSV lookup
  - [ ] International locations

### Competitor Deduplication
- [ ] Test competitor retrieval:
  - [ ] Multiple batches with same competitors
  - [ ] Competitors from different result types
  - [ ] Blacklisted competitors filtering

### API Rate Limiting
- [ ] Verify rate limiting works correctly:
  - [ ] 5 second delay between requests
  - [ ] Batch size limit (70 keywords)
  - [ ] Retry logic with exponential backoff

## Testing Commands

```bash
# Test position calculation
npx tsx test-position-tracking.ts

# Test San Francisco location
npx tsx test-sf-crawler.js

# Test crawler fixes
npx tsx test-crawler-fix.js

# Check database summary
npx tsx database-summary.js

# Fix ranking positions
npx tsx fix-ranking-positions.js
```

## Debugging Tools

1. **Diagnostic Routes**: `/api/diagnostics/*` (see `server/diagnosticRoutes.ts`)
2. **Health Check**: `/api/health`
3. **Cache Stats**: Logged every 5 minutes in console
4. **Error Logging**: Console errors with stack traces

## Common Issues & Solutions

### Issue: Rankings showing incorrect positions
**Solution**: Run `fix-ranking-positions.js` to standardize position values

### Issue: Batch stuck in "running" status
**Solution**: Use `/api/crawl/reset` endpoint or check batch timeout logic

### Issue: Competitors not appearing
**Solution**: Check blacklist, verify batch completed successfully, check domain matching logic

### Issue: Location code errors
**Solution**: Verify `dataForSEOLocationCode` in database, check `locationCodesUtil.ts` mapping

### Issue: Cache not updating
**Solution**: Check cache TTL settings, verify middleware order, clear cache manually if needed

## Performance Monitoring

Monitor these metrics:
- Average API response time
- Database query performance
- Cache hit rate
- Batch processing time
- Error rate

## Next Steps

1. Fix type mismatch in `getLatestRankingsByKeywordId`
2. Fix cache middleware ordering
3. Add error handling to batch creation
4. Add database indexes for performance
5. Add comprehensive logging
6. Add unit tests for critical functions

