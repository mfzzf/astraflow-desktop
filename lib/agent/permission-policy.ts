import type { AgentRuntimeId } from "@/lib/agent-model-settings-shared"
import type { StudioPermissionMode } from "@/lib/studio-types"

export type PermissionToolKind =
  | "read"
  | "search"
  | "fetch"
  | "edit"
  | "delete"
  | "move"
  | "execute"

const HIGH_RISK_COMMAND_PATTERNS = [
  /\bsudo\b/i,
  /\brm\s+(?:-[^\n]*[rf]|--recursive|--force)\b/i,
  /\b(?:mkfs|dd|fdisk|parted|mount|umount|shutdown|reboot|halt|poweroff)\b/i,
  /\b(?:systemctl|service|launchctl)\b/i,
  /\b(?:killall|pkill)\b/i,
  /\bgit\s+(?:reset\s+--hard|clean\s+-|push|rebase|filter-branch)\b/i,
  /\b(?:docker|podman|kubectl|helm|terraform|tofu)\s+(?:apply|destroy|delete|rm|down)\b/i,
  /\b(?:curl|wget)\b[\s\S]{0,160}\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/i,
  /\bchmod\s+(?:-[^\s]+\s+)?(?:777|[augo]*\+w)\b/i,
  /\bchown\b/i,
  /\b(?:npm|pnpm|yarn|bun)\s+publish\b/i,
]

const SECRET_FILE_NAME_SOURCE = String.raw`(?:^|[/\\"'\s=(<])(?:\.env(?:\.(?!example\b|sample\b|template\b|test\b)[\w.-]+)?|key\.txt|[\w.-]*(?:api[_-]?key|secret|token|credential|password)s?\.(?:txt|env|json|ya?ml|ini|pem|key|p12|pfx)|id_(?:rsa|dsa|ecdsa|ed25519)|[\w.-]+\.(?:pem|key|p12|pfx)|credentials(?:\.json)?)(?=$|[/\\"'\s:,)])`

const SECRET_FILE_NAME_PATTERN = new RegExp(SECRET_FILE_NAME_SOURCE, "i")

