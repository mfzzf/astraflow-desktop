-- Roll back AstraFlow API PostgreSQL migration 0001.
-- Apply with:
--   psql "postgresql://astraflow_app:AstraFlow123@10.100.17.196/astraflow" -v ON_ERROR_STOP=1 -f 0001_expert_system.down.sql

BEGIN;

DROP TABLE IF EXISTS expert_import_runs;
DROP TABLE IF EXISTS expert_team_members;
DROP TABLE IF EXISTS expert_mcp_servers;
DROP TABLE IF EXISTS expert_skills;
DROP TABLE IF EXISTS expert_agents;
DROP TABLE IF EXISTS experts;
DROP TABLE IF EXISTS expert_categories;

COMMIT;
