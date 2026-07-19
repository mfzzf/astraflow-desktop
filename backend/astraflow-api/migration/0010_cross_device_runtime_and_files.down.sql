BEGIN;

DROP TABLE IF EXISTS push_notifications;
DROP TABLE IF EXISTS artifact_shares;
DROP INDEX IF EXISTS idx_artifacts_run_created;
DROP INDEX IF EXISTS idx_artifacts_session_created;
DROP INDEX IF EXISTS idx_artifacts_object_key;
DROP TABLE IF EXISTS artifact_uploads;
DROP INDEX IF EXISTS idx_cloud_runs_claim;
DROP INDEX IF EXISTS idx_cloud_workspaces_claim;

ALTER TABLE agent_runs
  DROP COLUMN IF EXISTS lease_token_hash;

ALTER TABLE workspaces
  DROP COLUMN IF EXISTS last_error,
  DROP COLUMN IF EXISTS lease_token_hash,
  DROP COLUMN IF EXISTS lease_expires_at,
  DROP COLUMN IF EXISTS lease_owner;

COMMIT;
