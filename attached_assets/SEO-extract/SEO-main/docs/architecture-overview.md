# SEO Rank Tracking Platform - Architecture Overview

## Project Structure

```
SEO-main/
├── server/              # Backend Express.js application
│   ├── index.ts         # Express app setup, middleware, error handling
│   ├── routes.ts        # All REST API routes (1500+ lines)
│   ├── crawler.ts       # Batch crawling orchestration with rate limiting
│   ├── dataForSEO.ts    # DataForSEO API integration, position calculation
│   ├── storage.ts       # Database abstraction layer (1000+ lines)
│   ├── scheduler.ts     # Cron job management for automated crawls
│   ├── cache.ts         # In-memory caching for API responses
│   ├── competitorInsightsRoutes.ts  # Competitor analysis endpoints
│   ├── onPageAPI.ts     # OnPage API integration
│   ├── locationCodesUtil.ts  # Location code mapping utilities
│   ├── diagnosticRoutes.ts   # Diagnostic/testing endpoints
│   └── db.ts            # Database connection setup
├── client/              # Frontend React application
│   └── src/
│       ├── App.tsx      # Main app router, error boundaries
│       ├── pages/       # 11 page components
│       ├── components/
│       │   ├── dashboard/  # Dashboard widgets
│       │   └── ui/         # 50+ reusable UI components (Radix UI)
│       ├── hooks/       # Custom React hooks
│       └── lib/         # Utility functions
├── shared/              # Shared TypeScript types and schemas
│   └── schema.ts        # Drizzle ORM schema definitions
└── docs/                # Documentation
```

## Core Data Flows

### 1. Keyword Crawl Flow

```
User Action (Frontend)
  ↓
POST /api/crawl { keywordIds: [...] }
  ↓
routes.ts: Creates batch with status 'queued'
  ↓
crawler.ts: crawlKeywords()
  ├─ Updates batch status to 'running'
  ├─ Creates batch items for all keywords (bulk insert)
  ├─ For each keyword (parallel processing):
  │   ├─ processKeyword()
  │   │   ├─ Updates batch item status to 'running'
  │   │   ├─ Calls dataForSEO.searchWithDataForSEO()
  │   │   │   ├─ Fetches SERP data from DataForSEO API
  │   │   │   ├─ Calculates organic positions (filters ads/local pack)
  │   │   │   └─ Returns results + competitors
  │   │   ├─ Stores rankings in database
  │   │   ├─ Stores competitors in database
  │   │   └─ Updates batch item status to 'completed'/'failed'
  │   └─ Rate limiting delay between requests
  └─ Updates batch status to 'completed' when all items done
  ↓
Frontend polls GET /api/crawl/status
  ↓
Displays progress and results
```

### 2. Competitor Discovery Flow

```
During Keyword Crawl (dataForSEO.ts)
  ↓
SERP Results Processing
  ├─ Filters out target domain (tekrevol.com)
  ├─ Extracts competitor domains from organic results
  └─ Returns CompetitorResult[]
  ↓
crawler.ts: Stores competitors
  ├─ storage.createCompetitor() for each competitor
  └─ Links to keywordId and batchId
  ↓
GET /api/competitors?keywordId=X
  ├─ storage.getLatestCompetitorsByKeywordId()
  │   ├─ Gets competitors from latest batch
  │   ├─ Adds unique domains from previous batches
  │   └─ Deduplicates by domain
  ├─ Filters blacklisted competitors
  └─ Returns sorted by position
```

### 3. Competitor Analysis Flow (OnPage API)

```
Scheduled Task (scheduler.ts)
  ↓
crawlCompetitorInsights()
  ├─ Gets latest rankings
  ├─ For each keyword:
  │   ├─ Gets top 3 competitors
  │   └─ For each competitor:
  │       └─ getCompetitorInsights()
  │           ├─ onPageAPI.createOnPageTask()
  │           ├─ Polls for task completion
  │           ├─ Fetches task results
  │           └─ Stores in competitorInsights table
  └─ Runs 30 minutes after keyword crawl
```

### 4. Dashboard Data Flow

```
User Views Dashboard
  ↓
GET /api/dashboard/stats (cached)
  ├─ storage.getKeywords()
  ├─ storage.getLatestRankingsByKeywordId()
  ├─ Calculates average position, top 10 count
  └─ Returns aggregated stats
  ↓
GET /api/rankings/history?keywordId=X (cached)
  ├─ storage.getRankingsByKeywordId()
  └─ Returns time-series ranking data
  ↓
Frontend displays charts and tables
```

## Key Modules

### Backend Modules

#### `server/index.ts`
- Express app initialization
- Request logging middleware
- Error handling middleware
- Vite dev server integration (development)
- Server startup

#### `server/routes.ts` (1500+ lines)
- All REST API endpoints:
  - Keywords: CRUD operations, bulk import
  - Rankings: current rankings, history
  - Competitors: list, blacklist management
  - Locations: CRUD operations
  - Keyword Groups: hierarchical organization
  - Dashboard: stats, layouts
  - Crawler: start/stop/status
  - Schedules: cron-based automation
- Cache middleware application
- Input validation with Zod

#### `server/crawler.ts`
- Batch processing orchestration
- Rate limiting (configurable delay, parallel requests)
- Retry logic with exponential backoff
- Batch item status tracking
- Bulk insert for batch items (performance optimization)

#### `server/dataForSEO.ts`
- **Critical**: Position calculation logic
  - Filters ads from organic results
  - Handles local pack results separately
  - Maps rank_absolute to true organic position
  - Returns position -1 for "not ranked"
