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
Response key: `pages`. Field `url` (NOT `url_to`). 250-row plan cap.

## /site-explorer/organic-competitors
**Correct path:** `/site-explorer/organic-competitors` (NOT `competing-domains` — that returns 404).
Response key: `competitors`. Returns exactly 20 rows (natural ceiling, not a cap).
Confirmed fields: `competitor_domain`, `keywords_common`, `keywords_competitor`,
`domain_rating`, `traffic`, `pages`, `share`, `value`, `group_mode`, `keywords_target`, `competitor_url`.
**NOT valid:** `domain`, `common_keywords`, `competitor_keywords` (old assumed names — all wrong).

## /site-explorer/refdomains
Response key: `refdomains`. 250-row plan cap, offset ignored.
Confirmed valid columns (from prior session):
`domain, domain_rating, dofollow_links, links_to_target, dofollow_refdomains,
first_seen, last_seen, is_spam, is_root_domain, traffic_domain`

## /site-explorer/domain-rating
Live probe confirmed: `domain_rating: 73.0, ahrefs_rank: 57401` for tekrevol.com.

## /v3/management/projects
**No `select` param needed.** Returns all projects in account.
Response key: `projects`. Fields: `project_id, project_name, url, mode, protocol, access,
verified, folder, owned_by, keyword_count, web_analytics_data_key`.
TekRevol: `project_id: "4127143"`, `keyword_count: 432`.

## /v3/management/project-keywords?project_id=<id>
Returns full keyword registry. **No `select` or pagination needed** — all 432 rows in one response.
Response key: `keywords`. Fields: `keyword, language_code, language, location_id, location, tags`.
No rank data here — purely the keyword list with tags and locale.

## /v3/rank-tracker/overview?project_id=<id>&date=<YYYY-MM-DD>&device=<desktop|mobile>&select=<cols>
**`select` param REQUIRED** (returns 400 "missing argument 'select'" without it).
Response key: `overviews`.
**250-row hard cap** — same as Site Explorer; `limit=500` still returns 250; `offset=250` ignored (returns same first 250 rows). 432 keywords tracked but only 250 reachable via REST.
`limit=N` where N < 250 DOES work (useful for smoke tests).
Historical dates work (e.g. yesterday).
No pagination metadata in response root.

Confirmed valid `select` columns (from live 400 error listing):
```
is_commercial, keyword, search_type_web, search_type_video, keyword_difficulty,
serp_features, url, position, is_navigational, created_at, search_type_news,
country, is_transactional, search_type_image, volume_mobile_pct, location,
volume_desktop_pct, parent_topic, target_positions_count, cost_per_click, traffic,
keyword_is_frozen, serp_updated, clicks, volume, best_position_has_video_preview,
is_local, tags, is_informational, is_branded, best_position_kind, clicks_per_search,
best_position_has_thumbnail, keyword_has_data, language
```
**NOT valid:** `best_position_diff` (Irfan's intel — field does not exist in API).

Lost keyword semantics (confirmed live): `position: null`, `url: null`, `best_position_kind: null`, `serp_features: []`. No zero-position rows — null is the only Lost signal.
`best_position_kind` values: `"organic"`, `"ai_overview"`, `null` (Lost).
`serp_features`: array of strings e.g. `["local_pack","question","sitelink","video_th"]`.
`country`: output-only (cannot filter by it in query), reflects the keyword's configured locale.
Multi-country in TekRevol project: US (183), GB (28), AE (12), CA (10), SA (8), QA (5), BH (4) of 250.

## Pagination
- **250-row hard cap applies to ALL bulk endpoints** (site-explorer/* and rank-tracker/overview).
- Offset ignored on all capped endpoints — same first 250 rows returned regardless.
- `limit=N` where N < 250 works correctly (useful for smoke tests).
- No endpoint returns pagination metadata — total count available only via `/site-explorer/metrics` (aggregate).

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
