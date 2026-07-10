-- Add authenticated chat feedback collection.
-- Apply with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0004_feedback.up.sql

BEGIN;

CREATE TABLE IF NOT EXISTS feedbacks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  target_message_id TEXT,
  entry_point TEXT NOT NULL CHECK (entry_point IN ('message_action', 'titlebar')),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 4000),
  messages JSONB NOT NULL,
  reporter_email TEXT NOT NULL DEFAULT '',
  client_version TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feedback_images (
  id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES feedbacks(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  content BYTEA NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 5242880),
  CHECK (byte_size = octet_length(content)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedbacks_created_at ON feedbacks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedbacks_session_created ON feedbacks(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_images_feedback ON feedback_images(feedback_id);

COMMIT;
