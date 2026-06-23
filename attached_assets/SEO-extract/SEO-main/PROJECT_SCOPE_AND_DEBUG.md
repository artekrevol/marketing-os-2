# SEO Rank Tracking Platform - Project Scope & Debug Analysis

## Project Overview

**Name**: SEO Rank Tracking and Competitor Analysis Platform  
**Purpose**: Track keyword rankings across multiple locations using DataForSEO API, analyze competitor performance, and provide SEO optimization insights.

**Tech Stack**:
- **Frontend**: React 18 + TypeScript, Radix UI, Tailwind CSS, TanStack Query, Wouter (routing)
- **Backend**: Node.js + Express, TypeScript, PostgreSQL (Neon serverless)
- **ORM**: Drizzle ORM
- **External APIs**: DataForSEO (SERP data), OnPage API (competitor analysis)
- **Scheduling**: node-cron for automated crawls

## Core Functionality

### 1. Keyword Management
- Track keywords with location targeting
- Hierarchical keyword groups (parent-child relationships)
- Bulk import/export capabilities
- Daily/weekly tracking schedules

### 2. Ranking Tracking
- Real-time SERP position tracking via DataForSEO API
- Position change detection (compares with previous rankings)
- Multiple result types: organic, local_pack, other_organic
- Historical ranking data with time-series charts
- Target domain filtering (default: tekrevol.com)

### 3. Competitor Analysis
- Automatic competitor discovery from SERP results
- Competitor blacklisting (global or keyword-specific)
- OnPage API integration for competitor website analysis
- Competitor insights: meta tags, headings, keyword density, images

### 4. Location Management
- Geographic targeting with DataForSEO location code mapping
- Special handling for San Francisco (code: 1014221)
- Location-specific proxy support (for future use)

### 5. Dashboard & Reporting
- Customizable dashboard layouts (React Grid Layout)
- Real-time statistics (average position, top 10 count)
- Ranking history charts
- Export functionality (CSV, JSON, Excel)

### 6. Batch Processing
- Keyword crawl batches with progress tracking
- Rate limiting (5 second delays, max 70 keywords per batch)
- Retry logic (max 2 retries with exponential backoff)
- Batch status monitoring and timeout detection

## Database Schema

### Core Tables
- `users` - User authentication
- `locations` - Geographic targeting data
- `keywords` - Tracked keywords with location/group associations
- `keywordGroups` - Hierarchical keyword organization
- `rankings` - Time-series ranking data with position change tracking
- `competitors` - Discovered competitor domains from SERP
- `blacklistedCompetitors` - Excluded competitor domains
- `competitorInsights` - OnPage analysis data for competitors
- `keywordBatches` - Batch crawl tracking
- `keywordBatchItems` - Individual keyword processing status
- `schedules` - Automated crawl schedules (cron expressions)
- `dashboardLayouts` - User-customizable dashboard configurations

## Key Components

### Server Architecture

**`server/index.ts`**: Express app setup, error handling, request logging  
**`server/routes.ts`**: All API endpoints (1500+ lines)  
**`server/crawler.ts`**: Keyword crawling orchestration with rate limiting  
**`server/dataForSEO.ts`**: DataForSEO API integration, position calculation logic  
**`server/storage.ts`**: Database abstraction layer (1000+ lines)  
**`server/scheduler.ts`**: Cron job management for automated crawls  
**`server/cache.ts`**: In-memory caching for API responses  
**`server/competitorInsightsRoutes.ts`**: Competitor analysis endpoints  
**`server/onPageAPI.ts`**: OnPage API integration for competitor website analysis  
**`server/locationCodesUtil.ts`**: Location code mapping utilities

### Frontend Architecture

**`client/src/App.tsx`**: Main app router, error boundaries, connection status  
**`client/src/pages/`**: 11 page components (Dashboard, ManageKeywords, CompetitorAnalysis, etc.)  
**`client/src/components/dashboard/`**: Dashboard widgets and components  
**`client/src/components/ui/`**: 50+ reusable UI components (Radix UI + Tailwind)

## Critical Business Logic

### Position Calculation (`server/dataForSEO.ts`)
- **Organic Position**: Filters out ads and local pack results, maintains sequential numbering
- **Local Pack Position**: Handles Google Maps/local pack results (positions 1-3)
- **Position Change**: Calculated by comparing with previous ranking entry
- **Not Ranked**: Standardized as position -1

### Rate Limiting (`server/crawler.ts`)
- 5 second delay between API calls
- Maximum 70 keywords per batch
- Exponential backoff on retries (2 max retries)
- Batch timeout detection (10 minutes)

### Competitor Filtering (`server/routes.ts`)
- Blacklist filtering (global and keyword-specific)
- Domain deduplication
- Position-based sorting

## Identified Issues & Potential Bugs

### 1. **Position Calculation Edge Cases** ⚠️
**Location**: `server/dataForSEO.ts` (lines 217-244)
- Complex organic position mapping logic that may fail if DataForSEO response structure changes
- Fallback to `rank_absolute` if position mapping fails, but this may include ads
- **Risk**: Incorrect position reporting if API response format changes

