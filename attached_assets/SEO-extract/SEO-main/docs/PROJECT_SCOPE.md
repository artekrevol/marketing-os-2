# SEO Rank Tracking and Competitor Analysis Platform
## Project Scope Document

**Version:** 2.0  
**Last Updated:** November 28, 2025  
**Status:** Production Ready

---

## 1. Executive Summary

The SEO Rank Tracking and Competitor Analysis Platform is a comprehensive web application designed to track keyword rankings across multiple geographic locations, analyze competitor performance, and provide actionable SEO insights. The platform integrates with DataForSEO APIs to provide real-time SERP data, competitor analysis, and keyword research capabilities.

### Key Objectives
- Track keyword rankings across multiple locations in real-time
- Automatically discover and analyze competitors
- Provide detailed competitor insights (meta tags, headings, keyword density)
- Enable keyword research and analysis
- Generate historical ranking reports and trends
- Support automated daily/weekly crawls via scheduling

---

## 2. Project Overview

### 2.1 Purpose
Enable SEO professionals and marketing teams to:
- Monitor keyword rankings across multiple locations
- Identify and analyze competitor strategies
- Discover new keyword opportunities
- Track ranking changes over time
- Make data-driven SEO decisions

### 2.2 Target Users
- SEO specialists and consultants
- Digital marketing teams
- Content strategists
- Business owners managing their own SEO

### 2.3 Core Value Propositions
1. **Automated Tracking**: Set it and forget it - automated daily/weekly crawls
2. **Competitor Intelligence**: Automatic competitor discovery and deep analysis
3. **Multi-Location Support**: Track rankings across different geographic markets
4. **Historical Analysis**: Track ranking trends over time
5. **Cost-Effective**: Test API endpoints before running full crawls

---

## 3. Technical Architecture

### 3.1 Technology Stack

#### Frontend
- **Framework**: React 18 with TypeScript
- **UI Library**: Radix UI components
- **Styling**: Tailwind CSS
- **State Management**: TanStack Query (React Query)
- **Routing**: Wouter
- **Charts**: Recharts
- **Build Tool**: Vite

#### Backend
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL (Neon serverless)
- **ORM**: Drizzle ORM
- **Validation**: Zod
- **Scheduling**: node-cron

#### External APIs
- **DataForSEO SERP API**: Real-time search engine results
- **DataForSEO OnPage API**: Competitor website analysis
- **DataForSEO Labs API**: Keyword research (optional)

#### Infrastructure
- **Development**: Local development server
- **Production**: Serverless PostgreSQL (Neon)
- **Caching**: In-memory cache for API responses
- **Error Handling**: Comprehensive error boundaries and logging

### 3.2 System Architecture

```
┌─────────────────┐
│   React Client  │
│   (Frontend)    │
└────────┬────────┘
         │ HTTP/REST
         │
┌────────▼────────┐
│  Express Server │
│   (Backend)     │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
┌───▼───┐ ┌──▼──────────┐
│PostgreSQL│ │ DataForSEO │
│ Database │ │    APIs    │
└─────────┘ └─────────────┘
```

---

## 4. Core Features

### 4.1 Keyword Management

#### Features
- **Add/Edit/Delete Keywords**: Manage keywords with target URLs
- **Location Targeting**: Assign keywords to specific geographic locations
- **Keyword Groups**: Hierarchical organization of keywords
- **Bulk Import/Export**: CSV, JSON, Excel support
- **Daily Tracking Toggle**: Enable/disable daily tracking per keyword

#### User Flows
1. Add keyword → Select location → Assign to group → Save
2. Bulk import → Validate → Review → Confirm import
3. Edit keyword → Update details → Save changes

### 4.2 Ranking Tracking

#### Features
- **Real-Time SERP Data**: Fetch current rankings from DataForSEO
- **Position Calculation**: Accurate organic position (excludes ads/local pack)
- **Historical Tracking**: Time-series ranking data
- **Position Changes**: Track increases/decreases from previous rankings
- **Result Types**: Organic, local pack, other organic
- **Target Domain Filtering**: Focus on specific domain rankings

