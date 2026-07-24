-- Expand analytics from broad click collection to operational product events.
-- Apply with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0009_operational_analytics.up.sql

BEGIN;

ALTER TABLE analytics_events
  DROP CONSTRAINT IF EXISTS analytics_events_event_type_check;

ALTER TABLE analytics_events
  ADD CONSTRAINT analytics_events_event_type_check
  CHECK (event_type IN ('active', 'agent', 'click', 'session'));

CREATE INDEX IF NOT EXISTS idx_analytics_events_type_occurred
  ON analytics_events(event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_events_name_target
  ON analytics_events(event_name, target_id)
  WHERE target_id <> '';

COMMIT;
