-- Ahrefs Intelligence tables (Sprint: Ahrefs dashboard)
-- Uses IF NOT EXISTS throughout so this migration is safe to apply against
-- a database that already has these tables (e.g. the dev DB where they were
-- created via raw SQL during development).

CREATE TABLE IF NOT EXISTS "ahrefs_import_batches" (
  "id"                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "brand_id"                uuid        NOT NULL REFERENCES "brands"("id") ON DELETE RESTRICT,
  "imported_at"             timestamptz NOT NULL DEFAULT now(),
  "file_count"              integer     NOT NULL DEFAULT 0,
  "backlink_count"          integer     NOT NULL DEFAULT 0,
  "referring_domain_count"  integer     NOT NULL DEFAULT 0,
  "anchor_count"            integer     NOT NULL DEFAULT 0,
  "page_count"              integer     NOT NULL DEFAULT 0,
  "organic_keyword_count"   integer     NOT NULL DEFAULT 0,
  "content_gap_count"       integer     NOT NULL DEFAULT 0,
  "delta_new_links"         integer,
  "delta_lost_links"        integer,
  "delta_new_gap_keywords"  integer,
  "delta_pages_recovered"   integer,
  "delta_pages_crashed"     integer,
  "created_at"              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ahrefs_import_batches_brand_idx"
  ON "ahrefs_import_batches" ("brand_id", "imported_at" DESC);

-- --------------------------------------------------------------------- --

CREATE TABLE IF NOT EXISTS "ahrefs_backlinks" (
  "id"                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "brand_id"                  uuid        NOT NULL REFERENCES "brands"("id") ON DELETE RESTRICT,
  "import_batch_id"           uuid        REFERENCES "ahrefs_import_batches"("id") ON DELETE SET NULL,
  "referring_page_url"        text        NOT NULL,
  "referring_page_title"      text,
  "language"                  text,
  "platform"                  text,
  "referring_page_http_code"  integer,
  "dr"                        numeric(5,2),
  "ur"                        numeric(5,2),
  "domain_traffic"            bigint,
  "page_traffic"              bigint,
  "target_url"                text,
  "target_http_code"          integer,
  "anchor"                    text,
  "left_context"              text,
  "right_context"             text,
  "link_type"                 text,
  "is_nofollow"               boolean     DEFAULT false,
  "is_spam"                   boolean     DEFAULT false,
  "is_ugc"                    boolean     DEFAULT false,
  "is_sponsored"              boolean     DEFAULT false,
  "is_lost"                   boolean     DEFAULT false,
  "drop_reason"               text,
  "first_seen"                date,
  "last_seen"                 date,
  "lost_at"                   date,
  "page_type"                 text,
  "author"                    text,
  "created_at"                timestamptz NOT NULL DEFAULT now(),
  "updated_at"                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ahrefs_backlinks_brand_url_uq" UNIQUE ("brand_id", "referring_page_url")
);

CREATE INDEX IF NOT EXISTS "ahrefs_backlinks_brand_batch_idx"
  ON "ahrefs_backlinks" ("brand_id", "import_batch_id");
CREATE INDEX IF NOT EXISTS "ahrefs_backlinks_brand_dr_idx"
  ON "ahrefs_backlinks" ("brand_id", "dr" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "ahrefs_backlinks_brand_lost_idx"
  ON "ahrefs_backlinks" ("brand_id", "is_lost");
CREATE INDEX IF NOT EXISTS "ahrefs_backlinks_target_url_idx"
  ON "ahrefs_backlinks" ("brand_id", "target_url");

-- --------------------------------------------------------------------- --

CREATE TABLE IF NOT EXISTS "ahrefs_anchors" (
  "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "brand_id"         uuid        NOT NULL REFERENCES "brands"("id") ON DELETE RESTRICT,
  "import_batch_id"  uuid        REFERENCES "ahrefs_import_batches"("id") ON DELETE SET NULL,
  "anchor_text"      text        NOT NULL,
  "ref_domains_count" integer,
  "top_dr"           numeric(5,2),
  "ref_pages_count"  integer,
  "links_to_target"  integer,
  "new_links"        integer,
  "lost_links"       integer,
  "dofollow_links"   integer,
  "first_seen"       date,
  "is_lost"          boolean     DEFAULT false,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ahrefs_anchors_brand_anchor_uq" UNIQUE ("brand_id", "anchor_text")
);

CREATE INDEX IF NOT EXISTS "ahrefs_anchors_brand_batch_idx"
  ON "ahrefs_anchors" ("brand_id", "import_batch_id");
CREATE INDEX IF NOT EXISTS "ahrefs_anchors_brand_dr_idx"
  ON "ahrefs_anchors" ("brand_id", "top_dr" DESC NULLS LAST);

-- --------------------------------------------------------------------- --

CREATE TABLE IF NOT EXISTS "ahrefs_page_performance" (
  "id"                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "brand_id"            uuid          NOT NULL REFERENCES "brands"("id") ON DELETE RESTRICT,
  "import_batch_id"     uuid          REFERENCES "ahrefs_import_batches"("id") ON DELETE SET NULL,
  "url"                 text          NOT NULL,
  "status"              text,
  "ur"                  numeric(5,2),
  -- Ahrefs "traffic" columns (estimated monthly organic visits)
  "prev_traffic"        integer,
  "curr_traffic"        integer,
  "traffic_change"      integer,
  -- Ahrefs "traffic value" columns (estimated USD value of organic traffic)
  "prev_traffic_value"  numeric(12,2),
  "curr_traffic_value"  numeric(12,2),
  -- Referring domains count and keyword counts
  "curr_ref_domains"    integer,
  "prev_keywords"       integer,
  "curr_keywords"       integer,
  "page_type"           text,
  -- Top keyword labels for this page in each snapshot
  "prev_top_keyword"    text,
  "curr_top_keyword"    text,
  "created_at"          timestamptz   NOT NULL DEFAULT now(),
  "updated_at"          timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT "ahrefs_page_perf_brand_url_uq" UNIQUE ("brand_id", "url")
);

CREATE INDEX IF NOT EXISTS "ahrefs_page_performance_brand_batch_idx"
  ON "ahrefs_page_performance" ("brand_id", "import_batch_id");
CREATE INDEX IF NOT EXISTS "ahrefs_page_performance_brand_traffic_idx"
  ON "ahrefs_page_performance" ("brand_id", "curr_traffic" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "ahrefs_page_performance_brand_status_idx"
  ON "ahrefs_page_performance" ("brand_id", "status");

-- --------------------------------------------------------------------- --

CREATE TABLE IF NOT EXISTS "ahrefs_content_gap" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "brand_id"             uuid        NOT NULL REFERENCES "brands"("id") ON DELETE RESTRICT,
  "import_batch_id"      uuid        REFERENCES "ahrefs_import_batches"("id") ON DELETE SET NULL,
  "keyword"              text        NOT NULL,
  "intents"              text[],
  "volume"               integer,
  "kd"                   integer,
  "cpc"                  numeric(10,2),
  "our_url"              text,
  "our_position"         integer,
  "our_traffic"          integer,
  "competitor_domain"    text        NOT NULL,
  "competitor_url"       text,
  "competitor_position"  integer,
  "competitor_traffic"   integer,
  "priority_score"       integer,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ahrefs_content_gap_brand_kw_comp_uq" UNIQUE ("brand_id", "keyword", "competitor_domain")
);

CREATE INDEX IF NOT EXISTS "ahrefs_content_gap_brand_priority_idx"
  ON "ahrefs_content_gap" ("brand_id", "priority_score" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "ahrefs_content_gap_brand_volume_idx"
  ON "ahrefs_content_gap" ("brand_id", "volume" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "ahrefs_content_gap_batch_idx"
  ON "ahrefs_content_gap" ("import_batch_id");
