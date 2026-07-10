-- Remove authenticated chat feedback collection.
-- Revert with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0004_feedback.down.sql

BEGIN;

DROP TABLE IF EXISTS feedback_images;
DROP TABLE IF EXISTS feedbacks;

COMMIT;
