-- Remove centrally managed channels and feedback workflow fields.
-- Apply with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0007_channel_management.down.sql

BEGIN;

DROP TABLE IF EXISTS channel_oauth_flows;
DROP TABLE IF EXISTS distribution_channels;

DROP INDEX IF EXISTS idx_feedbacks_channel_created;
DROP INDEX IF EXISTS idx_feedbacks_status_created;

ALTER TABLE feedbacks
  DROP CONSTRAINT IF EXISTS feedbacks_status_check,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS admin_note,
  DROP COLUMN IF EXISTS assignee,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS channel_slug;

COMMIT;
