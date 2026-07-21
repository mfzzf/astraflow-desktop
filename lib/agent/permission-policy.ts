import type { AgentRuntimeId } from "@/lib/agent-model-settings-shared"
import { bashPermissionInputNeedsApproval } from "@/lib/agent/bash-security"
import type { StudioPermissionMode } from "@/lib/studio-types"

export type PermissionToolKind =
  "read" | "search" | "fetch" | "edit" | "delete" | "move" | "execute"

export const SANDBOX_NETWORK_PERMISSION_TOOL = "network_access"

const HIGH_RISK_COMMAND_PATTERNS = [
  /\bsudo\b/i,
  /\brm\s+(?:-[^\n]*[rf]|--recursive|--force)\b/i,
  /\b(?:mkfs|dd|fdisk|parted|mount|umount|shutdown|reboot|halt|poweroff)\b/i,
  /\b(?:systemctl|service|launchctl)\b/i,
  /\b(?:killall|pkill)\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+push\b[^;&|\n]*[ \t](?:--force|--force-with-lease|-f)\b/i,
  /\bgit\s+clean\b(?![^;&|\n]*(?:-[a-zA-Z]*n|--dry-run))[^;&|\n]*-[a-zA-Z]*f/i,
  /\bgit\s+checkout\s+(?:--\s+)?\.[ \t]*(?:$|[;&|\n])/i,
  /\bgit\s+restore\s+(?:--\s+)?\.[ \t]*(?:$|[;&|\n])/i,
  /\bgit\s+stash[ \t]+(?:drop|clear)\b/i,
  /\bgit\s+branch\s+(?:-D[ \t]|--delete\s+--force|--force\s+--delete)\b/i,
  /\bgit\s+(?:commit|push|merge)\b[^;&|\n]*--no-verify\b/i,
  /\bgit\s+commit\b[^;&|\n]*--amend\b/i,
  /\bgit\s+(?:rebase|filter-branch)\b/i,
  /\b(?:drop|truncate)\s+(?:table|database|schema)\b/i,
  /\bdelete\s+from\s+\w+[ \t]*(?:;|"|'|\n|$)/i,
  /\b(?:psql|mysql|sqlite3|mongosh|redis-cli)\b[\s\S]{0,160}\b(?:drop|truncate|flushall|del)\b/i,
  /\bkubectl\s+(?:delete|apply|replace|patch|scale|rollout\s+restart)\b/i,
  /\bterraform\s+(?:destroy|apply)\b/i,
  /\btofu\s+(?:destroy|apply)\b/i,
  /\bhelm\s+(?:delete|uninstall|upgrade|rollback)\b/i,
  /\b(?:docker|podman)\s+(?:system\s+prune|volume\s+rm|network\s+rm|container\s+rm|rm|rmi|down)\b/i,
  /\b(?:curl|wget)\b[\s\S]{0,240}\|\s*(?:sudo\s+)?(?:sh|bash|zsh|python3?|node|ruby|perl)\b/i,
  /\b(?:eval|source|\.)\b[\s\S]{0,160}\$?\(?\s*(?:curl|wget)\b/i,
  /\b(?:bash|sh|zsh)\s+-c\b/i,
  /\b(?:python3?|node|ruby|perl|php)\s+-e\b/i,
  /\bxargs\b[\s\S]{0,160}\b(?:rm|chmod|chown|sudo|sh|bash|zsh)\b/i,
  /\bchmod\s+(?:-[^\s]+\s+)?(?:777|[augo]*\+w)\b/i,
  /\bchmod\s+-[^\s]*R/i,
  /\bchown\b/i,
  /\bchgrp\b/i,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:publish|unpublish)\b/i,
  /\b(?:pip(?:3(?:\.\d+)?)?|uv\s+pip)\s+install\b/i,
]

function commandTextFromPreview(inputPreview: string) {
  try {
    const parsed = JSON.parse(inputPreview)

    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { command?: unknown }).command === "string"
    ) {
      return (parsed as { command: string }).command
    }
  } catch {
    // Some runtimes provide a plain command preview instead of JSON.
  }

  return inputPreview
}

