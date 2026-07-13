import type { ChatRunEnvironment, ChatRuntimeOption } from "./types"

export const MAX_ATTACHMENTS = 6
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
export const STUDIO_SESSION_TITLE_MAX_LENGTH = 120
export const TERMINAL_PANEL_OPEN_STORAGE_KEY =
  "astraflow.studio.terminal-panel-open"
export const STATUS_PANEL_OPEN_STORAGE_KEY =
  "astraflow.studio.status-panel-open"
export const RIGHT_PANEL_OPEN_STORAGE_KEY = "astraflow.studio.right-panel-open"
export const RIGHT_PANEL_MODE_STORAGE_KEY = "astraflow.studio.right-panel-mode"
export const RIGHT_PANEL_WIDTH_STORAGE_KEY =
  "astraflow.studio.right-panel-width.v4"
export const COMPOSER_ICON_ONLY_WIDTH = 650
export const TEXT_FILE_EXTENSIONS = new Set([
  "",
  "c",
  "conf",
  "cpp",
  "cs",
  "css",
  "csv",
  "env",
  "go",
  "h",
  "htm",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "log",
  "markdown",
  "md",
  "mdx",
  "mjs",
  "py",
  "rb",
  "rs",
  "sh",
  "sql",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
])
export const IMAGE_FILE_EXTENSIONS = new Set([
  "avif",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
])
export const CHAT_MODEL_STORAGE_KEY = "astraflow:chat-model"
export const CHAT_RUNTIME_STORAGE_KEY = "astraflow:chat-runtime"
export const CHAT_REASONING_EFFORT_STORAGE_KEY =
  "astraflow:chat-reasoning-effort"
export const CHAT_DEFAULTS_STORAGE_KEY = "astraflow-chat-defaults"
export const CHAT_ENVIRONMENT_STORAGE_KEY = "astraflow:chat-environment"
export const DEFAULT_CHAT_RUNTIME_ID = "astraflow"
export const PROJECT_NONE_VALUE = "__none__"

export const DEFAULT_CHAT_ENVIRONMENT: ChatRunEnvironment = "remote"
export const FALLBACK_CHAT_RUNTIME_INFO: ChatRuntimeOption = {
  id: DEFAULT_CHAT_RUNTIME_ID,
  label: "AstraFlow Agent",
  description: "AstraFlow agent with remote sandbox and local execution",
  capabilities: {
    hitl: true,
    resume: false,
    subagents: true,
    plan: true,
    sandbox: true,
    mcp: true,
    skills: true,
    compact: false,
  },
}
