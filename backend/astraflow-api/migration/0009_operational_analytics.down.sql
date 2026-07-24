-- Revert operational product events to click-only analytics.
-- Non-click rows must be removed before restoring the original constraint.
-- Apply with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0009_operational_analytics.down.sql

BEGIN;

DROP INDEX IF EXISTS idx_analytics_events_name_target;
DROP INDEX IF EXISTS idx_analytics_events_type_occurred;

DELETE FROM analytics_events
WHERE event_type <> 'click';

ALTER TABLE analytics_events
  DROP CONSTRAINT IF EXISTS analytics_events_event_type_check;

ALTER TABLE analytics_events
  ADD CONSTRAINT analytics_events_event_type_check
  CHECK (event_type = 'click');

COMMIT;
