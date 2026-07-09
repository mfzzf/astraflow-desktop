-- AstraFlow API PostgreSQL migration 0001.
-- Apply with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0001_expert_system.up.sql

BEGIN;

CREATE TABLE IF NOT EXISTS expert_categories (
  id TEXT PRIMARY KEY,
  name_zh TEXT NOT NULL DEFAULT '',
  name_en TEXT NOT NULL DEFAULT '',
  description_zh TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  expert_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS experts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'workbuddy',
  source_folder TEXT NOT NULL DEFAULT '',
  source_plugin JSONB NOT NULL DEFAULT '{}'::jsonb,
  type TEXT NOT NULL DEFAULT 'agent',
  status TEXT NOT NULL DEFAULT 'metadata_only',
  category_id TEXT NOT NULL DEFAULT '',
  display_name_zh TEXT NOT NULL DEFAULT '',
  display_name_en TEXT NOT NULL DEFAULT '',
  profession_zh TEXT NOT NULL DEFAULT '',
  profession_en TEXT NOT NULL DEFAULT '',
  description_zh TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT '',
  avatar_path TEXT NOT NULL DEFAULT '',
  tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  quick_prompts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_init_prompt_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  downloaded_file_count INTEGER NOT NULL DEFAULT 0,
  prompt_count INTEGER NOT NULL DEFAULT 0,
  skill_file_count INTEGER NOT NULL DEFAULT 0,
  mcp_file_count INTEGER NOT NULL DEFAULT 0,
  member_count INTEGER NOT NULL DEFAULT 0,
  runtime_hash TEXT NOT NULL DEFAULT '',
  search_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expert_agents (
  id TEXT PRIMARY KEY,
  expert_id TEXT NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'single',
  display_name_zh TEXT NOT NULL DEFAULT '',
  display_name_en TEXT NOT NULL DEFAULT '',
  profession_zh TEXT NOT NULL DEFAULT '',
  profession_en TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  prompt_markdown TEXT NOT NULL DEFAULT '',
  frontmatter_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  skills_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  max_turns INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expert_skills (
  id TEXT PRIMARY KEY,
  expert_id TEXT NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
  skill_slug TEXT NOT NULL DEFAULT '',
  relative_path TEXT NOT NULL DEFAULT '',
  skill_md TEXT NOT NULL DEFAULT '',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_hash TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expert_mcp_servers (
  id TEXT PRIMARY KEY,
  expert_id TEXT NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL DEFAULT '',
  mcp_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  server_count INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expert_team_members (
  id TEXT PRIMARY KEY,
  expert_id TEXT NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member',
  display_name_zh TEXT NOT NULL DEFAULT '',
  display_name_en TEXT NOT NULL DEFAULT '',
  profession_zh TEXT NOT NULL DEFAULT '',
  profession_en TEXT NOT NULL DEFAULT '',
  avatar_path TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expert_import_runs (
  id TEXT PRIMARY KEY,
  source_path TEXT NOT NULL DEFAULT '',
  source_generated_at TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  expert_count INTEGER NOT NULL DEFAULT 0,
  downloaded_count INTEGER NOT NULL DEFAULT 0,
  metadata_only_count INTEGER NOT NULL DEFAULT 0,
  prompt_count INTEGER NOT NULL DEFAULT 0,
  skill_count INTEGER NOT NULL DEFAULT 0,
  mcp_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_experts_slug ON experts(slug);
CREATE INDEX IF NOT EXISTS idx_experts_category_status ON experts(category_id, status);
CREATE INDEX IF NOT EXISTS idx_experts_type_status ON experts(type, status);
CREATE INDEX IF NOT EXISTS idx_experts_runtime_hash ON experts(runtime_hash);
CREATE INDEX IF NOT EXISTS idx_experts_updated_id ON experts(updated_at DESC, id ASC);
CREATE INDEX IF NOT EXISTS idx_experts_name_sort ON experts(LOWER(COALESCE(NULLIF(display_name_zh, ''), NULLIF(display_name_en, ''), id)), id);
CREATE INDEX IF NOT EXISTS idx_expert_agents_expert_sort ON expert_agents(expert_id, sort_order, agent_name);
CREATE INDEX IF NOT EXISTS idx_expert_skills_expert_slug ON expert_skills(expert_id, skill_slug);
CREATE INDEX IF NOT EXISTS idx_expert_mcp_expert ON expert_mcp_servers(expert_id);
CREATE INDEX IF NOT EXISTS idx_expert_team_members_expert_sort ON expert_team_members(expert_id, sort_order);

COMMIT;
