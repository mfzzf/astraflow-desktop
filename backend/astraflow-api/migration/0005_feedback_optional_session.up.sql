-- Allow titlebar feedback before a chat session has been created.
-- Apply with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0005_feedback_optional_session.up.sql

BEGIN;

ALTER TABLE feedbacks
  ALTER COLUMN session_id DROP NOT NULL,
  ALTER COLUMN messages DROP NOT NULL;

ALTER TABLE feedbacks
  ADD CONSTRAINT feedbacks_session_snapshot_check CHECK (
    (session_id IS NULL AND target_message_id IS NULL AND messages IS NULL)
    OR
    (
      session_id IS NOT NULL
      AND messages IS NOT NULL
      AND jsonb_typeof(messages) = 'array'
    )
  ),
  ADD CONSTRAINT feedbacks_message_entry_check CHECK (
    entry_point <> 'message_action'
    OR (session_id IS NOT NULL AND target_message_id IS NOT NULL)
  );

COMMIT;
