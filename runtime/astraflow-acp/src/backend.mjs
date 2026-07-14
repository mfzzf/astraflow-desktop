import { methods } from "@agentclientprotocol/sdk"
import { LocalShellBackend } from "deepagents"
import { isAbsolute, relative, resolve } from "node:path"
import { randomUUID } from "node:crypto"

import { asErrorMessage } from "./constants.mjs"

const HIGH_RISK_COMMAND_PATTERNS = [
  /\bsudo\b/i,
  /\brm\s+(?:-[^\n]*[rf]|--recursive|--force)\b/i,
  /\b(?:mkfs|dd|fdisk|parted|mount|umount|shutdown|reboot|halt|poweroff)\b/i,
  /\b(?:systemctl|service|killall|pkill)\b/i,
  /\bgit\s+(?:reset\s+--hard|clean\b[^\n]*-f|rebase|filter-branch)\b/i,
  /\bgit\s+push\b[^;&|\n]*(?:--force|--force-with-lease|-f)\b/i,
  /\b(?:drop|truncate)\s+(?:table|database|schema)\b/i,
  /\b(?:kubectl|terraform|tofu|helm)\s+(?:delete|destroy|apply|upgrade|rollback)\b/i,
  /\b(?:docker|podman)\s+(?:system\s+prune|volume\s+rm|rm|rmi|down)\b/i,
  /\b(?:curl|wget)\b[\s\S]{0,240}\|\s*(?:sudo\s+)?(?:sh|bash|zsh|python3?|node)\b/i,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:publish|unpublish)\b/i,
  /\b(?:pip(?:3)?|uv\s+pip)\s+install\b/i,
]
const SECRET_ACCESS_PATTERN =
  /(?:^|[/\s"'])(?:\.env(?:\.[\w.-]+)?|\.npmrc|\.netrc|\.pypirc|\.git-credentials|id_(?:rsa|dsa|ecdsa|ed25519)|[\w.-]+\.(?:pem|key|p12|pfx)|credentials(?:\.json)?)(?:$|[/\s"'])|\/proc\/.*\/environ|\b(?:password|secret|token|private[_-]?key|credential)\b/i
const SAFE_ENV_NAMES = [
  "HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NO_PROXY",
  "PATH",
  "SHELL",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TERM",
  "TMPDIR",
  "TZ",
  "USER",
]

function createShellEnvironment() {
  return Object.fromEntries(
    SAFE_ENV_NAMES.flatMap((name) =>
      typeof process.env[name] === "string" ? [[name, process.env[name]]] : []
    )
  )
}

function toolKind(toolName) {
  if (["read_file", "ls"].includes(toolName)) {
    return "read"
  }

  if (["glob", "grep"].includes(toolName)) {
    return "search"
  }

  if (["write_file", "edit_file", "upload_file"].includes(toolName)) {
    return "edit"
  }

  return "execute"
}

function inputPreview(input) {
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

function needsExplicitApproval(mode, toolName, input) {
  if (mode === "full_access") {
    return false
  }

  const preview = inputPreview(input)

  if (mode === "ask") {
    return true
  }

  if (mode === "readonly") {
    return false
  }

  if (SECRET_ACCESS_PATTERN.test(preview)) {
    return true
  }

  if (toolName === "execute") {
    return HIGH_RISK_COMMAND_PATTERNS.some((pattern) => pattern.test(preview))
  }

  return false
}

function readonlyDenial(mode, toolName) {
  if (mode !== "readonly") {
    return null
  }

  return ["read_file", "ls", "glob", "grep"].includes(toolName)
    ? null
    : "The current AstraFlow permission mode is read-only."
}

export class AcpPermissionBackend extends LocalShellBackend {
  constructor({ client, cwd, permissionMode, sessionId, signal }) {
    super({
      rootDir: cwd,
      virtualMode: false,
      inheritEnv: false,
      env: createShellEnvironment(),
      timeout: 120,
      maxOutputBytes: 100_000,
    })
    this.client = client
    this.cwd = resolve(cwd)
    this.permissionMode = permissionMode
    this.sessionId = sessionId
    this.signal = signal
    this.initializePromise = null
  }

  async ensureReady() {
    if (this.isInitialized) {
      return
    }

    this.initializePromise ??= this.initialize().catch((error) => {
      this.initializePromise = null
      throw error
    })

    await this.initializePromise
  }

  assertWorkspacePath(filePath) {
    const absolutePath = isAbsolute(filePath)
      ? resolve(filePath)
      : resolve(this.cwd, filePath)
    const relation = relative(this.cwd, absolutePath)

    if (relation === ".." || relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
      throw new Error(`Path must stay inside the selected workspace: ${this.cwd}`)
    }

    return absolutePath
  }

  async permissionDenial(toolName, input) {
    const hardDenial = readonlyDenial(this.permissionMode, toolName)

    if (hardDenial) {
      return hardDenial
    }

    if (!needsExplicitApproval(this.permissionMode, toolName, input)) {
      return null
    }

    const toolCallId = randomUUID()
    let response

    try {
      response = await this.client.request(
        methods.client.session.requestPermission,
        {
          sessionId: this.sessionId,
          toolCall: {
            toolCallId,
            title: toolName,
            kind: toolKind(toolName),
            status: "pending",
            rawInput: input,
          },
          options: [
            {
              optionId: "allow_once",
              name: "Allow once",
              kind: "allow_once",
            },
            {
              optionId: "reject_once",
              name: "Reject",
              kind: "reject_once",
            },
          ],
        },
        { signal: this.signal }
      )
    } catch (error) {
      return `Permission request failed: ${asErrorMessage(error)}`
    }

    return response?.outcome?.outcome === "selected" &&
      response.outcome.optionId === "allow_once"
      ? null
      : "The user did not approve this operation."
  }

  async read(filePath, offset = 0, limit = 500) {
    let safePath

    try {
      safePath = this.assertWorkspacePath(filePath)
    } catch (error) {
      return { error: asErrorMessage(error) }
    }

    const denial = await this.permissionDenial("read_file", {
      path: safePath,
      offset,
      limit,
    })

    return denial ? { error: denial } : super.read(safePath, offset, limit)
  }

  async readRaw(filePath) {
    let safePath

    try {
      safePath = this.assertWorkspacePath(filePath)
    } catch (error) {
      return { error: asErrorMessage(error) }
    }

    const denial = await this.permissionDenial("read_file", { path: safePath })

    return denial ? { error: denial } : super.readRaw(safePath)
  }

  async ls(dirPath) {
    let safePath

    try {
      safePath = this.assertWorkspacePath(dirPath)
    } catch (error) {
      return { error: asErrorMessage(error) }
    }

    const denial = await this.permissionDenial("ls", { path: safePath })

    return denial ? { error: denial } : super.ls(safePath)
  }

  async glob(pattern, searchPath = this.cwd) {
    let safePath

    try {
      safePath = this.assertWorkspacePath(searchPath)
    } catch (error) {
      return { error: asErrorMessage(error) }
    }

    const denial = await this.permissionDenial("glob", {
      pattern,
      path: safePath,
    })

    return denial ? { error: denial } : super.glob(pattern, safePath)
  }

  async grep(pattern, searchPath = this.cwd, glob = null) {
    let safePath

    try {
      safePath = this.assertWorkspacePath(searchPath)
    } catch (error) {
      return { error: asErrorMessage(error) }
    }

    const denial = await this.permissionDenial("grep", {
      pattern,
      path: safePath,
      glob,
    })

    return denial ? { error: denial } : super.grep(pattern, safePath, glob)
  }

  async write(filePath, content) {
    let safePath

    try {
      safePath = this.assertWorkspacePath(filePath)
    } catch (error) {
      return { error: asErrorMessage(error) }
    }

    const denial = await this.permissionDenial("write_file", {
      path: safePath,
      content,
    })

    return denial ? { error: denial } : super.write(safePath, content)
  }

  async edit(filePath, oldString, newString, replaceAll = false) {
    let safePath

    try {
      safePath = this.assertWorkspacePath(filePath)
    } catch (error) {
      return { error: asErrorMessage(error) }
    }

    const denial = await this.permissionDenial("edit_file", {
      path: safePath,
      oldString,
      newString,
      replaceAll,
    })

    return denial
      ? { error: denial }
      : super.edit(safePath, oldString, newString, replaceAll)
  }

  async execute(command) {
    const denial = await this.permissionDenial("execute", { command })

    if (denial) {
      return { output: denial, exitCode: 1, truncated: false }
    }

    await this.ensureReady()
    return super.execute(command)
  }

  async uploadFiles(files) {
    const safeFiles = []

    try {
      for (const [filePath, content] of files) {
        safeFiles.push([this.assertWorkspacePath(filePath), content])
      }
    } catch {
      return files.map(([filePath]) => ({
        path: filePath,
        error: "permission_denied",
      }))
    }

    const denial = await this.permissionDenial(
      "upload_file",
      safeFiles.map(([filePath, content]) => ({
        path: filePath,
        bytes: content.byteLength,
      }))
    )

    return denial
      ? safeFiles.map(([filePath]) => ({
          path: filePath,
          error: "permission_denied",
        }))
      : super.uploadFiles(safeFiles)
  }

  async downloadFiles(paths) {
    let safePaths

    try {
      safePaths = paths.map((filePath) => this.assertWorkspacePath(filePath))
    } catch {
      return paths.map((filePath) => ({
        path: filePath,
        content: null,
        error: "permission_denied",
      }))
    }

    const denial = await this.permissionDenial(
      "read_file",
      safePaths.map((filePath) => ({ path: filePath }))
    )

    return denial
      ? safePaths.map((filePath) => ({
          path: filePath,
          content: null,
          error: "permission_denied",
        }))
      : super.downloadFiles(safePaths)
  }
}
