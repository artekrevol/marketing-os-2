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

## Token encryption (AES-256-GCM)
- Both access_token and refresh_token are encrypted before DB storage.
- Key: `GOOGLE_OAUTH_ENCRYPTION_KEY` (32 bytes, hex or base64). Present in Replit Secrets.
- Format: `<iv_b64url>:<authTag_b64url>:<ciphertext_b64url>` (colon-separated).
- Crypto utilities: `artifacts/api-server/src/routes/google/google-crypto.ts` and `lib/worker/src/jobs/seo/google-crypto.ts` (kept in sync manually).
- Legacy plaintext tokens (no colon) are passed through with a console.warn — brand needs re-auth to get encrypted storage.
- **Never store a plaintext token in DB.** All write paths (oauth.ts callback, gsc.ts ensureFreshToken, sync-gsc.ts refresh) call `encryptToken()` before the UPDATE/INSERT.

## Token refresh
5-minute expiry buffer. Worker's `refreshToken()` accepts the *encrypted* refresh token string and decrypts internally. API server's `ensureFreshToken()` decrypts both tokens before use and re-encrypts the new access token on refresh.

## Sync error classification
Worker's `gsc_sync_log.status` values and their meaning:
- `running` — in progress
- `done` — success
- `token_revoked` — 401 from token refresh or GSC API; admin must reconnect
- `rate_limited` — 429 from GSC API; recoverable, will retry on next nightly run
- `error` — unexpected failure

Frontend (`GoogleIntegrations.tsx`) reads `lastSync.status` and should surface "Reconnect required" banner for `token_revoked`.

## First-sync backfill
Worker detects first sync by checking row count in `gsc_query_rows` for the brand.
- First sync: 490-day window (≈ 16 months)
- Subsequent syncs: 90-day window (catches GSC data lag)

## GCP configuration (locked)
- Project: seo-dashboard-480323 (SEO Dashboard)
- OAuth consent: Testing mode — only TekRevol Workspace accounts on test users list
- Scopes requested: `webmasters.readonly`, `analytics.readonly`, `business.manage` — NO BigQuery/Cloud Storage
- Callback URI: `https://marketing-os-revol.replit.app/api/google/oauth/callback`

## What user must do before first use
1. ✓ Callback URL registered in GCP
2. ✓ `GOOGLE_OAUTH_REDIRECT_URI` set in Replit Secrets
3. ✓ `GOOGLE_OAUTH_ENCRYPTION_KEY` set in Replit Secrets
4. Navigate to `/seo/integrations` as admin → "Connect Google account" per brand
5. Select GSC property in the dropdown
6. Click "Sync now" or wait for 4am UTC nightly cron