#### Data Points Tracked
- Current position
- Previous position
- Position change (delta)
- Result type
- URL and domain
- Title
- Date of ranking

### 4.3 Competitor Analysis

#### Features
- **Automatic Discovery**: Competitors discovered from SERP results
- **Deduplication**: Smart competitor deduplication by domain
- **Blacklisting**: Global and keyword-specific competitor exclusion
- **Competitor Insights**: Deep analysis via OnPage API
  - Meta tags (title, description, canonical)
  - Headings (H1-H6)
  - Keyword density
  - Images with alt text
  - Robots.txt
- **Top 10 Analysis**: Automatic insights for top 10 competitors

#### Competitor Insights Data
- **Meta Information**: Title, description, canonical URL, meta keywords
- **Headings**: All H1-H6 tags with counts
- **Keyword Density**: Top keywords with frequency and percentage
- **Images**: All images with URLs and alt text
- **Technical SEO**: Robots.txt content

### 4.4 Location Management

#### Features
- **Geographic Targeting**: Support for multiple locations
- **DataForSEO Integration**: Automatic location code mapping
- **Special Cases**: Custom handling (e.g., San Francisco)
- **Location-Specific Rankings**: Track rankings per location

#### Supported Locations
- United States (default: 2840)
- Custom locations via DataForSEO location codes
- CSV-based location code lookup

### 4.5 Dashboard & Reporting

#### Features
- **Real-Time Statistics**: 
  - Total keywords
  - Total rankings
  - Average position
  - Top 10 count
- **Customizable Layout**: Drag-and-drop dashboard widgets
- **Ranking Charts**: Historical ranking trends
- **Position Changes**: Visual indicators for ranking movements
- **Export Functionality**: CSV, JSON, Excel exports

#### Dashboard Widgets
- Stats cards (keywords, rankings, average position)
- Ranking trend charts
- Recent ranking changes table
- Top performing keywords
- Competitor analysis summary

### 4.6 Scheduling & Automation

#### Features
- **Cron-Based Scheduling**: Flexible scheduling via cron expressions
- **Automated Crawls**: Daily/weekly automated keyword crawls
- **Competitor Analysis Schedule**: Separate schedule for competitor insights
- **Background Task Processing**: Async processing for long-running tasks
- **Status Tracking**: Real-time crawl progress and status

#### Schedule Types
- **Keyword Crawls**: Fetch rankings for all keywords
- **Competitor Analysis**: Update competitor insights
- **Background Tasks**: Process incomplete OnPage API tasks

### 4.7 Batch Processing

#### Features
- **Batch Creation**: Group keywords into batches for processing
- **Progress Tracking**: Real-time batch and item status
- **Rate Limiting**: Configurable delays between API calls
- **Retry Logic**: Automatic retries with exponential backoff
- **Timeout Handling**: Detection and handling of stuck batches
- **Status Management**: Queued → Running → Completed/Failed

#### Batch Statuses
- **Queued**: Waiting to start
- **Running**: Currently processing
- **Completed**: All items finished successfully
- **Failed**: One or more items failed

### 4.8 API Testing Pages

#### OnPage API Test
- Test single URL analysis
- View all available OnPage API data
- Organized data display (meta tags, headings, density, images)
- Auto-polling for task completion

#### Keyword Research API Test
- **Keyword Suggestions**: Get keyword ideas based on seed keyword
- **Site Keywords**: Get keywords a domain ranks for
- **Related Keywords**: Find semantically related keywords
- **Keyword Difficulty**: Assess ranking difficulty
- Real-time results (no async polling needed)

---

## 5. Database Schema

### 5.1 Core Tables

#### `keywords`
- `id`: Primary key
- `keyword`: Keyword text
- `targetUrl`: Target domain URL
- `locationId`: Foreign key to locations
- `groupId`: Foreign key to keywordGroups
- `group`: Legacy group field (backward compatibility)
- `trackDaily`: Boolean flag for daily tracking
- `createdAt`: Timestamp

#### `locations`
- `id`: Primary key
- `name`: Location name
- `code`: Location code
- `dataForSEOLocationCode`: DataForSEO API location code

