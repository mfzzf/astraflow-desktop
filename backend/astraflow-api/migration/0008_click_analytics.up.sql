-- Store privacy-conscious client click analytics for the admin behavior dashboard.
-- Apply with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0008_click_analytics.up.sql

BEGIN;

CREATE TABLE IF NOT EXISTS analytics_events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  anonymous_id TEXT NOT NULL,
  user_id_hash TEXT NOT NULL DEFAULT '',
  event_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  path TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  target_label TEXT NOT NULL DEFAULT '',
  channel_slug TEXT NOT NULL DEFAULT 'default',
  client_version TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT '',
  screen_width INTEGER NOT NULL DEFAULT 0,
  screen_height INTEGER NOT NULL DEFAULT 0,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (event_type = 'click'),
  CHECK (screen_width >= 0 AND screen_height >= 0)
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_occurred
  ON analytics_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_channel_occurred
  ON analytics_events(channel_slug, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_name_occurred
  ON analytics_events(event_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_session_occurred
  ON analytics_events(session_id, occurred_at DESC);

COMMIT;
