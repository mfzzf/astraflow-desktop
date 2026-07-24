import { methods } from "@agentclientprotocol/sdk"
import {
  createCodingTools,
  createReadOnlyTools,
} from "@earendil-works/pi-coding-agent"
import { createHash, randomUUID } from "node:crypto"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path"

import { asErrorMessage, getRecord } from "./constants.mjs"

const SECRET_ACCESS_PATTERN =
  /(?:^|[/\s"'])(?:\.env(?:\.[\w.-]+)?|\.npmrc|\.netrc|\.pypirc|\.git-credentials|id_(?:rsa|dsa|ecdsa|ed25519)|[\w.-]+\.(?:pem|key|p12|pfx)|credentials(?:\.json)?)(?:$|[/\s"'])|\/proc\/.*\/environ|\b(?:password|secret|token|private[_-]?key|credential)\b/i
const SAFE_ENV_NAMES = [
  "APPDATA",
  "ComSpec",
  "HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOCALAPPDATA",
  "NO_PROXY",
  "PATH",
  "PATHEXT",
  "SHELL",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SystemDrive",
  "SystemRoot",
  "TERM",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
  "USER",
  "USERPROFILE",
  "WINDIR",
]
const READ_TOOLS = new Set(["read", "ls"])
const SEARCH_TOOLS = new Set(["grep", "find"])
const EDIT_TOOLS = new Set(["edit", "write"])
const NO_APPROVAL_TOOLS = new Set(["plan", "request_user_input", "task"])
const READONLY_PRODUCT_TOOLS = new Set([
  "download_file",
  "list_installed_mcp_servers",
  "studio_get_media_generation",
  "studio_get_media_model_schema",
  "studio_list_image_models",
  "studio_list_media_generation_models",
  "studio_list_media_generations",
  "studio_list_video_models",
  "web_fetch",
  "web_search",
])
const READONLY_ALLOWED_TOOLS = new Set([
  ...NO_APPROVAL_TOOLS,
  ...READONLY_PRODUCT_TOOLS,
  ...READ_TOOLS,
  ...SEARCH_TOOLS,
])
const FILE_CHANGE_INLINE_TEXT_LIMIT = 48 * 1024
const FILE_CHANGE_TRANSPORT_TEXT_LIMIT = 1024 * 1024

function decodeSnapshotText(content) {
  if (content.byteLength > FILE_CHANGE_TRANSPORT_TEXT_LIMIT) {
    return null
  }

  const text = content.toString("utf8")

  return Buffer.from(text, "utf8").equals(content) ? text : null
}

async function readFileChangeSnapshot(filePath) {
  try {
    const content = await readFile(filePath)
    const text = decodeSnapshotText(content)

    return {
      exists: true,
      bytes: content.byteLength,
      revision: createHash("sha256").update(content).digest("hex"),
      text,
      inline:
        text !== null &&
        content.byteLength <= FILE_CHANGE_INLINE_TEXT_LIMIT,
    }
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return {
        exists: false,
        bytes: 0,
        revision: null,
        text: null,
        inline: true,
      }
    }

    throw error
  }
}

function createFileMutationMetadataTools(tools, cwd) {
  const queues = new Map()
  let order = 0

  return tools.map((tool) => {
    if (!EDIT_TOOLS.has(tool.name)) {
      return tool
    }

    const execute = tool.execute.bind(tool)

    return {
      ...tool,
      async execute(toolCallId, params, signal, onUpdate) {
        const input = getRecord(params)
        const inputPath =
          typeof input?.path === "string" && input.path.trim()
            ? input.path.trim()
            : null

        if (!inputPath) {
          return execute(toolCallId, params, signal, onUpdate)
        }

        const absolutePath = isAbsolute(inputPath)
          ? resolve(inputPath)
          : resolve(cwd, inputPath)
        const previous = queues.get(absolutePath) ?? Promise.resolve()
        const operation = previous
          .catch(() => undefined)
          .then(async () => {
            const before = await readFileChangeSnapshot(absolutePath)
            const result = await execute(toolCallId, params, signal, onUpdate)
            const after = await readFileChangeSnapshot(absolutePath)
            const details = getRecord(result?.details) ?? {}

            order += 1

            return {
              ...result,
              details: {
                ...details,
                astraflowFileChange: {
                  path: absolutePath,
                  kind: before.exists ? "edit" : "create",
                  toolCallId,
                  order,
                  revision: after.revision,
                  previousRevision: before.revision,
                  bytesBefore: before.bytes,
                  bytesAfter: after.bytes,
                  oldText: before.text,
                  newText: after.text,
                  diffTruncated:
                    (before.exists && !before.inline) ||
                    (after.exists && !after.inline),
                },
              },
            }
          })
        const queued = operation.finally(() => {
          if (queues.get(absolutePath) === queued) {
            queues.delete(absolutePath)
          }
        })

        queues.set(absolutePath, queued)

        return queued
      },
    }
  })
}

function createShellEnvironment() {
  const environment = new Map(
    Object.entries(process.env).map(([name, value]) => [
      name.toLowerCase(),
      [name, value],
    ])
  )

  return Object.fromEntries(
    SAFE_ENV_NAMES.flatMap((name) => {
      const entry = environment.get(name.toLowerCase())
      return typeof entry?.[1] === "string" ? [entry] : []
    })
  )
}

export function resolveTerminalShell() {
  if (process.platform === "win32") {
    const windowsRoot = process.env.SystemRoot || process.env.WINDIR
    const bundledPowerShell = windowsRoot
      ? join(
          windowsRoot,
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe"
        )
      : null

    return {
      shell:
        bundledPowerShell && existsSync(bundledPowerShell)
          ? bundledPowerShell
          : "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"],
    }
  }

  return {
    shell: existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh",
    args: ["-lc"],
  }
}

