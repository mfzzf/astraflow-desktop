-- Account-scoped cloud automations. Each occurrence materializes a normal
-- session/message/cloud run so mobile, Desktop, push, and sync share one history.

BEGIN;

CREATE TABLE IF NOT EXISTS cloud_automations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  runtime_id TEXT NOT NULL DEFAULT 'astraflow',
  model TEXT NOT NULL DEFAULT '',
  reasoning_effort TEXT NOT NULL DEFAULT '',
  permission_mode TEXT NOT NULL DEFAULT 'default',
  schedule_kind TEXT NOT NULL,
  schedule_expression TEXT NOT NULL,
  time_zone TEXT NOT NULL DEFAULT 'UTC',
  enabled BOOLEAN NOT NULL DEFAULT true,
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  version BIGINT NOT NULL DEFAULT 1,
  source_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  client_mutation_id TEXT NOT NULL DEFAULT '',
  lease_owner TEXT NOT NULL DEFAULT '',
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (schedule_kind IN ('once', 'daily', 'interval')),
  CHECK (version > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_automations_account_mutation
  ON cloud_automations(account_id, client_mutation_id)
  WHERE client_mutation_id <> '';
CREATE INDEX IF NOT EXISTS idx_cloud_automations_account_updated
  ON cloud_automations(account_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cloud_automations_due
  ON cloud_automations(next_run_at, created_at)
  WHERE enabled AND next_run_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS cloud_automation_runs (
  automation_id TEXT NOT NULL REFERENCES cloud_automations(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (automation_id, scheduled_for),
  UNIQUE (run_id)
);
CREATE INDEX IF NOT EXISTS idx_cloud_automation_runs_automation
  ON cloud_automation_runs(automation_id, created_at DESC);

COMMIT;
