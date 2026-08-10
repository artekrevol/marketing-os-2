-- Migration 0002: Fix column types and add missing columns discovered during
-- real-data smoke test against actual Ahrefs XLSX exports.
--
-- Safe to run on existing installs — all statements are idempotent.

-- domain_traffic and page_traffic must be bigint: top referring domains
-- (Wikipedia, Investopedia) have traffic values > 2.1B (PostgreSQL integer max).
ALTER TABLE ahrefs_backlinks ALTER COLUMN domain_traffic TYPE bigint;
ALTER TABLE ahrefs_backlinks ALTER COLUMN page_traffic   TYPE bigint;

-- target_http_code: HTTP status of our target page as reported by the Ahrefs
-- BrokenBacklinks export ("Target page HTTP code" column).  Stored directly on
-- the backlink row so broken-link queries need no join to ahrefs_page_performance.
ALTER TABLE ahrefs_backlinks ADD COLUMN IF NOT EXISTS target_http_code integer;

-- ref_pages_count was present in the Drizzle schema and live DB but missing
-- from the 0001 migration CREATE TABLE.  Add it for fresh installs.
ALTER TABLE ahrefs_anchors ADD COLUMN IF NOT EXISTS ref_pages_count integer;

-- traffic_domain on referring_domains: same bigint overflow as ahrefs_backlinks.
-- Wikipedia's domain traffic is 4,062,811,136 which exceeds PostgreSQL integer max (2,147,483,647).
ALTER TABLE referring_domains ALTER COLUMN traffic_domain TYPE bigint;
