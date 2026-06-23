# Overview

This is an SEO Rank Tracking and Competitor Analysis platform built with React, Express, and PostgreSQL. The application tracks keyword rankings across multiple locations using the DataForSEO API, analyzes competitor performance, and provides insights for SEO optimization. It features automated keyword crawling, position tracking with change detection, competitor website analysis, and comprehensive reporting dashboards.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

**Framework**: React with TypeScript  
**Rationale**: Provides type safety and component reusability for complex data visualization  
**UI Library**: Radix UI components with Tailwind CSS for consistent, accessible interface  
**State Management**: TanStack Query (React Query) for server state and caching  
**Data Visualization**: React Table for sortable data grids with virtual scrolling support

## Backend Architecture

**Runtime**: Node.js with Express.js  
**Language**: TypeScript/JavaScript (ES Modules)  
**Rationale**: Event-driven architecture handles asynchronous API calls efficiently  

**Key Design Patterns**:
- Separation of concerns with dedicated modules (crawler, storage, dataForSEO integration)
- RESTful API design for all client-server communication
- Scheduled jobs using node-cron for automated keyword tracking
- Batch processing system for managing large-scale keyword crawls

**Critical Components**:
- `server/crawler.js`: Orchestrates keyword ranking checks via DataForSEO API
- `server/storage.js`: Abstraction layer for all database operations
- `server/dataForSEO.js`: Handles external API communication with authentication
- `server/scheduler.js`: Manages automated daily/weekly ranking checks

## Data Storage

**Database**: PostgreSQL (via Neon serverless)  
**ORM**: Drizzle ORM  
**Rationale**: PostgreSQL provides relational data integrity for keyword-ranking-competitor relationships; Drizzle offers type-safe queries with minimal overhead

**Schema Design**:
- `keywords`: Stores target keywords with location and grouping metadata
- `rankings`: Time-series data for position tracking with change detection
- `competitors`: Stores competitor domains discovered during ranking checks
- `keywordGroups`: Hierarchical organization of keywords (location-based, competitor-based)
- `locations`: Geographic targeting data mapped to DataForSEO location codes
- `keywordBatches`: Tracks bulk crawl operations for status monitoring

**Position Calculation Logic**: 
- Standardizes "not ranked" as position -1
- Filters organic results by excluding ads, local packs, and featured snippets
- Calculates position changes by comparing with previous ranking entry
- Handles edge cases for first-time rankings and lost positions

## Authentication & Authorization

Currently implements basic session-based authentication. No complex role-based access control implemented.

## External Dependencies

**DataForSEO API**: Primary integration for SERP data  
- Service: `https://api.dataforseo.com/v3/serp/google/organic/live/advanced`
- Authentication: HTTP Basic Auth with credentials in environment variables
- Purpose: Real-time keyword ranking data, competitor discovery, SERP features
- Location Mapping: Custom logic maps database locations to DataForSEO location codes (special handling for San Francisco: code 1014221)

**Environment Configuration**:
- `DATABASE_URL`: PostgreSQL connection string (Neon serverless)
- `DATAFORSEO_API_LOGIN`: DataForSEO username/email
- `DATAFORSEO_API_PASSWORD`: DataForSEO API password
- `NODE_ENV`: Environment flag (development/production)

**Third-Party Libraries**:
- `cheerio`: HTML parsing for competitor website content analysis
- `axios`: HTTP client for API requests
- `archiver`: Project export functionality
- `node-cron`: Task scheduling for automated crawls

**Data Processing**:
- Keyword density calculation for competitor content analysis
- Position change tracking with historical comparison
- Batch processing system with progress tracking and error handling