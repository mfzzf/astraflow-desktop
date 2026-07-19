-- Cloud worker leases, direct object-storage uploads, revocable shares, and
-- durable push delivery for the cross-device runtime.

BEGIN;

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS lease_owner TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_token_hash BYTEA,
  ADD COLUMN IF NOT EXISTS last_error TEXT NOT NULL DEFAULT '';

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS lease_token_hash BYTEA;

CREATE INDEX IF NOT EXISTS idx_cloud_workspaces_claim
  ON workspaces(state, lease_expires_at, created_at)
  WHERE type = 'sandbox' AND state = 'creating';

CREATE INDEX IF NOT EXISTS idx_cloud_runs_claim
  ON agent_runs(status, lease_expires_at, created_at)
  WHERE execution_target = 'cloud'
    AND status IN ('queued', 'running', 'waiting_approval', 'waiting_input');

CREATE TABLE IF NOT EXISTS artifact_uploads (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  artifact_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  source_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  client_mutation_id TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('pending', 'completed', 'expired', 'failed')),
  CHECK (size >= 0),
  CHECK (char_length(sha256) = 64)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_artifact_uploads_account_mutation
  ON artifact_uploads(account_id, client_mutation_id)
  WHERE client_mutation_id <> '';
CREATE INDEX IF NOT EXISTS idx_artifact_uploads_expiry
  ON artifact_uploads(status, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_object_key
  ON artifacts(object_key);
CREATE INDEX IF NOT EXISTS idx_artifacts_session_created
  ON artifacts(account_id, session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_run_created
  ON artifacts(account_id, run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS artifact_shares (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_artifact_shares_artifact
  ON artifact_shares(account_id, artifact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS push_notifications (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  push_endpoint_id TEXT NOT NULL REFERENCES push_endpoints(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES agent_runs(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK (status IN ('pending', 'leased', 'completed', 'failed')),
  CHECK (attempts >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_notifications_endpoint_dedupe
  ON push_notifications(push_endpoint_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_push_notifications_delivery
  ON push_notifications(status, next_attempt_at, created_at);

COMMIT;