### 2. **Batch Timeout Logic** ⚠️
**Location**: `server/routes.ts` (lines 940-1027)
- Timeout detection relies on batch startTime and item status
- No `updatedAt` field on batch items, making progress detection difficult
- **Risk**: Batches may be incorrectly marked as stuck or failed

### 3. **Cache Middleware Ordering** ⚠️
**Location**: `server/routes.ts` (lines 549-555)
- Cache middleware is registered AFTER route handlers in some cases
- **Risk**: Caching may not work correctly for some endpoints

### 4. **Error Handling in Crawler** ⚠️
**Location**: `server/crawler.ts` (lines 175-190)
- Errors are caught but batch status may not always update correctly
- If batch creation fails, no error is returned to API caller
- **Risk**: Silent failures in batch processing

### 5. **Database Transaction Safety** ⚠️
**Location**: `server/storage.ts` (lines 203-233)
- `deleteAllKeywords()` uses transactions but other bulk operations don't
- **Risk**: Partial failures in bulk operations could leave inconsistent state

### 6. **Location Code Mapping** ⚠️
**Location**: `server/locationCodesUtil.ts` and `server/dataForSEO.ts`
- Special case for San Francisco (hardcoded code: 1014221)
- Other locations rely on CSV lookup or database field
- **Risk**: Missing location codes could default to wrong location

### 7. **Competitor Deduplication** ⚠️
**Location**: `server/storage.ts` (lines 771-875)
- Complex deduplication logic across multiple batches
- May return stale data if latest batch has no competitors
- **Risk**: Inconsistent competitor lists

### 8. **Scheduler Cron Expression Parsing** ⚠️
**Location**: `server/scheduler.ts` (lines 15-36)
- Simple parsing that may not handle all cron expression formats
- Competitor analysis cron is derived by adding 30 minutes, which may fail for edge cases
- **Risk**: Scheduled tasks may not run at expected times

### 9. **API Credential Handling** ⚠️
**Location**: `server/dataForSEO.ts` (lines 60-66)
- Checks for both `DATAFORSEO_API_LOGIN` and `DATAFORSEO_LOGIN`
- Similar for password
- **Risk**: Inconsistent environment variable names could cause confusion

### 10. **Frontend Error Boundary** ⚠️
**Location**: `client/src/App.tsx` (lines 116-120)
- Error boundary catches React errors but may not handle async errors
- Connection status relies on console.log interception (hacky)
- **Risk**: Some errors may not be caught properly

## Areas Requiring Debugging

### High Priority
1. **Position Calculation Accuracy**: Verify organic position calculation excludes ads correctly
2. **Batch Processing Reliability**: Test timeout detection and stuck batch recovery
3. **Competitor Data Consistency**: Verify deduplication logic works across multiple batches
4. **Location Code Mapping**: Test edge cases for location code lookup

### Medium Priority
1. **Cache Invalidation**: Ensure cache is cleared when data is updated
2. **Error Recovery**: Test error handling in crawler retry logic
3. **Scheduler Reliability**: Verify cron expressions are parsed correctly
4. **Database Transactions**: Audit all bulk operations for transaction safety

### Low Priority
1. **Frontend Error Handling**: Improve error boundary coverage
2. **API Response Validation**: Add schema validation for DataForSEO responses
3. **Logging**: Improve structured logging for debugging

## Environment Variables Required

```bash
DATABASE_URL=postgresql://...          # PostgreSQL connection string
DATAFORSEO_API_LOGIN=...                # DataForSEO username/email
DATAFORSEO_API_PASSWORD=...            # DataForSEO API password
NODE_ENV=development|production         # Environment mode
```

## API Rate Limits

- **DataForSEO**: 5 second delay between requests (enforced in code)
- **Batch Size**: Maximum 70 keywords per batch
- **Retries**: Maximum 2 retries with exponential backoff

## Known Limitations

1. **No User Authentication**: Currently uses default user ID (1) for dashboard layouts
2. **No Queue System**: Competitor analysis runs synchronously (could timeout)
3. **In-Memory Cache**: Cache is lost on server restart
4. **Single Target Domain**: Hardcoded to filter for 'tekrevol.com' in many places
5. **No Webhook Support**: No way to notify external systems of ranking changes

## Testing Files

Multiple test files exist for debugging specific issues:
- `test-*.js` files for location codes, position fixes, crawler testing
- `fix-*.js` files for data migration and fixes
- Diagnostic routes in `server/diagnosticRoutes.ts`

## Deployment

- **Development**: `npm run dev` (uses Vite dev server)
- **Production**: `npm run build && npm start` (uses esbuild + Node)
- **Replit**: Configured for Replit deployment

## Next Steps for Debugging

1. **Add Comprehensive Logging**: Implement structured logging with correlation IDs
2. **Add Monitoring**: Set up error tracking (e.g., Sentry) and performance monitoring
3. **Add Tests**: Unit tests for position calculation, batch processing, location mapping
4. **Improve Error Messages**: More descriptive error messages for debugging
5. **Add Health Checks**: More detailed health check endpoint with component status
6. **Database Indexing**: Review and optimize database indexes for query performance

