-- Migration 0003: referring_domains bigint + ahrefs_best_by_links table

-- traffic_domain: same bigint overflow as ahrefs_backlinks.domain_traffic.
-- Wikipedia domain traffic is 4,062,811,136 (> PostgreSQL integer max 2,147,483,647).
ALTER TABLE referring_domains ALTER COLUMN traffic_domain TYPE bigint;

-- ahrefs_best_by_links: top pages ranked by referring-domain count.
-- Source: Ahrefs BestByLinks export (ContentPagePerformance group).
CREATE TABLE IF NOT EXISTS ahrefs_best_by_links (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        uuid        NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
  page_url        text        NOT NULL,
  page_title      text,
  language        text,
  platform        text,
  ur              numeric(5,2),
  ref_domains     integer,
  top_dr          integer,
  links_to_target integer,
  new_links       integer,
  lost_links      integer,
  dofollow_links  integer,
  nofollow_links  integer,
  redirect_links  integer,
  page_http_code  integer,
  first_seen      timestamptz,
  last_seen       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, page_url)
);
CREATE INDEX IF NOT EXISTS ahrefs_best_by_links_brand_idx        ON ahrefs_best_by_links(brand_id);
CREATE INDEX IF NOT EXISTS ahrefs_best_by_links_ref_domains_idx  ON ahrefs_best_by_links(brand_id, ref_domains DESC);