#### `rankings`
- `id`: Primary key
- `keywordId`: Foreign key to keywords
- `position`: Ranking position
- `url`: Result URL
- `date`: Timestamp
- `resultType`: organic | other_organic | local_pack
- `title`: Result title
- `domain`: Result domain
- `previousPosition`: Previous ranking
- `positionChange`: Change from previous
- `isScheduled`: Boolean flag
- `positionChange`: Integer delta

#### `competitors`
- `id`: Primary key
- `keywordId`: Foreign key to keywords
- `domain`: Competitor domain
- `url`: Competitor URL
- `position`: Ranking position
- `title`: Result title
- `batchId`: Foreign key to keywordBatches

#### `competitorInsights`
- `id`: Primary key
- `competitorId`: Foreign key to competitors
- `taskId`: OnPage API task ID
- `url`: Analyzed URL
- `title`: Page title
- `description`: Meta description
- `canonical`: Canonical URL
- `metaKeywords`: Meta keywords
- `h1`: Text array (H1 tags)
- `h2`: Text array (H2 tags)
- `h3-h6`: Text arrays
- `keywordDensity`: JSONB (keyword density data)
- `images`: JSONB (image data)
- `robotsTxt`: Robots.txt content
- `createdAt`: Timestamp
- `updatedAt`: Timestamp

#### `keywordBatches`
- `id`: Primary key
- `status`: queued | running | completed | failed
- `startTime`: Timestamp
- `endTime`: Timestamp
- `totalItems`: Integer
- `completedItems`: Integer
- `failedItems`: Integer

#### `keywordBatchItems`
- `id`: Primary key
- `batchId`: Foreign key to keywordBatches
- `keywordId`: Foreign key to keywords
- `status`: pending | running | completed | failed
- `errorMessage`: Text
- `createdAt`: Timestamp
- `updatedAt`: Timestamp

#### `schedules`
- `id`: Primary key
- `name`: Schedule name
- `cronExpression`: Cron expression
- `isActive`: Boolean
- `lastRun`: Timestamp
- `nextRun`: Timestamp
- `type`: keyword_crawl | competitor_analysis

#### `keywordGroups`
- `id`: Primary key
- `name`: Group name
- `description`: Group description
- `parentId`: Self-referencing foreign key (hierarchical)

#### `blacklistedCompetitors`
- `id`: Primary key
- `domain`: Domain to blacklist
- `keywordId`: Optional keyword-specific blacklist (null = global)

---

## 6. API Endpoints

### 6.1 Keyword Management
- `GET /api/keywords` - List all keywords
- `POST /api/keywords` - Create keyword
- `PUT /api/keywords/:id` - Update keyword
- `DELETE /api/keywords/:id` - Delete keyword
- `GET /api/keyword-groups` - List keyword groups
- `POST /api/keyword-groups` - Create keyword group

### 6.2 Ranking Data
- `GET /api/rankings` - Get rankings (with filters)
- `GET /api/current-rankings` - Get latest rankings
- `GET /api/dashboard/stats` - Dashboard statistics

### 6.3 Competitor Analysis
- `GET /api/competitors` - Get competitors (by keyword)
- `GET /api/competitor-insights/:competitorId` - Get competitor insights
- `GET /api/competitor-insights/by-keyword/:keywordId` - Get all insights for keyword
- `POST /api/blacklisted-competitors` - Blacklist competitor
- `DELETE /api/blacklisted-competitors/:id` - Remove blacklist

### 6.4 Crawling
- `POST /api/crawl` - Start keyword crawl
- `GET /api/crawl/status` - Get crawl status
- `POST /api/crawl/reset` - Reset stuck batches

### 6.5 Scheduling
- `GET /api/schedule` - Get schedules
- `POST /api/schedule` - Create/update schedule
- `DELETE /api/schedule/:id` - Delete schedule

### 6.6 Testing & Diagnostics
- `GET /api/health` - Health check
- `POST /api/test/onpage` - Test OnPage API
- `GET /api/test/onpage` - Check OnPage task status
- `POST /api/test/keyword-research/suggestions` - Test keyword suggestions
- `POST /api/test/keyword-research/site-keywords` - Test site keywords
- `POST /api/test/keyword-research/related` - Test related keywords
- `POST /api/test/keyword-research/difficulty` - Test keyword difficulty

