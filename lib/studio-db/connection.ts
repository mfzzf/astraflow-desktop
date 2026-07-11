import Database from "better-sqlite3"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

let db: Database.Database | undefined
let codeBoxSandboxOwnerColumnsReady = false

export type SqliteColumnDefinition = {
  name: string
  definition: string
}

const studioTableColumns = {
  studio_sessions: [
    { name: "id", definition: "id TEXT" },
    { name: "mode", definition: "mode TEXT NOT NULL DEFAULT 'chat'" },
    { name: "title", definition: "title TEXT NOT NULL DEFAULT 'New chat'" },
    { name: "project_id", definition: "project_id TEXT" },
    {
      name: "permission_mode",
      definition: "permission_mode TEXT NOT NULL DEFAULT 'ask'",
    },
    { name: "chat_model", definition: "chat_model TEXT" },
    { name: "chat_runtime_id", definition: "chat_runtime_id TEXT" },
    { name: "chat_reasoning_effort", definition: "chat_reasoning_effort TEXT" },
    { name: "latest_run_usage", definition: "latest_run_usage TEXT" },
    { name: "available_commands", definition: "available_commands TEXT" },
    { name: "pinned_at", definition: "pinned_at TEXT" },
    { name: "archived_at", definition: "archived_at TEXT" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
    { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_local_projects: [
    { name: "id", definition: "id TEXT" },
    { name: "name", definition: "name TEXT NOT NULL DEFAULT ''" },
    { name: "path", definition: "path TEXT NOT NULL DEFAULT ''" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
    { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
    { name: "last_opened_at", definition: "last_opened_at TEXT" },
  ],
  studio_messages: [
    { name: "id", definition: "id TEXT" },
    { name: "session_id", definition: "session_id TEXT NOT NULL DEFAULT ''" },
    { name: "role", definition: "role TEXT NOT NULL DEFAULT 'assistant'" },
    { name: "content", definition: "content TEXT NOT NULL DEFAULT ''" },
    { name: "mentions", definition: "mentions TEXT" },
    { name: "model", definition: "model TEXT" },
    { name: "environment", definition: "environment TEXT" },
    { name: "version_group_id", definition: "version_group_id TEXT" },
    {
      name: "version_index",
      definition: "version_index INTEGER NOT NULL DEFAULT 1",
    },
    {
      name: "active_version",
      definition: "active_version INTEGER NOT NULL DEFAULT 1",
    },
    { name: "activities", definition: "activities TEXT" },
    { name: "parts", definition: "parts TEXT" },
    {
      name: "reasoning_content",
      definition: "reasoning_content TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "reasoning_duration_ms",
      definition: "reasoning_duration_ms INTEGER",
    },
    { name: "status", definition: "status TEXT NOT NULL DEFAULT 'complete'" },
    { name: "attachments", definition: "attachments TEXT" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_agent_provider_events: [
    { name: "id", definition: "id TEXT" },
    { name: "session_id", definition: "session_id TEXT NOT NULL DEFAULT ''" },
    { name: "run_id", definition: "run_id TEXT" },
    { name: "assistant_message_id", definition: "assistant_message_id TEXT" },
    { name: "runtime_id", definition: "runtime_id TEXT NOT NULL DEFAULT ''" },
    { name: "provider", definition: "provider TEXT NOT NULL DEFAULT ''" },
    {
      name: "direction",
      definition: "direction TEXT NOT NULL DEFAULT 'output'",
    },
    { name: "event_type", definition: "event_type TEXT NOT NULL DEFAULT ''" },
    { name: "provider_ref", definition: "provider_ref TEXT" },
    { name: "provider_session_id", definition: "provider_session_id TEXT" },
    { name: "thread_id", definition: "thread_id TEXT" },
    { name: "turn_id", definition: "turn_id TEXT" },
    { name: "item_id", definition: "item_id TEXT" },
    { name: "parent_thread_id", definition: "parent_thread_id TEXT" },
    { name: "schema_version", definition: "schema_version TEXT" },
    { name: "package_version", definition: "package_version TEXT" },
    { name: "payload", definition: "payload TEXT NOT NULL DEFAULT 'null'" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_settings: [
    { name: "key", definition: "key TEXT" },
    { name: "value", definition: "value TEXT NOT NULL DEFAULT ''" },
    { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_permission_rules: [
    { name: "id", definition: "id TEXT" },
    { name: "project_id", definition: "project_id TEXT" },
    { name: "tool_name", definition: "tool_name TEXT NOT NULL DEFAULT ''" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_session_sandboxes: [
    { name: "session_id", definition: "session_id TEXT" },
    { name: "sandbox_id", definition: "sandbox_id TEXT NOT NULL DEFAULT ''" },
    { name: "sandbox_domain", definition: "sandbox_domain TEXT" },
    { name: "template", definition: "template TEXT NOT NULL DEFAULT ''" },
    { name: "status", definition: "status TEXT NOT NULL DEFAULT 'unknown'" },
    {
      name: "auto_pause_timeout_seconds",
      definition: "auto_pause_timeout_seconds INTEGER NOT NULL DEFAULT 300",
    },
    { name: "volume_id", definition: "volume_id TEXT" },
    { name: "volume_name", definition: "volume_name TEXT" },
    { name: "volume_path", definition: "volume_path TEXT" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
    { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
    {
      name: "last_used_at",
      definition: "last_used_at TEXT NOT NULL DEFAULT ''",
    },
  ],
  studio_session_files: [
    { name: "id", definition: "id TEXT" },
    { name: "session_id", definition: "session_id TEXT NOT NULL DEFAULT ''" },
    { name: "message_id", definition: "message_id TEXT" },
    { name: "kind", definition: "kind TEXT NOT NULL DEFAULT 'attachment'" },
    {
      name: "original_name",
      definition: "original_name TEXT NOT NULL DEFAULT ''",
    },
    { name: "mime_type", definition: "mime_type TEXT" },
    { name: "size", definition: "size INTEGER" },
    {
      name: "storage_path",
      definition: "storage_path TEXT NOT NULL DEFAULT ''",
    },
    { name: "sandbox_path", definition: "sandbox_path TEXT" },
    { name: "source_tool_call_id", definition: "source_tool_call_id TEXT" },
    { name: "saved_at", definition: "saved_at TEXT" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
    { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_installed_skills: [
    { name: "slug", definition: "slug TEXT" },
    { name: "version", definition: "version TEXT NOT NULL DEFAULT ''" },
    { name: "skill_meta", definition: "skill_meta TEXT NOT NULL DEFAULT '{}'" },
    { name: "skill_md", definition: "skill_md TEXT NOT NULL DEFAULT ''" },
    { name: "enabled", definition: "enabled INTEGER NOT NULL DEFAULT 1" },
    {
      name: "install_path",
      definition: "install_path TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "installed_file_count",
      definition: "installed_file_count INTEGER NOT NULL DEFAULT 0",
    },
    {
      name: "installed_size_bytes",
      definition: "installed_size_bytes INTEGER NOT NULL DEFAULT 0",
    },
    {
      name: "installed_at",
      definition: "installed_at TEXT NOT NULL DEFAULT ''",
    },
    { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_session_skill_syncs: [
    { name: "session_id", definition: "session_id TEXT NOT NULL DEFAULT ''" },
    { name: "slug", definition: "slug TEXT NOT NULL DEFAULT ''" },
    { name: "version", definition: "version TEXT NOT NULL DEFAULT ''" },
    { name: "sandbox_id", definition: "sandbox_id TEXT NOT NULL DEFAULT ''" },
    {
      name: "sandbox_path",
      definition: "sandbox_path TEXT NOT NULL DEFAULT ''",
    },
    { name: "synced_at", definition: "synced_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_expert_catalog_cache: [
    { name: "key", definition: "key TEXT" },
    { name: "catalog_hash", definition: "catalog_hash TEXT NOT NULL DEFAULT ''" },
    {
      name: "catalog_version",
      definition: "catalog_version TEXT NOT NULL DEFAULT ''",
    },
    { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
    { name: "categories_json", definition: "categories_json TEXT NOT NULL DEFAULT '[]'" },
    { name: "experts_json", definition: "experts_json TEXT NOT NULL DEFAULT '[]'" },
    { name: "cached_at", definition: "cached_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_expert_detail_cache: [
    { name: "expert_id", definition: "expert_id TEXT" },
    { name: "runtime_hash", definition: "runtime_hash TEXT NOT NULL DEFAULT ''" },
    { name: "detail_json", definition: "detail_json TEXT NOT NULL DEFAULT '{}'" },
    { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
    { name: "cached_at", definition: "cached_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_session_experts: [
    { name: "session_id", definition: "session_id TEXT" },
    { name: "expert_id", definition: "expert_id TEXT NOT NULL DEFAULT ''" },
    { name: "expert_type", definition: "expert_type TEXT NOT NULL DEFAULT 'agent'" },
    { name: "runtime_hash", definition: "runtime_hash TEXT NOT NULL DEFAULT ''" },
    { name: "snapshot_json", definition: "snapshot_json TEXT NOT NULL DEFAULT '{}'" },
    { name: "selected_at", definition: "selected_at TEXT NOT NULL DEFAULT ''" },
  ],
  codebox_volumes: [
    { name: "volume_id", definition: "volume_id TEXT" },
    { name: "name", definition: "name TEXT NOT NULL DEFAULT ''" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
    {
      name: "last_seen_at",
      definition: "last_seen_at TEXT NOT NULL DEFAULT ''",
    },
  ],
  codebox_sandboxes: [
    { name: "sandbox_id", definition: "sandbox_id TEXT" },
    { name: "name", definition: "name TEXT" },
    { name: "owner_key", definition: "owner_key TEXT" },
    { name: "owner_email", definition: "owner_email TEXT" },
    { name: "company_id", definition: "company_id TEXT" },
    { name: "project_id", definition: "project_id TEXT" },
    { name: "volume_id", definition: "volume_id TEXT" },
    { name: "volume_name", definition: "volume_name TEXT" },
    { name: "sandbox_domain", definition: "sandbox_domain TEXT" },
    { name: "template", definition: "template TEXT NOT NULL DEFAULT ''" },
    { name: "status", definition: "status TEXT NOT NULL DEFAULT 'unknown'" },
    { name: "code_server_url", definition: "code_server_url TEXT" },
    { name: "code_server_host", definition: "code_server_host TEXT" },
    {
      name: "code_server_port",
      definition: "code_server_port INTEGER NOT NULL DEFAULT 0",
    },
    { name: "password", definition: "password TEXT" },
    {
      name: "workspace_path",
      definition: "workspace_path TEXT NOT NULL DEFAULT ''",
    },
    { name: "repo_url", definition: "repo_url TEXT" },
    { name: "started_at", definition: "started_at TEXT" },
    { name: "end_at", definition: "end_at TEXT" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
    { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
    {
      name: "last_used_at",
      definition: "last_used_at TEXT NOT NULL DEFAULT ''",
    },
  ],
  studio_mcp_servers: [
    { name: "id", definition: "id TEXT" },
    { name: "name", definition: "name TEXT NOT NULL DEFAULT ''" },
    { name: "title", definition: "title TEXT NOT NULL DEFAULT ''" },
    {
      name: "description",
      definition: "description TEXT NOT NULL DEFAULT ''",
    },
    { name: "source", definition: "source TEXT NOT NULL DEFAULT ''" },
    { name: "registry_name", definition: "registry_name TEXT" },
    { name: "registry_version", definition: "registry_version TEXT" },
    {
      name: "transport",
      definition: "transport TEXT NOT NULL DEFAULT 'stdio'",
    },
    { name: "config", definition: "config TEXT NOT NULL DEFAULT '{}'" },
    {
      name: "capabilities",
      definition: "capabilities TEXT NOT NULL DEFAULT '{}'",
    },
    { name: "tools", definition: "tools TEXT NOT NULL DEFAULT '[]'" },
    { name: "resources", definition: "resources TEXT NOT NULL DEFAULT '[]'" },
    { name: "prompts", definition: "prompts TEXT NOT NULL DEFAULT '[]'" },
    { name: "enabled", definition: "enabled INTEGER NOT NULL DEFAULT 1" },
    { name: "last_connected_at", definition: "last_connected_at TEXT" },
    { name: "last_error", definition: "last_error TEXT" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
    { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_mcp_server_secrets: [
    { name: "server_id", definition: "server_id TEXT NOT NULL DEFAULT ''" },
    { name: "name", definition: "name TEXT NOT NULL DEFAULT ''" },
    { name: "value", definition: "value TEXT NOT NULL DEFAULT ''" },
    { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_mcp_registry_servers: [
    { name: "id", definition: "id TEXT" },
    { name: "name", definition: "name TEXT NOT NULL DEFAULT ''" },
    { name: "version", definition: "version TEXT NOT NULL DEFAULT ''" },
    { name: "title", definition: "title TEXT NOT NULL DEFAULT ''" },
    {
      name: "description",
      definition: "description TEXT NOT NULL DEFAULT ''",
    },
    { name: "status", definition: "status TEXT NOT NULL DEFAULT ''" },
    { name: "latest", definition: "latest INTEGER NOT NULL DEFAULT 0" },
    { name: "source", definition: "source TEXT NOT NULL DEFAULT 'official'" },
    { name: "transports", definition: "transports TEXT NOT NULL DEFAULT '[]'" },
    {
      name: "server_json",
      definition: "server_json TEXT NOT NULL DEFAULT '{}'",
    },
    {
      name: "registry_meta",
      definition: "registry_meta TEXT NOT NULL DEFAULT '{}'",
    },
    { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
    { name: "synced_at", definition: "synced_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_image_generations: [
    { name: "id", definition: "id TEXT" },
    { name: "session_id", definition: "session_id TEXT NOT NULL DEFAULT ''" },
    {
      name: "model_square_id",
      definition: "model_square_id TEXT NOT NULL DEFAULT ''",
    },
    { name: "model_name", definition: "model_name TEXT NOT NULL DEFAULT ''" },
    { name: "manufacturer", definition: "manufacturer TEXT" },
    { name: "openapi_file", definition: "openapi_file TEXT" },
    { name: "operation_id", definition: "operation_id TEXT" },
    { name: "prompt", definition: "prompt TEXT NOT NULL DEFAULT ''" },
    { name: "params", definition: "params TEXT NOT NULL DEFAULT '{}'" },
    { name: "status", definition: "status TEXT NOT NULL DEFAULT 'queued'" },
    { name: "phase", definition: "phase TEXT" },
    { name: "progress", definition: "progress REAL" },
    { name: "raw_status", definition: "raw_status TEXT" },
    { name: "attempt", definition: "attempt INTEGER NOT NULL DEFAULT 0" },
    { name: "last_polled_at", definition: "last_polled_at TEXT" },
    { name: "next_poll_at", definition: "next_poll_at TEXT" },
    { name: "lease_owner", definition: "lease_owner TEXT" },
    { name: "lease_expires_at", definition: "lease_expires_at TEXT" },
    { name: "error_message", definition: "error_message TEXT" },
    { name: "raw_response", definition: "raw_response TEXT" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
    { name: "completed_at", definition: "completed_at TEXT" },
  ],
  studio_image_outputs: [
    { name: "id", definition: "id TEXT" },
    {
      name: "generation_id",
      definition: "generation_id TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "output_index",
      definition: "output_index INTEGER NOT NULL DEFAULT 0",
    },
    { name: "url", definition: "url TEXT" },
    { name: "data_url", definition: "data_url TEXT" },
    { name: "storage_path", definition: "storage_path TEXT" },
    { name: "mime_type", definition: "mime_type TEXT" },
    { name: "width", definition: "width INTEGER" },
    { name: "height", definition: "height INTEGER" },
    { name: "metadata", definition: "metadata TEXT" },
    { name: "saved_at", definition: "saved_at TEXT" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_audio_generations: [
    { name: "id", definition: "id TEXT" },
    { name: "session_id", definition: "session_id TEXT NOT NULL DEFAULT ''" },
    {
      name: "model_square_id",
      definition: "model_square_id TEXT NOT NULL DEFAULT ''",
    },
    { name: "model_name", definition: "model_name TEXT NOT NULL DEFAULT ''" },
    { name: "manufacturer", definition: "manufacturer TEXT" },
    { name: "openapi_file", definition: "openapi_file TEXT" },
    { name: "operation_id", definition: "operation_id TEXT" },
    { name: "prompt", definition: "prompt TEXT NOT NULL DEFAULT ''" },
    { name: "params", definition: "params TEXT NOT NULL DEFAULT '{}'" },
    { name: "status", definition: "status TEXT NOT NULL DEFAULT 'queued'" },
    { name: "error_message", definition: "error_message TEXT" },
    { name: "raw_response", definition: "raw_response TEXT" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
    { name: "completed_at", definition: "completed_at TEXT" },
  ],
  studio_audio_outputs: [
    { name: "id", definition: "id TEXT" },
    {
      name: "generation_id",
      definition: "generation_id TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "output_index",
      definition: "output_index INTEGER NOT NULL DEFAULT 0",
    },
    { name: "url", definition: "url TEXT" },
    { name: "data_url", definition: "data_url TEXT" },
    { name: "storage_path", definition: "storage_path TEXT" },
    { name: "mime_type", definition: "mime_type TEXT" },
    { name: "duration_seconds", definition: "duration_seconds REAL" },
    { name: "metadata", definition: "metadata TEXT" },
    { name: "saved_at", definition: "saved_at TEXT" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_video_generations: [
    { name: "id", definition: "id TEXT" },
    { name: "session_id", definition: "session_id TEXT NOT NULL DEFAULT ''" },
    {
      name: "model_square_id",
      definition: "model_square_id TEXT NOT NULL DEFAULT ''",
    },
    { name: "model_name", definition: "model_name TEXT NOT NULL DEFAULT ''" },
    { name: "manufacturer", definition: "manufacturer TEXT" },
    { name: "openapi_file", definition: "openapi_file TEXT" },
    { name: "operation_id", definition: "operation_id TEXT" },
    { name: "provider_task_id", definition: "provider_task_id TEXT" },
    { name: "provider_request_id", definition: "provider_request_id TEXT" },
    { name: "prompt", definition: "prompt TEXT NOT NULL DEFAULT ''" },
    { name: "params", definition: "params TEXT NOT NULL DEFAULT '{}'" },
    { name: "status", definition: "status TEXT NOT NULL DEFAULT 'queued'" },
    { name: "phase", definition: "phase TEXT" },
    { name: "progress", definition: "progress REAL" },
    { name: "raw_status", definition: "raw_status TEXT" },
    { name: "attempt", definition: "attempt INTEGER NOT NULL DEFAULT 0" },
    { name: "last_polled_at", definition: "last_polled_at TEXT" },
    { name: "next_poll_at", definition: "next_poll_at TEXT" },
    { name: "lease_owner", definition: "lease_owner TEXT" },
    { name: "lease_expires_at", definition: "lease_expires_at TEXT" },
    { name: "error_message", definition: "error_message TEXT" },
    { name: "raw_response", definition: "raw_response TEXT" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
    { name: "completed_at", definition: "completed_at TEXT" },
  ],
  studio_video_outputs: [
    { name: "id", definition: "id TEXT" },
    {
      name: "generation_id",
      definition: "generation_id TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "output_index",
      definition: "output_index INTEGER NOT NULL DEFAULT 0",
    },
    { name: "url", definition: "url TEXT" },
    { name: "data_url", definition: "data_url TEXT" },
    { name: "storage_path", definition: "storage_path TEXT" },
    { name: "mime_type", definition: "mime_type TEXT" },
    { name: "width", definition: "width INTEGER" },
    { name: "height", definition: "height INTEGER" },
    { name: "duration_seconds", definition: "duration_seconds REAL" },
    { name: "metadata", definition: "metadata TEXT" },
    { name: "saved_at", definition: "saved_at TEXT" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
  ],
} satisfies Record<string, SqliteColumnDefinition[]>

function quoteSqliteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQLite identifier: ${identifier}`)
  }

  return `"${identifier}"`
}

export function ensureSqliteTableColumns(
  database: Database.Database,
  tableName: string,
  columns: SqliteColumnDefinition[]
) {
  const existingColumns = new Set(
    (
      database
        .prepare(`PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`)
        .all() as Array<{ name: string }>
    ).map((column) => column.name)
  )

  for (const column of columns) {
    if (existingColumns.has(column.name)) {
      continue
    }

    database.exec(
      `ALTER TABLE ${quoteSqliteIdentifier(tableName)} ADD COLUMN ${
        column.definition
      }`
    )
    existingColumns.add(column.name)
  }
}

export function ensureCodeBoxSandboxOwnerColumns(database = getDb()) {
  if (codeBoxSandboxOwnerColumnsReady) {
    return
  }

  ensureSqliteTableColumns(
    database,
    "codebox_sandboxes",
    studioTableColumns.codebox_sandboxes
  )
  ensureSchemaIndexes(database)

  codeBoxSandboxOwnerColumnsReady = true
}

function getDatabasePath() {
  return (
    process.env.ASTRAFLOW_SQLITE_PATH?.trim() ??
    join(process.cwd(), ".data", "astraflow.sqlite")
  )
}

function getDb() {
  if (db) {
    return db
  }

  const dbPath = getDatabasePath()
  mkdirSync(dirname(dbPath), { recursive: true })
  db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  db.pragma("synchronous = NORMAL")
  db.pragma("busy_timeout = 5000")
  db.pragma("foreign_keys = ON")
  initializeSchema(db)
  migrateSchema(db)
  ensureSchemaIndexes(db)
  reconcileInterruptedRuns(db)

  return db
}

export function getStudioDatabase() {
  return getDb()
}

function reconcileInterruptedRuns(database: Database.Database) {
  // Streaming state only lives in an in-memory map (see studio-chat-runner),
  // so any message still marked as streaming when the process starts is a
  // leftover from a crash or forced shutdown and can never resume.
  cancelInterruptedRunPendingPermissionParts(database)

  database
    .prepare(
      `
        UPDATE studio_messages
        SET status = 'error'
        WHERE status = 'streaming'
      `
    )
    .run()
}

type InterruptedRunMessagePartsRow = {
  id: string
  parts: string | null
}

function cancelInterruptedRunPendingPermissionParts(
  database: Database.Database
) {
  const rows = database
    .prepare(
      `
        SELECT id, parts
        FROM studio_messages
        WHERE status = 'streaming'
          AND parts IS NOT NULL
      `
    )
    .all() as InterruptedRunMessagePartsRow[]

  if (rows.length === 0) {
    return
  }

  const updateParts = database.prepare(
    `
      UPDATE studio_messages
      SET parts = ?
      WHERE id = ?
    `
  )

  const updateTransaction = database.transaction(
    (messages: InterruptedRunMessagePartsRow[]) => {
      for (const message of messages) {
        const nextParts = serializeCancelledPendingPermissionParts(
          message.parts
        )

        if (nextParts !== null) {
          updateParts.run(nextParts, message.id)
        }
      }
    }
  )

  updateTransaction(rows)
}

function serializeCancelledPendingPermissionParts(raw: string | null) {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as unknown

    if (!Array.isArray(parsed)) {
      return null
    }

    let changed = false
    const parts = parsed.map((part) => {
      if (typeof part !== "object" || part === null || Array.isArray(part)) {
        return part
      }

      const record = part as Record<string, unknown>

      if (record.type !== "permission" || record.status !== "pending") {
        return part
      }

      changed = true

      return {
        ...record,
        status: "cancelled",
      }
    })

    return changed ? JSON.stringify(parts) : null
  } catch {
    return null
  }
}

function initializeSchema(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS studio_sessions (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      title TEXT NOT NULL,
      project_id TEXT,
      permission_mode TEXT NOT NULL DEFAULT 'ask',
      chat_model TEXT,
      chat_runtime_id TEXT,
      chat_reasoning_effort TEXT,
      latest_run_usage TEXT,
      available_commands TEXT,
      pinned_at TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS studio_local_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_opened_at TEXT
    );

    CREATE TABLE IF NOT EXISTS studio_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      mentions TEXT,
      model TEXT,
      environment TEXT,
      version_group_id TEXT,
      version_index INTEGER NOT NULL DEFAULT 1,
      active_version INTEGER NOT NULL DEFAULT 1,
      activities TEXT,
      parts TEXT,
      reasoning_content TEXT NOT NULL DEFAULT '',
      reasoning_duration_ms INTEGER,
      status TEXT NOT NULL DEFAULT 'complete',
      attachments TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES studio_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS studio_agent_provider_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      run_id TEXT,
      assistant_message_id TEXT,
      runtime_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      direction TEXT NOT NULL,
      event_type TEXT NOT NULL,
      provider_ref TEXT,
      provider_session_id TEXT,
      thread_id TEXT,
      turn_id TEXT,
      item_id TEXT,
      parent_thread_id TEXT,
      schema_version TEXT,
      package_version TEXT,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES studio_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (assistant_message_id) REFERENCES studio_messages(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS studio_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS studio_permission_rules (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      tool_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(project_id, tool_name)
    );

    CREATE TABLE IF NOT EXISTS studio_session_sandboxes (
      session_id TEXT PRIMARY KEY,
      sandbox_id TEXT NOT NULL,
      sandbox_domain TEXT,
      template TEXT NOT NULL,
      status TEXT NOT NULL,
      auto_pause_timeout_seconds INTEGER NOT NULL,
      volume_id TEXT,
      volume_name TEXT,
      volume_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES studio_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS studio_session_files (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message_id TEXT,
      kind TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      storage_path TEXT NOT NULL,
      sandbox_path TEXT,
      source_tool_call_id TEXT,
      saved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES studio_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES studio_messages(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS studio_installed_skills (
      slug TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      skill_meta TEXT NOT NULL,
      skill_md TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      install_path TEXT NOT NULL,
      installed_file_count INTEGER NOT NULL DEFAULT 0,
      installed_size_bytes INTEGER NOT NULL DEFAULT 0,
      installed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS studio_session_skill_syncs (
      session_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      version TEXT NOT NULL,
      sandbox_id TEXT NOT NULL,
      sandbox_path TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      PRIMARY KEY (session_id, slug),
      FOREIGN KEY (session_id) REFERENCES studio_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (slug) REFERENCES studio_installed_skills(slug) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS studio_expert_catalog_cache (
      key TEXT PRIMARY KEY,
      catalog_hash TEXT NOT NULL,
      catalog_version TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      categories_json TEXT NOT NULL,
      experts_json TEXT NOT NULL,
      cached_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS studio_expert_detail_cache (
      expert_id TEXT PRIMARY KEY,
      runtime_hash TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      cached_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS studio_session_experts (
      session_id TEXT PRIMARY KEY,
      expert_id TEXT NOT NULL,
      expert_type TEXT NOT NULL,
      runtime_hash TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      selected_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES studio_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS codebox_volumes (
      volume_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS codebox_sandboxes (
      sandbox_id TEXT PRIMARY KEY,
      name TEXT,
      owner_key TEXT,
      owner_email TEXT,
      company_id TEXT,
      project_id TEXT,
      volume_id TEXT,
      volume_name TEXT,
      sandbox_domain TEXT,
      template TEXT NOT NULL,
      status TEXT NOT NULL,
      code_server_url TEXT,
      code_server_host TEXT,
      code_server_port INTEGER NOT NULL,
      password TEXT,
      workspace_path TEXT NOT NULL,
      repo_url TEXT,
      started_at TEXT,
      end_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS studio_mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      registry_name TEXT,
      registry_version TEXT,
      transport TEXT NOT NULL,
      config TEXT NOT NULL,
      capabilities TEXT NOT NULL DEFAULT '{}',
      tools TEXT NOT NULL DEFAULT '[]',
      resources TEXT NOT NULL DEFAULT '[]',
      prompts TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_connected_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS studio_mcp_server_secrets (
      server_id TEXT NOT NULL,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (server_id, name),
      FOREIGN KEY (server_id) REFERENCES studio_mcp_servers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS studio_mcp_registry_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      latest INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'official',
      transports TEXT NOT NULL DEFAULT '[]',
      server_json TEXT NOT NULL,
      registry_meta TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS studio_image_generations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      model_square_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      manufacturer TEXT,
      openapi_file TEXT,
      operation_id TEXT,
      prompt TEXT NOT NULL,
      params TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT,
      progress REAL,
      raw_status TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      last_polled_at TEXT,
      next_poll_at TEXT,
      lease_owner TEXT,
      lease_expires_at TEXT,
      error_message TEXT,
      raw_response TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (session_id) REFERENCES studio_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS studio_image_outputs (
      id TEXT PRIMARY KEY,
      generation_id TEXT NOT NULL,
      output_index INTEGER NOT NULL,
      url TEXT,
      data_url TEXT,
      storage_path TEXT,
      mime_type TEXT,
      width INTEGER,
      height INTEGER,
      metadata TEXT,
      saved_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (generation_id) REFERENCES studio_image_generations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS studio_audio_generations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      model_square_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      manufacturer TEXT,
      openapi_file TEXT,
      operation_id TEXT,
      prompt TEXT NOT NULL,
      params TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      raw_response TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (session_id) REFERENCES studio_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS studio_audio_outputs (
      id TEXT PRIMARY KEY,
      generation_id TEXT NOT NULL,
      output_index INTEGER NOT NULL,
      url TEXT,
      data_url TEXT,
      storage_path TEXT,
      mime_type TEXT,
      duration_seconds REAL,
      metadata TEXT,
      saved_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (generation_id) REFERENCES studio_audio_generations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS studio_video_generations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      model_square_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      manufacturer TEXT,
      openapi_file TEXT,
      operation_id TEXT,
      provider_task_id TEXT,
      provider_request_id TEXT,
      prompt TEXT NOT NULL,
      params TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT,
      progress REAL,
      raw_status TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      last_polled_at TEXT,
      next_poll_at TEXT,
      lease_owner TEXT,
      lease_expires_at TEXT,
      error_message TEXT,
      raw_response TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (session_id) REFERENCES studio_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS studio_video_outputs (
      id TEXT PRIMARY KEY,
      generation_id TEXT NOT NULL,
      output_index INTEGER NOT NULL,
      url TEXT,
      data_url TEXT,
      storage_path TEXT,
      mime_type TEXT,
      width INTEGER,
      height INTEGER,
      duration_seconds REAL,
      metadata TEXT,
      saved_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (generation_id) REFERENCES studio_video_generations(id) ON DELETE CASCADE
    );

  `)
}

function migrateSchema(database: Database.Database) {
  for (const [tableName, columns] of Object.entries(studioTableColumns)) {
    ensureSqliteTableColumns(database, tableName, columns)
  }

  database
    .prepare(
      `
        DELETE FROM studio_permission_rules
        WHERE project_id IS NULL
      `
    )
    .run()
}

function ensureSchemaIndexes(database: Database.Database) {
  database.exec(`
    CREATE INDEX IF NOT EXISTS studio_sessions_updated_at_idx
      ON studio_sessions(updated_at DESC);

    CREATE INDEX IF NOT EXISTS studio_sessions_project_id_idx
      ON studio_sessions(project_id, updated_at DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS studio_permission_rules_scope_tool_idx
      ON studio_permission_rules(COALESCE(project_id, ''), tool_name);

    CREATE INDEX IF NOT EXISTS studio_permission_rules_project_idx
      ON studio_permission_rules(project_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS studio_local_projects_updated_idx
      ON studio_local_projects(last_opened_at DESC, updated_at DESC);

    CREATE INDEX IF NOT EXISTS studio_messages_session_id_created_at_idx
      ON studio_messages(session_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS studio_messages_version_group_idx
      ON studio_messages(session_id, version_group_id);

    CREATE INDEX IF NOT EXISTS studio_messages_status_session_idx
      ON studio_messages(status, session_id);

    CREATE INDEX IF NOT EXISTS studio_agent_provider_events_session_idx
      ON studio_agent_provider_events(session_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS studio_agent_provider_events_session_runtime_idx
      ON studio_agent_provider_events(session_id, runtime_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS studio_agent_provider_events_run_idx
      ON studio_agent_provider_events(run_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS studio_agent_provider_events_provider_ref_idx
      ON studio_agent_provider_events(provider, provider_ref);

    CREATE INDEX IF NOT EXISTS studio_agent_provider_events_trace_idx
      ON studio_agent_provider_events(provider, thread_id, turn_id, item_id);

    CREATE INDEX IF NOT EXISTS studio_session_files_session_idx
      ON studio_session_files(session_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS studio_session_files_saved_idx
      ON studio_session_files(saved_at DESC, created_at DESC);

    CREATE INDEX IF NOT EXISTS studio_installed_skills_enabled_idx
      ON studio_installed_skills(enabled, updated_at DESC);

    CREATE INDEX IF NOT EXISTS studio_expert_catalog_cache_cached_idx
      ON studio_expert_catalog_cache(cached_at DESC);

    CREATE INDEX IF NOT EXISTS studio_expert_detail_cache_runtime_idx
      ON studio_expert_detail_cache(runtime_hash, cached_at DESC);

    CREATE INDEX IF NOT EXISTS studio_session_experts_expert_idx
      ON studio_session_experts(expert_id, selected_at DESC);

    CREATE INDEX IF NOT EXISTS codebox_volumes_name_idx
      ON codebox_volumes(name);

    CREATE INDEX IF NOT EXISTS codebox_sandboxes_updated_idx
      ON codebox_sandboxes(updated_at DESC);

    CREATE INDEX IF NOT EXISTS codebox_sandboxes_owner_updated_idx
      ON codebox_sandboxes(owner_key, updated_at DESC);

    CREATE INDEX IF NOT EXISTS studio_mcp_servers_enabled_idx
      ON studio_mcp_servers(enabled, updated_at DESC);

    CREATE INDEX IF NOT EXISTS studio_mcp_registry_servers_name_idx
      ON studio_mcp_registry_servers(name, latest DESC);

    CREATE INDEX IF NOT EXISTS studio_mcp_registry_servers_synced_idx
      ON studio_mcp_registry_servers(synced_at DESC);

    CREATE INDEX IF NOT EXISTS studio_image_generations_session_idx
      ON studio_image_generations(session_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS studio_image_outputs_generation_idx
      ON studio_image_outputs(generation_id, output_index ASC);

    CREATE INDEX IF NOT EXISTS studio_image_outputs_saved_idx
      ON studio_image_outputs(saved_at DESC, created_at DESC);

    CREATE INDEX IF NOT EXISTS studio_audio_generations_session_idx
      ON studio_audio_generations(session_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS studio_audio_outputs_generation_idx
      ON studio_audio_outputs(generation_id, output_index ASC);

    CREATE INDEX IF NOT EXISTS studio_audio_outputs_saved_idx
      ON studio_audio_outputs(saved_at DESC, created_at DESC);

    CREATE INDEX IF NOT EXISTS studio_video_generations_session_idx
      ON studio_video_generations(session_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS studio_video_outputs_generation_idx
      ON studio_video_outputs(generation_id, output_index ASC);

    CREATE INDEX IF NOT EXISTS studio_video_outputs_saved_idx
      ON studio_video_outputs(saved_at DESC, created_at DESC);
  `)
}
