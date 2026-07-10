-- Restore JSONB storage for feedback message snapshots.
-- This rollback fails atomically if TEXT rows contain JSON escapes unsupported
-- by PostgreSQL JSONB, such as \u0000. No rows are deleted automatically.
-- Roll back with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0006_feedback_messages_text.down.sql

BEGIN;

ALTER TABLE feedbacks
  DROP CONSTRAINT IF EXISTS feedbacks_session_snapshot_check;

ALTER TABLE feedbacks
  ALTER COLUMN messages TYPE JSONB USING messages::jsonb;

ALTER TABLE feedbacks
  ADD CONSTRAINT feedbacks_session_snapshot_check CHECK (
    (session_id IS NULL AND target_message_id IS NULL AND messages IS NULL)
    OR
    (
      session_id IS NOT NULL
      AND messages IS NOT NULL
      AND jsonb_typeof(messages) = 'array'
    )
  );

COMMIT;
