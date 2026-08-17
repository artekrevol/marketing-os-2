---
name: GSC integration architecture
description: How the Google Search Console (Phase 1) integration is wired — OAuth flow, DB tables, worker jobs, routes, frontend pages.
---

## OAuth flow
- Admin initiates at `GET /api/google/oauth/start?brandId=...` (requires auth + admin/lead role)
- Scopes: openid, email, profile, webmasters.readonly, analytics.readonly (all bundled, Phase 2 GA4 will reuse same connection)
- CSRF state stored in `google_oauth_states` table (10 min TTL, consumed on use)
- Callback: `GET /api/google/oauth/callback` — NO auth required (Google calls it)
- Tokens stored in `google_brand_connections` — one row per brand (upsert on conflict)
- After success, redirect to `/seo-os/seo/integrations?google=connected&brand=<id>`
- Redirect URI: `GOOGLE_OAUTH_REDIRECT_URI` env var (fallback: `https://marketing-os-revol.replit.app/api/google/oauth/callback`)

**Why:** Admin-driven, brand-scoped OAuth. No per-user token management needed for an internal agency tool.

## DB tables (created via direct SQL)
- `google_oauth_states` — CSRF (system, not brand-scoped)
- `google_brand_connections` — tokens + gscPropertyUrl + ga4PropertyId (brand-scoped via unique brand_id FK)
- `gsc_query_rows` — query+page+country+device level data, unique constraint = `(brand_id, date, query, page, country, device)`
- `gsc_page_rows` — page+country+device level data, unique constraint = `(brand_id, date, page, country, device)`
- `gsc_sync_log` — per-brand sync history

All except google_oauth_states are in BRAND_SCOPED_TABLES in `lib/db/src/brand-scope.ts`.

## Worker jobs
- `seo.sync-gsc-data` — pulls last 90 days, fetches up to 50k rows per dimension (2-page pagination), upserts, updates sync log. Queue: `integrations`.
- `seo.sync-gsc.nightly` — fan-out: queries all brands WHERE gsc_property_url IS NOT NULL and enqueues seo.sync-gsc-data. Cron: `0 4 * * *` UTC. Queue: `integrations`.

**Why:** GSC has a 2-3 day data lag, so always re-fetches last 90 days. Unique constraints make safe repeated upserts.

## API routes
- `GET /api/google/oauth/start?brandId=` — auth-gated, builds Google auth URL
- `GET /api/google/oauth/callback` — public (Google calls it), validates state, exchanges code
- `DELETE /api/google/oauth/:brandId` — auth-gated, removes tokens
- `GET /api/seo/gsc/connection` — connection status + last sync
- `GET /api/seo/gsc/properties` — lists GSC sites via API
- `POST /api/seo/gsc/property` — saves selected property URL
- `GET /api/seo/gsc/search-performance?dimension=query|page|date` — aggregated data from DB
- `POST /api/seo/gsc/sync` — enqueues manual sync
- `GET /api/seo/gsc/sync-log` — last 10 sync records

Google router is mounted WITHOUT requireSeoRole (`router.use("/google", googleRouter)`) — the callback route is public.

## Frontend
- `artifacts/seo-os/src/pages/seo/SearchPerformance.tsx` — stat cards, click/impression trend chart (SVG bars), query/page table with mini bars, date presets (28d/90d/6mo)
- `artifacts/seo-os/src/pages/admin/GoogleIntegrations.tsx` — per-brand connection cards, property selector dropdown, sync/disconnect buttons
- Routes: `/seo/search-performance`, `/seo/integrations`
- Nav: "Search Performance" in Intelligence section; "Integrations" in Settings section (admin-only)
- API client: `gsc` export in `artifacts/seo-os/src/lib/api.ts`

## Token refresh
Both the API server and worker have inline token refresh logic (5 min expiry buffer). The `google-client.ts` shared module is only for the API server. Worker has its own inline refresh to avoid cross-package deps.

## What user must do before first use
1. Register callback URL in GCP: `https://marketing-os-revol.replit.app/api/google/oauth/callback`
2. Set `GOOGLE_OAUTH_REDIRECT_URI` env var to the callback URL (if not using the default)
3. Navigate to `/seo/integrations` as admin and click "Connect Google account" per brand
4. Select the GSC property in the dropdown
5. Click "Sync now" or wait for 4am UTC nightly cron
