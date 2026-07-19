-- Roll back the durable cross-device control-plane schema.
-- Apply with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0009_cross_device_core.down.sql

BEGIN;

DROP TABLE IF EXISTS client_mutations;
DROP TABLE IF EXISTS sync_events;
DROP TABLE IF EXISTS device_commands;
DROP TABLE IF EXISTS artifacts;
DROP TABLE IF EXISTS agent_actions;
DROP TABLE IF EXISTS agent_run_events;
DROP TABLE IF EXISTS agent_runs;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS workspaces;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS push_endpoints;
DROP TABLE IF EXISTS device_connection_tokens;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS accounts;

COMMIT;