const SECRET_DISPLAY_COMMAND_PATTERNS = [
  new RegExp(
    String.raw`\b(?:cat|less|more|head|tail|sed|awk|grep|rg|strings|base64|xxd|od|hexdump|rev|tac|nl|sort|uniq|tr|cut|dd|openssl|python3?|node|deno|bun|ruby|perl|php)\b[^\n;&|]*?` +
      SECRET_FILE_NAME_SOURCE,
    "i"
  ),
  /\b(?:echo|printf)\b[^\n;&|]*\$\{?[A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z_]*\b/,
]

const SENSITIVE_ACCESS_PATTERNS = [
  /(?:^|[/"'\\])\.ssh(?:[/"'\\]|$)/i,
  /(?:^|[/"'\\])\.gnupg(?:[/"'\\]|$)/i,
  /(?:^|[/"'\\])\.aws(?:[/"'\\]|$)/i,
  /(?:^|[/"'\\])\.docker[/"'\\]config\.json/i,
  /(?:^|[/"'\\])\.env(?:\.[\w.-]+)?(?:["'\\\s]|$)/i,
  /(?:^|[/"'\\])etc(?:[/"'\\]|$)/i,
  /\b(?:password|secret|token|private[_-]?key|credential)\b/i,
]

export function getPermissionToolKind(toolName: string): PermissionToolKind {
  const normalized = toolName.trim().toLowerCase()

  if (
    [
      "read",
      "read_file",
      "read_raw",
      "read_skill_file",
      "prepare_skill_sandbox",
      "ls",
      "list",
      "list_files",
      "sandbox_get_host",
    ].includes(normalized)
  ) {
    return "read"
  }

  if (
    [
      "search",
      "web_search",
      "grep",
      "glob",
      "rg",
      "find",
      "list_installed_skills",
      "list_installed_mcp_servers",
      "studio_list_image_models",
      "studio_list_video_models",
      "studio_list_media_generation_models",
      "studio_get_media_model_schema",
      "studio_list_media_generations",
      "studio_get_media_generation",
      "request_user_input",
    ].includes(normalized)
  ) {
    return "search"
  }

  if (["fetch", "web_fetch", "http", "https"].includes(normalized)) {
    return "fetch"
  }

  if (
    [
      "delete",
      "remove",
      "rm",
      "delete_file",
      "remove_file",
    ].includes(normalized)
  ) {
    return "delete"
  }

  if (["move", "mv", "rename", "move_file"].includes(normalized)) {
    return "move"
  }

  if (
    [
      "write",
      "write_file",
      "edit",
      "edit_file",
      "str_replace",
      "upload_file",
      "download_file",
    ].includes(normalized)
  ) {
    return "edit"
  }

  return "execute"
}

export function isReadOnlyPermissionTool(toolName: string) {
  return ["read", "search", "fetch"].includes(getPermissionToolKind(toolName))
}

export function isFullAccessPermissionMode(mode: StudioPermissionMode) {
  return mode === "full_access"
}

export function shouldBypassPermissionPrompt(mode: StudioPermissionMode) {
  return mode === "full_access"
}

export function isHighRiskPermissionRequest({
  inputPreview,
  toolName,
}: {
  inputPreview: string
  toolName: string
}) {
  if (isSensitiveSecretPermissionRequest({ inputPreview, toolName })) {
    return true
  }

  const kind = getPermissionToolKind(toolName)

  if (kind === "read" || kind === "search" || kind === "fetch") {
    return false
  }

  if (kind === "delete" || kind === "move") {
    return true
  }

  if (kind === "execute") {
    return HIGH_RISK_COMMAND_PATTERNS.some((pattern) =>
      pattern.test(inputPreview)
    )
  }

  return SENSITIVE_ACCESS_PATTERNS.some((pattern) =>
    pattern.test(inputPreview)
  )
}

export function isSensitiveSecretPermissionRequest({
  inputPreview,
  toolName,
}: {
  inputPreview: string
  toolName: string
}) {
  const kind = getPermissionToolKind(toolName)

  if (kind === "execute") {
    return SECRET_DISPLAY_COMMAND_PATTERNS.some((pattern) =>
      pattern.test(inputPreview)
    )
  }

  if (kind === "read" || kind === "search") {
    return SECRET_FILE_NAME_PATTERN.test(inputPreview)
  }

  return false
}

export function shouldAutoApprovePermission({
  inputPreview,
  mode,
  toolName,
}: {
  inputPreview: string
  mode: StudioPermissionMode
  toolName: string
}) {
  if (isSensitiveSecretPermissionRequest({ inputPreview, toolName })) {
    return false
  }

  if (mode === "full_access") {
    return true
  }

  if (mode !== "auto") {
    return false
  }

  return !isHighRiskPermissionRequest({ inputPreview, toolName })
}

export function getCodexDirectPermissionConfig(mode: StudioPermissionMode) {
  if (mode === "full_access") {
    return {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: "danger-full-access",
    }
  }

  if (mode === "readonly") {
    return {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "read-only",
    }
  }

  return {
    approvalPolicy: "on-request",
    approvalsReviewer: mode === "auto" ? "auto_review" : "user",
    sandbox: "workspace-write",
  }
}

export function getCodexAcpInitialMode(mode: StudioPermissionMode) {
  if (mode === "full_access") {
    return "agent-full-access"
  }

  if (mode === "readonly") {
    return "read-only"
  }

  return "agent"
}

export function getPreferredAcpSessionModes({
  mode,
  runtimeId,
}: {
  mode: StudioPermissionMode
  runtimeId: AgentRuntimeId
}) {
  if (runtimeId === "codex") {
    return [getCodexAcpInitialMode(mode)]
  }

  if (runtimeId === "claude-code") {
    if (mode === "full_access") {
      return ["bypassPermissions", "auto", "default"]
    }

    if (mode === "auto") {
      return ["auto", "default"]
    }

    if (mode === "readonly") {
      return ["plan", "default"]
    }

    return ["default"]
  }

  if (mode === "full_access") {
    return ["agent-full-access", "bypassPermissions", "bypass", "auto"]
  }

  if (mode === "auto") {
    return ["auto", "agent", "default"]
  }

  if (mode === "readonly") {
    return ["read-only", "plan", "default"]
  }

  return ["agent", "default"]
}
