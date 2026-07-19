-- Remove client click analytics storage.
-- Apply with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0008_click_analytics.down.sql

BEGIN;
DROP TABLE IF EXISTS analytics_events;
COMMIT;
