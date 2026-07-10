-- Restore mandatory chat snapshots for every feedback record.
-- Sessionless feedback created after the up migration cannot fit the old schema
-- and is removed during rollback.
-- Roll back with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0005_feedback_optional_session.down.sql

BEGIN;

ALTER TABLE feedbacks
  DROP CONSTRAINT IF EXISTS feedbacks_message_entry_check,
  DROP CONSTRAINT IF EXISTS feedbacks_session_snapshot_check;

DELETE FROM feedbacks
WHERE session_id IS NULL OR messages IS NULL;

ALTER TABLE feedbacks
  ALTER COLUMN session_id SET NOT NULL,
  ALTER COLUMN messages SET NOT NULL;

COMMIT;