function packageManagerInstallNeedsApproval(inputPreview: string) {
  const command = commandTextFromPreview(inputPreview)

  if (
    /\b(?:npm|pnpm|bun)\s+(?:install|add|i|ci)\b/i.test(command) ||
    /\byarn\s+(?:install|add|up|upgrade)\b/i.test(command)
  ) {
    return true
  }

  return command.split(/&&|\|\||;|\r?\n/).some((segment) => {
    const match = segment.trim().match(/^yarn(?:\.cmd)?(?:\s+(.*))?$/i)

    if (!match) {
      return false
    }

    const argumentsText = match[1]?.trim()

    if (!argumentsText) {
      return true
    }

    return !/^(?:--version|-v|--help|-h)(?:\s|$)/i.test(argumentsText)
  })
}

const SECRET_FILE_NAME_SOURCE = String.raw`(?:^|[/\\"'\s=(<])(?:\.env(?:\.(?!example\b|sample\b|template\b|test\b)[\w.-]+)?|\.npmrc|\.netrc|\.pypirc|\.git-credentials|key\.txt|kubeconfig|\.kube[/\\]config|[\w.-]*(?:api[_-]?key|secret|token|credential|password)s?\.(?:txt|env|json|ya?ml|ini|pem|key|p12|pfx)|id_(?:rsa|dsa|ecdsa|ed25519)|[\w.-]+\.(?:pem|key|p12|pfx)|credentials(?:\.json)?)(?=$|[/\\"'\s:,)])`

const SECRET_FILE_NAME_PATTERN = new RegExp(SECRET_FILE_NAME_SOURCE, "i")

const SECRET_DISPLAY_COMMAND_PATTERNS = [
  new RegExp(
    String.raw`\b(?:cat|less|more|head|tail|sed|awk|grep|rg|strings|base64|xxd|od|hexdump|rev|tac|nl|sort|uniq|tr|cut|dd|openssl|python3?|node|deno|bun|ruby|perl|php)\b[^\n;&|]*?` +
      SECRET_FILE_NAME_SOURCE,
    "i"
  ),
  /\b(?:echo|printf)\b[^\n;&|]*\$\{?[A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z_]*\b/,
  /\b(?:env|printenv|set)\b[^\n;&|]*\b(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE)\b/i,
  /\/proc\/.*\/environ/i,
]

const SENSITIVE_ACCESS_PATTERNS = [
  /(?:^|[/"'\\])\.ssh(?:[/"'\\]|$)/i,
  /(?:^|[/"'\\])\.gnupg(?:[/"'\\]|$)/i,
  /(?:^|[/"'\\])\.aws(?:[/"'\\]|$)/i,
  /(?:^|[/"'\\])\.azure(?:[/"'\\]|$)/i,
  /(?:^|[/"'\\])\.config[/"'\\]gcloud(?:[/"'\\]|$)/i,
  /(?:^|[/"'\\])\.kube(?:[/"'\\]|$)/i,
  /(?:^|[/"'\\])\.docker[/"'\\]config\.json/i,
  /(?:^|[/"'\\])(?:\.npmrc|\.netrc|\.pypirc|\.git-credentials)(?:["'\\\s]|$)/i,
  /(?:^|[/"'\\])\.env(?:\.[\w.-]+)?(?:["'\\\s]|$)/i,
  /(?:^|[/"'\\])etc(?:[/"'\\]|$)/i,
  /\/proc\/.*\/environ/i,
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
      "studio_send_file",
      "download_file",
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
    ["delete", "remove", "rm", "delete_file", "remove_file"].includes(
      normalized
    )
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
  if (toolName.trim().toLowerCase() === SANDBOX_NETWORK_PERMISSION_TOOL) {
    return true
  }

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
    return (
      bashPermissionInputNeedsApproval(inputPreview) ||
      packageManagerInstallNeedsApproval(inputPreview) ||
      HIGH_RISK_COMMAND_PATTERNS.some((pattern) => pattern.test(inputPreview))
    )
  }

  return SENSITIVE_ACCESS_PATTERNS.some((pattern) => pattern.test(inputPreview))
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

export function isAcpPermissionModeProcessScoped(runtimeId: AgentRuntimeId) {
  return runtimeId === "astraflow" || runtimeId === "opencode"
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
