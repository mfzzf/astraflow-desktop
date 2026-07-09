-- Roll back expert list ordering indexes.
-- Apply with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0003_expert_list_sort_indexes.down.sql

BEGIN;

DROP INDEX IF EXISTS idx_experts_name_sort;
DROP INDEX IF EXISTS idx_experts_updated_id;

COMMIT;
