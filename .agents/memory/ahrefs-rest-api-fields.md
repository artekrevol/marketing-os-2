---
name: Ahrefs REST v3 API — confirmed field names and response shapes
description: Live-probed field names, response keys, and quirks for Ahrefs REST v3 endpoints. Use before writing any select= string or response parser.
---

# Ahrefs REST v3 — Confirmed Field Names (probed 2026-07-30)

## Authentication & base URL
- Base: `https://api.ahrefs.com/v3`
- Auth: `Authorization: Bearer $AHREFS_API_KEY` (NOT the MCP key)
- All requests: `GET` with query params (`URLSearchParams`)

## Required params (all site-explorer endpoints)
- `date` (YYYY-MM-DD) is **required** on every site-explorer endpoint — omitting it returns HTTP 400.
- `select` (comma-separated column list) is required.
- `mode` accepted values: `subdomains`, `prefix`, `domain`, `exact`.

## /site-explorer/organic-keywords
**Response key:** `keywords` (NOT `organic_keywords`)
**Units:** not reported in response body — `metadata.units_used` absent; log 0.

Confirmed valid `select` columns (from live API error listing):
```
keyword, keyword_country, volume, keyword_difficulty, cpc, sum_traffic,
best_position, best_position_url, is_commercial, is_navigational,
is_transactional, is_informational, is_branded, keyword_language,
all_positions, serp_features, last_update, entities, words, language
```

**NOT valid:** `country` (use `keyword_country`), `traffic` (use `sum_traffic`),
`intent` (does not exist — use the four boolean flags instead).

Intent flags: `is_informational`, `is_commercial`, `is_transactional`, `is_navigational`, `is_branded`
— these are boolean fields, NOT a comma-separated string.

## /site-explorer/top-pages
Response key: TBD — probe required before Phase 4.

## /site-explorer/competing-domains
Response key: TBD — probe required before Phase 5.

## /site-explorer/refdomains
Response key: TBD — probe required before Phase 6.
Confirmed valid columns (from prior session):
`domain, domain_rating, dofollow_links, links_to_target, dofollow_refdomains,
first_seen, last_seen, is_spam, is_root_domain, traffic_domain`

## /site-explorer/domain-rating
Response key: TBD — probe required before Phase 7.

## Pagination
- Offset-based: increment by rows returned until rows < limit.
- Observed max page size: 250 rows for organic-keywords (plan limit may be lower than requested 1000).
- Always set limit=1000 and let the pagination loop stop when rows < limit.

## Units consumption
- `metadata.units_used` in response body — absent for organic-keywords endpoint.
- No `X-Api-Units-Cost` header observed. Log 0 when absent; do not error.

## Classification decisions (Phase 3, TekRevol)
- `is_branded`: trust Ahrefs' own flag — covers all branded queries (any brand), not just "tekrevol".
- `is_high_value_target`: top 20% by `sum_traffic × cpc` among non-branded corpus.
- HVT threshold for TekRevol US pull (2026-07-30): score >= 9560.
- Priority ladder: P0 = pos≤3 + HVT; P1 = pos≤10 OR HVT; P2 = pos≤20; P3 = branded or pos>20.
- New keyword inserts: `track_daily = false` (dispatcher promotes selectively).
- `priority_pre_ahrefs_import = COALESCE(existing_snapshot, existing_priority)` — captures pre-import priority once, never overwrites.

**Why:** Ahrefs `is_branded` is broader than "tekrevol" text-match — captures fortnite/GTA keywords TekRevol ranks for as editorial content, which genuinely have different SEO dynamics (no conversion intent, cpc≈0). Trusting Ahrefs avoids a fragile text-matching heuristic.
