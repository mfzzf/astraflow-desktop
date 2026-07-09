-- Add indexes for expert list ordering.
-- Apply with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0003_expert_list_sort_indexes.up.sql

BEGIN;

CREATE INDEX IF NOT EXISTS idx_experts_updated_id
  ON experts(updated_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_experts_name_sort
  ON experts(LOWER(COALESCE(NULLIF(display_name_zh, ''), NULLIF(display_name_en, ''), id)), id);

COMMIT;