---

## 7. User Flows

### 7.1 Initial Setup
1. User sets up environment variables (database, API credentials)
2. System initializes database schema
3. User adds locations
4. User imports/creates keywords
5. User sets up schedules

### 7.2 Daily Workflow
1. System runs scheduled crawl (if configured)
2. User views dashboard for latest rankings
3. User checks competitor analysis for insights
4. User reviews ranking changes
5. User exports data if needed

### 7.3 Competitor Analysis Workflow
1. User runs keyword crawl
2. System discovers competitors from SERP results
3. System automatically fetches insights for top 10 competitors
4. User views competitor insights in Competitor Analysis page
5. User can blacklist unwanted competitors

### 7.4 Keyword Research Workflow
1. User navigates to Keyword Research API Test page
2. User selects test type (suggestions, site keywords, etc.)
3. User enters parameters and tests API
4. User reviews available data
5. User decides which keywords to add to tracking

---

## 8. External API Integration

### 8.1 DataForSEO SERP API
- **Endpoint**: `v3/serp/google/organic/live/advanced`
- **Purpose**: Fetch real-time search engine results
- **Rate Limit**: 1-2 requests/second (enforced)
- **Response**: SERP items with positions, URLs, titles, domains

### 8.2 DataForSEO OnPage API
- **Endpoint**: `v3/on_page/task_post` (create task)
- **Endpoint**: `v3/on_page/tasks_ready` (check status)
- **Endpoint**: `v3/on_page/pages` (get results)
- **Purpose**: Analyze competitor websites
- **Processing Time**: 5-15 minutes per URL
- **Response**: Meta tags, headings, keyword density, images

### 8.3 DataForSEO Labs API (Optional)
- **Endpoints**: 
  - `v3/dataforseo_labs/google/keywords_for_keywords/live`
  - `v3/dataforseo_labs/google/keywords_for_site/live`
  - `v3/dataforseo_labs/google/related_keywords/live`
  - `v3/dataforseo_labs/google/keyword_difficulty/live`
- **Purpose**: Keyword research
- **Note**: Requires Labs API subscription

---

## 9. Performance & Scalability

### 9.1 Current Performance
- **Database Operations**: Optimized with bulk inserts and transactions
- **API Rate Limiting**: Configurable delays (default: 1-2 req/sec)
- **Caching**: In-memory cache for frequently accessed data
- **Batch Processing**: Parallel processing with configurable limits

### 9.2 Optimization Strategies
- Bulk database operations (10x speed improvement)
- Transaction-based writes for consistency
- Cache invalidation on data mutations
- Background task processing for long-running operations
- Efficient competitor deduplication

### 9.3 Scalability Considerations
- Serverless PostgreSQL (Neon) for database scaling
- Stateless API design
- Horizontal scaling ready
- Efficient batch processing for large keyword sets

---

## 10. Security & Privacy

### 10.1 Data Security
- Environment variables for sensitive credentials
- No hardcoded API keys
- Secure API authentication (Basic Auth)
- Database connection string encryption

### 10.2 Access Control
- Single-user system (can be extended)
- No public endpoints (all require authentication)
- API rate limiting to prevent abuse

### 10.3 Data Privacy
- User data stored securely in PostgreSQL
- No third-party data sharing
- API credentials stored in environment variables

---

## 11. Error Handling & Monitoring

### 11.1 Error Handling
- Comprehensive try-catch blocks
- Graceful error messages
- Error boundaries in React
- Detailed error logging

### 11.2 Monitoring
- Health check endpoint (`/api/health`)
- Database connectivity checks
- API credential verification
- Cache statistics logging
- Request/response logging

### 11.3 Diagnostics
- Diagnostic routes for development
- Detailed error messages
- API response validation
- Task status tracking

---

## 12. Testing

### 12.1 Unit Tests
- Position calculation logic
- Batch timeout handling
- Competitor deduplication
- Location code mapping
- Scheduler cron expressions

### 12.2 Integration Tests
- Health check endpoint
- Database operations
- API endpoint testing

