-- Migration 0004: persist per-brand Business Profile account and locations.
-- The shared Google OAuth connection already covers these permissions; this
-- migration only adds the brand-scoped configuration used by the integrations UI.
ALTER TABLE google_brand_connections
  ADD COLUMN IF NOT EXISTS business_profile_account_name text;

ALTER TABLE google_brand_connections
  ADD COLUMN IF NOT EXISTS business_profile_location_names text[] NOT NULL DEFAULT '{}';