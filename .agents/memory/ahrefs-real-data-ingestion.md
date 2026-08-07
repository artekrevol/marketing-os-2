---
name: Ahrefs real-data ingestion quirks
description: Column names, type overflows, and SQL gotchas discovered from actual Ahrefs XLSX exports
---

# Ahrefs XLSX — real column headers and ingestion quirks

## Backlinks export
- Column: `Domain rating` (not "DR") → maps to `dr`
- Column: `Domain traffic` → **bigint required** — top domains (Wikipedia, Investopedia) exceed 4B, overflowing PostgreSQL `integer` (max ~2.1B)
- Column: `Page traffic` → **bigint** for same reason
- Column: `Type` → `link_type`
- Column: `Nofollow` → `is_nofollow`
- Column: `Lost` → contains a **date string** when lost, `null` when active. `safeBool()` incorrectly returns `false` for date strings. Correct check: `row["Lost"] != null`. And `lost_at = parseDate(row["Lost"])` (not `row["Last seen"]`).

## BrokenBacklinks export
- Has `Target page HTTP code` column → store as `target_http_code integer` on `ahrefs_backlinks`
- The broken-backlink query should filter `b.target_http_code BETWEEN 400 AND 599` directly. Do NOT join to `ahrefs_page_performance.status` — TopPages `status` values are blank in real exports.

## Anchors export
- Column: `Ref. pages` → `ref_pages_count`

## TopPages export
- Column: `Previous traffic value` / `Current traffic value` → maps to `prev_traffic_value` / `curr_traffic_value`
- Column: `Current referring domains` → `curr_ref_domains`
- Column: `Previous # of keywords` / `Current # of keywords`
- Column: `Previous top keyword` / `Current top keyword`
- Status column is blank for many rows; do not rely on it for broken-link detection.

## ContentGap export
- Column: `Intents` contains CSV-quoted values like `"Informational","Commercial"` (literal double quotes inside).
  - Parse: `split(",").map(s => s.trim().replace(/^"|"$/g, "").trim())` (strip quotes **per element**, not the whole string)
- Our site column: `www.tekrevol.com/: URL`, `www.tekrevol.com/: Organic Position`, `www.tekrevol.com/: Organic Traffic`
- Competitor columns auto-detected via `k.includes(": URL") && !k.startsWith("www.tekrevol")`

## SQL array binding with drizzle-orm
drizzle's `sql` template spreads a JS `string[]` into multiple positional params `($4,$5)` and casts them as a record type — `($4,$5)::text[]` fails with "cannot cast type record to text[]".
**Fix:** Format as a PostgreSQL array literal string before binding:
```ts
const pgArr = vals.length > 0
  ? `{${vals.map(s => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`
  : null;
// then: ${pgArr}::text[]   (single parameter, correct cast)
```

**Why:** The pg wire protocol sends JS arrays as multiple parameters; PostgreSQL can't reconstruct a text[] from them without explicit array constructor syntax.

## DR threshold consistency
- Summary `brokenHighDrLinks` and list `/backlinks/broken` must both enforce `b.dr::numeric >= 40`.
- Dashboard.tsx label must read "DR 40+" to match (was "DR 70+" mismatch).

## Architect review discipline
Always run architect review + real-data smoke test BEFORE marking any task complete. Three mark-complete → validation-failed cycles in Task #42 traced to skipping both steps.