function terminateTerminalProcess(child) {
  if (process.platform === "win32" && child.pid) {
    try {
      const killer = spawn(
        "taskkill.exe",
        ["/pid", String(child.pid), "/t", "/f"],
        { stdio: "ignore", windowsHide: true }
      )
      killer.unref()
      return
    } catch {
      // Fall through to terminating the immediate process.
    }
  }

  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, "SIGKILL")
      return
    } catch {
      // Fall through to terminating the immediate process.
    }
  }

  child.kill("SIGKILL")
}

function executeTerminalCommand({
  command,
  cwd,
  env,
  onData,
  signal,
  timeout,
}) {
  if (
    timeout !== undefined &&
    (!Number.isFinite(timeout) || timeout <= 0 || timeout > 2_147_483.647)
  ) {
    return Promise.reject(
      new Error("Invalid timeout: must be between 0 and 2147483.647 seconds")
    )
  }

  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"))
      return
    }

    const terminal = resolveTerminalShell()
    const executedCommand =
      process.platform === "win32"
        ? "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); " +
          command
        : command
    const child = spawn(terminal.shell, [...terminal.args, executedCommand], {
      cwd,
      detached: process.platform !== "win32",
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    let settled = false
    let timedOut = false
    let timeoutHandle

    const settle = (error, exitCode = null) => {
      if (settled) {
        return
      }

      settled = true
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      signal?.removeEventListener("abort", onAbort)

      if (error) {
        reject(error)
      } else {
        resolvePromise({ exitCode })
      }
    }
    const onAbort = () => terminateTerminalProcess(child)

    child.stdout?.on("data", onData)
    child.stderr?.on("data", onData)
    child.once("error", (error) => settle(error))
    child.once("close", (code) => {
      if (signal?.aborted) {
        settle(new Error("aborted"))
      } else if (timedOut) {
        settle(new Error(`timeout:${timeout}`))
      } else {
        settle(null, code)
      }
    })

    if (typeof timeout === "number") {
      timeoutHandle = setTimeout(() => {
        timedOut = true
        terminateTerminalProcess(child)
      }, timeout * 1_000)
      timeoutHandle.unref?.()
    }

    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function toolKind(toolName) {
  if (READ_TOOLS.has(toolName)) {
    return "read"
  }

  if (SEARCH_TOOLS.has(toolName)) {
    return "search"
  }

  if (READONLY_PRODUCT_TOOLS.has(toolName)) {
    return "read"
  }

  if (EDIT_TOOLS.has(toolName)) {
    return "edit"
  }

  if (["plan", "task"].includes(toolName)) {
    return "think"
  }

  if (toolName === "bash") {
    return "execute"
  }

  return "other"
}

function inputPreview(input) {
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

function needsExplicitApproval(mode, toolName, input) {
  if (
    mode === "full_access" ||
    mode === "workspace_auto" ||
    NO_APPROVAL_TOOLS.has(toolName)
  ) {
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

  return toolName === "bash"
}

function readonlyDenial(mode, toolName) {
  if (mode !== "readonly" || READONLY_ALLOWED_TOOLS.has(toolName)) {
    return null
  }

  return "The current AstraFlow permission mode is read-only."
}

function toolPaths(toolName, input) {
  const record = getRecord(input)

  if (!record) {
    return []
  }

  if (["read", "edit", "write"].includes(toolName)) {
    return typeof record.path === "string" ? [record.path] : []
  }

  if (["grep", "find", "ls"].includes(toolName)) {
    return [typeof record.path === "string" ? record.path : "."]
  }

  return []
}

function assertUnambiguousPiPath(filePath) {
  const trimmed = filePath.trim()

  // Pi's coding tools expand these convenience prefixes after the permission
  // hook runs. Reject them so validation and execution always resolve the same
  // path instead of allowing an apparently relative path to become absolute.
  if (
    trimmed.startsWith("@") ||
    /^file:\/\//i.test(trimmed) ||
    /^~(?:[\\/]|$)/.test(trimmed)
  ) {
    throw new Error(
      "Tool paths must use a workspace-relative path or an absolute path inside the selected workspace."
    )
  }
}

function isSameOrDescendant(root, target) {
  const relation = relative(root, target)

  return (
    relation !== ".." &&
    !relation.startsWith(
      `..${process.platform === "win32" ? "\\" : "/"}`
    ) &&
    !isAbsolute(relation)
  )
}

export class AcpPermissionBackend {
  constructor({
    additionalRoots = [],
    client,
    cwd,
    permissionMode,
    readOnlyRoots = [],
    sessionId,
    signal,
  }) {
    this.client = client
    this.cwd = realpathSync.native(resolve(cwd))
    this.additionalRoots = additionalRoots.map((root) =>
      realpathSync.native(resolve(root))
    )
    this.permissionMode = permissionMode
    this.readOnlyRoots = readOnlyRoots.map((root) =>
      realpathSync.native(resolve(root))
    )
    this.activeSkillRoot = null
    this.sessionId = sessionId
    this.signal = signal
    this.env = createShellEnvironment()
  }

  async ensureReady() {}

  async close() {}

  assertWorkspacePath(filePath, { allowReadOnlyRoots = false } = {}) {
    if (typeof filePath !== "string" || !filePath.trim()) {
      throw new Error("Tool path must be a non-empty string.")
    }

    if (/^~(?:[\\/]|$)/.test(filePath.trim())) {
      throw new Error(
        `Path must stay inside the selected workspace: ${this.cwd}`
      )
    }

    const lexicalPath = isAbsolute(filePath)
      ? resolve(filePath)
      : resolve(this.cwd, filePath)
    // Resolve the nearest existing ancestor so a symlink cannot redirect a
    // read or mutation outside the selected workspace.
    let existingAncestor = lexicalPath

    while (!existsSync(existingAncestor)) {
      const parent = dirname(existingAncestor)

      if (parent === existingAncestor) {
        break
      }

      existingAncestor = parent
    }

    const canonicalAncestor = realpathSync.native(existingAncestor)
    const canonicalPath = resolve(
      canonicalAncestor,
      relative(existingAncestor, lexicalPath)
    )

    if (this.permissionMode === "full_access") {
      return canonicalPath
    }

    const workspaceRoots = [this.cwd, ...this.additionalRoots]
    const allowedRoots = allowReadOnlyRoots
      ? [...workspaceRoots, ...this.readOnlyRoots]
      : workspaceRoots
    const allowed = allowedRoots.some((root) => {
      const relationToRoot = relative(root, canonicalPath)

      return (
        relationToRoot !== ".." &&
        !relationToRoot.startsWith(
          `..${process.platform === "win32" ? "\\" : "/"}`
        ) &&
        !isAbsolute(relationToRoot)
      )
    })

    if (!allowed) {
      throw new Error(
        `Path must stay inside the selected workspace, an active additional root, or an active skill root: ${this.cwd}`
      )
    }

    return canonicalPath
  }

  resolveReadPath(filePath) {
    if (isAbsolute(filePath) || existsSync(resolve(this.cwd, filePath))) {
      return filePath
    }

    if (this.activeSkillRoot) {
      const skillRelativePath = resolve(this.activeSkillRoot, filePath)

      if (
        isSameOrDescendant(this.activeSkillRoot, skillRelativePath) &&
        existsSync(skillRelativePath)
      ) {
        return skillRelativePath
      }
    }

    return filePath
  }

  rememberActiveSkillRoot(filePath, toolName) {
    if (!READ_TOOLS.has(toolName) || basename(filePath) !== "SKILL.md") {
      return
    }

    const skillRoot = this.readOnlyRoots.find((root) =>
      isSameOrDescendant(root, filePath)
    )

    if (skillRoot) {
      this.activeSkillRoot = skillRoot
    }
  }

  async permissionDenial(
    toolName,
    input,
    signal = this.signal,
    { forcePrompt = false } = {}
  ) {
    const hardDenial = readonlyDenial(this.permissionMode, toolName)

    if (hardDenial) {
      return hardDenial
    }

    if (
      !forcePrompt &&
      !needsExplicitApproval(this.permissionMode, toolName, input)
    ) {
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
            ...(forcePrompt
              ? {
                  _meta: {
                    astraflowImportantAction: true,
                  },
                }
              : {}),
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
        { cancellationSignal: signal }
      )
    } catch (error) {
      return `Permission request failed: ${asErrorMessage(error)}`
    }

    if (
      response?.outcome?.outcome === "selected" &&
      response.outcome.optionId === "allow_once"
    ) {
      return null
    }

    const outcomeMeta = getRecord(response?.outcome?._meta)
    const feedback = outcomeMeta?.astraflowFeedback

    return typeof feedback === "string" && feedback.trim()
      ? feedback.trim().slice(0, 4096)
      : "The user did not approve this operation."
  }

  async beforeToolCall(context, signal = this.signal) {
    const toolName = context?.toolCall?.name || "tool"
    const input = context?.args || {}
    const inputRecord = getRecord(input)
    const activeTool = context?.context?.tools?.find(
      (tool) => tool?.name === toolName
    )
    const importantAction =
      activeTool?.astraflowEffectCategory === "important_action" &&
      activeTool?.astraflowHostActionEnforced !== true

    try {
      for (const filePath of toolPaths(toolName, input)) {
        assertUnambiguousPiPath(filePath)
        const requestedPath =
          READ_TOOLS.has(toolName) || SEARCH_TOOLS.has(toolName)
            ? this.resolveReadPath(filePath)
            : filePath
        const safePath = this.assertWorkspacePath(requestedPath, {
          allowReadOnlyRoots:
            READ_TOOLS.has(toolName) || SEARCH_TOOLS.has(toolName),
        })

        this.rememberActiveSkillRoot(safePath, toolName)

        // Agent core executes this same validated object after the hook. Pinning
        // it to the canonical path also prevents a second, different resolution
        // inside Pi's coding tool.
        if (inputRecord && typeof inputRecord.path === "string") {
          inputRecord.path = safePath
        }
      }
    } catch (error) {
      return { block: true, reason: asErrorMessage(error) }
    }

    const denial = await this.permissionDenial(toolName, input, signal, {
      forcePrompt: importantAction,
    })

    return denial ? { block: true, reason: denial } : undefined
  }

  createTools() {
    const options = {
      bash: {
        operations: {
          exec: (command, cwd, options) =>
            executeTerminalCommand({
              command,
              cwd,
              env: options.env || this.env,
              onData: options.onData,
              signal: options.signal,
              timeout: options.timeout,
            }),
        },
        spawnHook: ({ command }) => ({
          command,
          cwd: this.cwd,
          env: { ...this.env },
        }),
      },
    }
    const coding = createCodingTools(this.cwd, options)
    const search = createReadOnlyTools(this.cwd, options).filter(
      (tool) => tool.name !== "read"
    )

    const tools = createFileMutationMetadataTools(
      [...coding, ...search],
      this.cwd
    )

    if (process.platform !== "win32") {
      return tools
    }

    return tools.map((tool) =>
      tool.name === "bash"
        ? {
            ...tool,
            description:
              "Execute a PowerShell command in the current working directory. The tool name remains bash for protocol compatibility.",
            parameters: {
              ...tool.parameters,
              properties: {
                ...tool.parameters.properties,
                command: {
                  ...tool.parameters.properties.command,
                  description: "PowerShell command to execute",
                },
              },
            },
          }
        : tool
    )
  }

  // Focused helpers for embedders and permission tests.
  async write(filePath, content) {
    let safePath

    try {
      safePath = this.assertWorkspacePath(filePath)
    } catch (error) {
      return { error: asErrorMessage(error) }
    }

    const denial = await this.permissionDenial("write", {
      path: safePath,
      content,
    })

    if (denial) {
      return { error: denial }
    }

    await mkdir(dirname(safePath), { recursive: true })
    await writeFile(safePath, content)
    return { path: safePath, filesUpdate: null }
  }

  async execute(command) {
    const denial = await this.permissionDenial("bash", { command })

    if (denial) {
      return { output: denial, exitCode: 1, truncated: false }
    }

    return new Promise((resolvePromise, reject) => {
      const chunks = []
      let bytes = 0
      const append = (chunk) => {
        if (bytes >= 100_000) {
          return
        }

        const remaining = 100_000 - bytes
        const next = chunk.subarray(0, remaining)
        chunks.push(next)
        bytes += next.byteLength
      }

      void executeTerminalCommand({
        command,
        cwd: this.cwd,
        env: { ...this.env },
        onData: append,
        signal: this.signal,
      })
        .then(({ exitCode }) => {
          resolvePromise({
            output: Buffer.concat(chunks).toString("utf8"),
            exitCode: exitCode ?? 1,
            truncated: bytes >= 100_000,
          })
        })
        .catch(reject)
    })
  }
}