- DataForSEO API integration
- Location code handling
- Competitor extraction from SERP results

#### `server/storage.ts` (1000+ lines)
- Database abstraction layer
- Drizzle ORM operations
- Methods for all entities:
  - Keywords, Rankings, Competitors
  - Locations, Keyword Groups
  - Batches, Batch Items
  - Schedules, Dashboard Layouts
- Complex queries (latest competitors, deduplication)

#### `server/scheduler.ts`
- Cron expression parsing
- Scheduled keyword crawls
- Scheduled competitor analysis (30 min after crawl)
- Next run time calculation

#### `server/cache.ts`
- In-memory cache with TTL
- Cache middleware for Express
- Automatic expiration cleanup

#### `server/locationCodesUtil.ts`
- CSV-based location code mapping
- Special case for San Francisco (1014221)
- Fallback to US (2840) if not found

#### `server/onPageAPI.ts`
- OnPage API integration
- Task creation and polling
- Competitor insights extraction

### Frontend Modules

#### `client/src/App.tsx`
- Router setup (Wouter)
- Error boundaries
- Connection status indicator
- Global error handling

#### `client/src/pages/`
- Dashboard: Main dashboard with widgets
- ManageKeywords: Keyword CRUD interface
- CurrentRankings: Ranking table view
- CompetitorAnalysis: Competitor listing
- CompetitorInsights: OnPage analysis results
- ManageLocations: Location management
- KeywordGroups: Group hierarchy
- Schedule: Cron schedule configuration

#### `client/src/components/dashboard/`
- RunCrawlerButton: Start/stop crawler, progress display
- KeywordTable: Keyword listing with filters
- RankingChart: Time-series ranking visualization
- StatsCard: Dashboard statistics
- RankChangesTable: Position change tracking

## Database Schema

### Core Tables

- **users**: User authentication (currently single user)
- **locations**: Geographic targeting (name, code, dataForSEOLocationCode)
- **keywords**: Tracked keywords (keyword, targetUrl, locationId, groupId)
- **keywordGroups**: Hierarchical keyword organization
- **rankings**: Time-series ranking data (position, url, resultType, positionChange)
- **competitors**: Discovered competitor domains (domain, url, position, batchId)
- **blacklistedCompetitors**: Excluded domains (global or keyword-specific)
- **competitorInsights**: OnPage analysis data (meta tags, headings, keyword density)
- **keywordBatches**: Batch crawl tracking (status, startTime, endTime)
- **keywordBatchItems**: Individual keyword processing status (status: pending/running/completed/failed)
- **schedules**: Automated crawl schedules (cronExpression, isActive)
- **dashboardLayouts**: User-customizable dashboard configurations

## External APIs

### DataForSEO API
- **Endpoint**: `https://api.dataforseo.com/v3/serp/google/organic/live/advanced`
- **Auth**: Basic Auth (Base64 encoded login:password)
- **Rate Limits**: 1-2 requests/second (enforced in code)
- **Purpose**: Fetch SERP results for keyword ranking

### OnPage API
- **Endpoint**: `https://api.dataforseo.com/v3/on_page/task_post`
- **Auth**: Basic Auth
- **Purpose**: Analyze competitor websites (meta tags, headings, images)

## Environment Variables

```bash
DATABASE_URL=postgresql://...          # PostgreSQL connection string
DATAFORSEO_API_LOGIN=...              # DataForSEO username/email
DATAFORSEO_API_PASSWORD=...           # DataForSEO API password
CRAWLER_DELAY_MS=1000                 # Delay between API calls (ms)
PARALLEL_CRAWL_REQUESTS=1             # Parallel request count
NODE_ENV=development|production        # Environment mode
PORT=3000                              # Server port
```

## Critical Business Logic

### Position Calculation (dataForSEO.ts:217-244)
1. Sort all SERP items by `rank_absolute`
2. Filter out ads and local pack results
3. Map `rank_absolute` to sequential organic positions (1, 2, 3, ...)
4. Find target domain in organic results
5. Return position or -1 if not found

### Batch Processing (crawler.ts)
1. Create batch with status 'queued'
2. Bulk insert batch items (all keywords) with status 'pending'
3. Process keywords in parallel (configurable)
4. Update batch item status: pending → running → completed/failed
5. Mark batch as 'completed' when all items done

### Competitor Deduplication (storage.ts:799-890)
1. Get competitors from latest batch
2. Add unique domains from previous batches
3. Remove duplicates (keep first occurrence)
4. Filter blacklisted competitors
5. Sort by position

### Location Code Mapping (locationCodesUtil.ts)
1. Check database field `dataForSEOLocationCode` first
2. Special case: San Francisco → 1014221
3. Parse CSV file for location codes
4. Match by state/country or name
5. Fallback to US (2840) if not found

## Known Limitations

1. **No User Authentication**: Uses default user ID (1)
2. **Single Target Domain**: Hardcoded to 'tekrevol.com' in many places
3. **In-Memory Cache**: Lost on server restart
4. **No Queue System**: Synchronous competitor analysis (can timeout)
5. **No Webhook Support**: No external notifications for ranking changes

## Performance Optimizations

1. **Bulk Insert**: Batch items created in bulk (chunks of 100)
2. **Parallel Processing**: Configurable parallel API requests
3. **Caching**: In-memory cache for frequently accessed endpoints
4. **Rate Limiting**: Configurable delays to respect API limits

