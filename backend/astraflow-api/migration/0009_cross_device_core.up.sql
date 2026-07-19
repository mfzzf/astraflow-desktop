-- Durable cross-device control-plane schema for Desktop, Android, and Agent workers.
-- Apply with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0009_cross_device_core.up.sql

BEGIN;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  tenant_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, subject),
  CHECK (status IN ('active', 'suspended', 'deleted'))
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  app_version TEXT NOT NULL DEFAULT '',
  protocol_version INTEGER NOT NULL DEFAULT 1,
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  public_key TEXT NOT NULL DEFAULT '',
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (type IN ('desktop', 'mobile', 'worker')),
  CHECK (protocol_version > 0),
  CHECK (version > 0)
);
CREATE INDEX IF NOT EXISTS idx_devices_account_updated
  ON devices(account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS device_connection_tokens (
  token_hash BYTEA PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_device_connection_tokens_expiry
  ON device_connection_tokens(expires_at);

CREATE TABLE IF NOT EXISTS push_endpoints (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  token_ciphertext BYTEA NOT NULL,
  token_nonce BYTEA NOT NULL,
  locale TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (device_id, provider),
  CHECK (provider IN ('fcm', 'apns', 'expo'))
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'empty',
  repo_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  sandbox_id TEXT NOT NULL DEFAULT '',
  gateway_protocol_version INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'ready',
  owner_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (type IN ('local_ref', 'sandbox')),
  CHECK (state IN ('creating', 'ready', 'paused', 'unavailable', 'deleted'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_account_sandbox
  ON workspaces(account_id, sandbox_id) WHERE sandbox_id <> '';

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  mode TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  runtime_id TEXT NOT NULL DEFAULT 'astraflow',
  model TEXT NOT NULL DEFAULT '',
  reasoning_effort TEXT NOT NULL DEFAULT '',
  permission_mode TEXT NOT NULL DEFAULT 'default',
  version BIGINT NOT NULL DEFAULT 1,
  pinned_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CHECK (mode IN ('chat', 'image', 'video', 'audio')),
  CHECK (version > 0)
);
CREATE INDEX IF NOT EXISTS idx_sessions_account_updated
  ON sessions(account_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  content_projection JSONB NOT NULL DEFAULT '{}'::jsonb,
  parts_projection JSONB NOT NULL DEFAULT '[]'::jsonb,
  client_mutation_id TEXT NOT NULL DEFAULT '',
  source_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  CHECK (status IN ('pending', 'streaming', 'completed', 'failed', 'cancelled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_account_mutation
  ON messages(account_id, client_mutation_id) WHERE client_mutation_id <> '';
CREATE INDEX IF NOT EXISTS idx_messages_session_created
  ON messages(session_id, created_at, id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  execution_target TEXT NOT NULL,
  target_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  runtime_id TEXT NOT NULL DEFAULT 'astraflow',
  model TEXT NOT NULL DEFAULT '',
  reasoning_effort TEXT NOT NULL DEFAULT '',
  permission_mode TEXT NOT NULL DEFAULT 'default',
  runtime_session_ref TEXT NOT NULL DEFAULT '',
  lease_owner TEXT NOT NULL DEFAULT '',
  lease_expires_at TIMESTAMPTZ,
  last_event_seq BIGINT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (execution_target IN ('cloud', 'desktop')),
  CHECK (status IN ('queued', 'waiting_device', 'running', 'waiting_approval', 'waiting_input', 'completed', 'failed', 'cancelled')),
  CHECK (last_event_seq >= 0),
  CHECK ((execution_target = 'desktop' AND target_device_id IS NOT NULL) OR execution_target = 'cloud')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_one_active_session
  ON agent_runs(session_id)
  WHERE status IN ('queued', 'waiting_device', 'running', 'waiting_approval', 'waiting_input');
CREATE INDEX IF NOT EXISTS idx_agent_runs_account_updated
  ON agent_runs(account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_run_events (
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  seq BIGINT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  producer_type TEXT NOT NULL,
  producer_id TEXT NOT NULL DEFAULT '',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, seq),
  CHECK (seq > 0),
  CHECK (producer_type IN ('desktop', 'worker', 'server'))
);
CREATE INDEX IF NOT EXISTS idx_agent_run_events_account_created
  ON agent_run_events(account_id, created_at);

CREATE TABLE IF NOT EXISTS agent_actions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  event_seq BIGINT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolution_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (type IN ('permission', 'user_input')),
  CHECK (status IN ('pending', 'approved', 'denied', 'submitted', 'expired')),
  CHECK (version > 0),
  UNIQUE (run_id, event_seq, type)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size BIGINT NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  object_key TEXT NOT NULL,
  source_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  retention_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (size >= 0)
);

CREATE TABLE IF NOT EXISTS device_commands (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES agent_runs(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CHECK (status IN ('pending', 'leased', 'acknowledged', 'completed', 'failed', 'cancelled')),
  CHECK (attempts >= 0)
);
CREATE INDEX IF NOT EXISTS idx_device_commands_delivery
  ON device_commands(device_id, status, created_at);

CREATE TABLE IF NOT EXISTS sync_events (
  cursor BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_version BIGINT NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (entity_version >= 0)
);
CREATE INDEX IF NOT EXISTS idx_sync_events_account_cursor
  ON sync_events(account_id, cursor);

CREATE TABLE IF NOT EXISTS client_mutations (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  device_id TEXT,
  client_mutation_id TEXT NOT NULL,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, client_mutation_id)
);

COMMIT;