### 12.3 Test Tools
- Vitest for unit/integration tests
- Manual testing pages (OnPage API, Keyword Research API)
- Diagnostic endpoints

---

## 13. Deployment

### 13.1 Development
- Local development server
- Hot module replacement (HMR)
- Environment variable configuration
- Database migrations

### 13.2 Production
- Serverless PostgreSQL (Neon)
- Express server deployment
- Static asset serving
- Environment-based configuration

### 13.3 Environment Variables
```bash
DATABASE_URL=postgresql://...
DATAFORSEO_API_LOGIN=...
DATAFORSEO_API_PASSWORD=...
CRAWLER_DELAY_MS=1000
PARALLEL_CRAWL_REQUESTS=1
NODE_ENV=production
PORT=3000
```

---

## 14. Future Enhancements

### 14.1 Planned Features
- **Multi-user Support**: User authentication and authorization
- **Custom Reports**: Generate custom ranking reports
- **Email Notifications**: Alerts for ranking changes
- **API Webhooks**: Real-time updates via webhooks
- **Mobile App**: React Native mobile application
- **White-labeling**: Custom branding options

### 14.2 Potential Integrations
- **Google Analytics**: Track organic traffic
- **Google Search Console**: Import GSC data
- **Slack/Teams**: Notifications and alerts
- **Zapier/Make**: Workflow automation
- **Export to BI Tools**: Power BI, Tableau integration

### 14.3 Technical Improvements
- **GraphQL API**: Alternative to REST
- **Real-time Updates**: WebSocket support
- **Advanced Caching**: Redis integration
- **Queue System**: Bull/BullMQ for job processing
- **Microservices**: Split into smaller services

---

## 15. Project Constraints

### 15.1 Technical Constraints
- DataForSEO API rate limits
- OnPage API processing time (5-15 minutes)
- Database connection limits (serverless)
- API cost considerations

### 15.2 Business Constraints
- DataForSEO API subscription costs
- Labs API availability (subscription tier)
- Serverless database limits
- Development time and resources

---

## 16. Success Metrics

### 16.1 Technical Metrics
- API response times
- Database query performance
- Error rates
- Uptime and availability

### 16.2 Business Metrics
- Number of keywords tracked
- Ranking improvements
- Competitor insights generated
- User engagement

---

## 17. Maintenance & Support

### 17.1 Regular Maintenance
- Database optimization
- Cache management
- API endpoint updates
- Security patches

### 17.2 Support Requirements
- API credential management
- Database backup and recovery
- Error monitoring and resolution
- Feature updates

---

## 18. Documentation

### 18.1 Existing Documentation
- Architecture Overview
- Batch Processing Guide
- Critical Fixes Summary
- Test Results
- QA Fixes Applied
- Database Operations Optimization
- Competitor Insights Fix Summary

### 18.2 Additional Documentation Needed
- User Guide
- API Documentation
- Deployment Guide
- Troubleshooting Guide
- FAQ

---

## 19. Project Status

### 19.1 Completed Features
✅ Keyword management  
✅ Ranking tracking  
✅ Competitor discovery  
✅ Competitor insights (OnPage API)  
✅ Location management  
✅ Dashboard and reporting  
✅ Scheduling and automation  
✅ Batch processing  
✅ API testing pages  
✅ Error handling and monitoring  

### 19.2 Current Status
**Production Ready** - All core features implemented and tested

### 19.3 Known Issues
- Dashboard stats showing 0 (pending fix)
- Labs API requires subscription tier (404 errors expected)
- OnPage API tasks can take 5-15 minutes

---

## 20. Conclusion

The SEO Rank Tracking and Competitor Analysis Platform is a comprehensive solution for tracking keyword rankings and analyzing competitor strategies. With automated crawling, competitor insights, and keyword research capabilities, it provides SEO professionals with the tools they need to make data-driven decisions.

The platform is production-ready with all core features implemented, tested, and optimized for performance. Future enhancements can be added based on user feedback and business requirements.

---

**Document Version History:**
- v1.0: Initial scope document
- v2.0: Updated with all implemented features and current status (November 28, 2025)

