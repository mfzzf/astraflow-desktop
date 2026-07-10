-- Store the raw messages API snapshot as text.
-- PostgreSQL JSONB rejects valid JSON strings containing the \u0000 escape,
-- while TEXT preserves the original serialized payload byte-for-byte.
-- Apply with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0006_feedback_messages_text.up.sql

BEGIN;

ALTER TABLE feedbacks
  DROP CONSTRAINT IF EXISTS feedbacks_session_snapshot_check;

ALTER TABLE feedbacks
  ALTER COLUMN messages TYPE TEXT USING messages::text;

ALTER TABLE feedbacks
  ADD CONSTRAINT feedbacks_session_snapshot_check CHECK (
    (session_id IS NULL AND target_message_id IS NULL AND messages IS NULL)
    OR
    (session_id IS NOT NULL AND messages IS NOT NULL)
  );

COMMIT;
