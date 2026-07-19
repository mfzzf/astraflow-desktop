-- Add feedback workflow fields and centrally managed distribution channels.
-- Apply with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0007_channel_management.up.sql

BEGIN;

ALTER TABLE feedbacks
  ADD COLUMN IF NOT EXISTS channel_slug TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS assignee TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS admin_note TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE feedbacks
  DROP CONSTRAINT IF EXISTS feedbacks_status_check;

ALTER TABLE feedbacks
  ADD CONSTRAINT feedbacks_status_check
  CHECK (status IN ('new', 'reviewing', 'resolved', 'closed'));

CREATE INDEX IF NOT EXISTS idx_feedbacks_status_created
  ON feedbacks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedbacks_channel_created
  ON feedbacks(channel_slug, created_at DESC);

CREATE TABLE IF NOT EXISTS distribution_channels (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'disabled')),
  oauth_client_id TEXT NOT NULL DEFAULT '',
  oauth_client_secret_ciphertext BYTEA,
  oauth_client_secret_nonce BYTEA,
  enabled_features TEXT[] NOT NULL DEFAULT ARRAY[
    'models', 'skills', 'automations', 'mobile', 'codebox', 'files',
    'chat', 'image', 'video', 'audio'
  ]::TEXT[],
  restrict_models BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_model_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (oauth_client_secret_ciphertext IS NULL AND oauth_client_secret_nonce IS NULL)
    OR
    (oauth_client_secret_ciphertext IS NOT NULL AND oauth_client_secret_nonce IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_distribution_channels_status_updated
  ON distribution_channels(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS channel_oauth_flows (
  state_hash TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES distribution_channels(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channel_oauth_flows_expiry
  ON channel_oauth_flows(expires_at);

COMMIT;
