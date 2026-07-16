import { methods } from "@agentclientprotocol/sdk"
import {
  createCodingTools,
  createReadOnlyTools,
} from "@earendil-works/pi-coding-agent"
import { randomUUID } from "node:crypto"
import {
  existsSync,
  realpathSync,
} from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { dirname, isAbsolute, relative, resolve } from "node:path"

import { asErrorMessage, getRecord } from "./constants.mjs"

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
const READ_TOOLS = new Set(["read", "ls"])
const SEARCH_TOOLS = new Set(["grep", "find"])
const EDIT_TOOLS = new Set(["edit", "write"])
const NO_APPROVAL_TOOLS = new Set(["plan", "request_user_input", "task"])
const READONLY_ALLOWED_TOOLS = new Set([
  ...NO_APPROVAL_TOOLS,
  ...READ_TOOLS,
  ...SEARCH_TOOLS,
])

function createShellEnvironment() {
  return Object.fromEntries(
    SAFE_ENV_NAMES.flatMap((name) =>
      typeof process.env[name] === "string" ? [[name, process.env[name]]] : []
    )
  )
}

function toolKind(toolName) {
  if (READ_TOOLS.has(toolName)) {
    return "read"
  }

  if (SEARCH_TOOLS.has(toolName)) {
    return "search"
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
  if (mode === "full_access" || NO_APPROVAL_TOOLS.has(toolName)) {
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

export class AcpPermissionBackend {
  constructor({ client, cwd, permissionMode, sessionId, signal }) {
    this.client = client
    this.cwd = realpathSync(resolve(cwd))
    this.permissionMode = permissionMode
    this.sessionId = sessionId
    this.signal = signal
    this.env = createShellEnvironment()
  }

  async ensureReady() {}

  async close() {}

  assertWorkspacePath(filePath) {
    if (typeof filePath !== "string" || !filePath.trim()) {
      throw new Error("Tool path must be a non-empty string.")
    }

    if (/^~(?:[\\/]|$)/.test(filePath.trim())) {
      throw new Error(`Path must stay inside the selected workspace: ${this.cwd}`)
    }

    const lexicalPath = isAbsolute(filePath)
      ? resolve(filePath)
      : resolve(this.cwd, filePath)
    const lexicalRelation = relative(this.cwd, lexicalPath)

    if (
      lexicalRelation === ".." ||
      lexicalRelation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
      isAbsolute(lexicalRelation)
    ) {
      throw new Error(`Path must stay inside the selected workspace: ${this.cwd}`)
    }

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

    const canonicalAncestor = realpathSync(existingAncestor)
    const canonicalPath = resolve(
      canonicalAncestor,
      relative(existingAncestor, lexicalPath)
    )
    const canonicalRelation = relative(this.cwd, canonicalPath)

    if (
      canonicalRelation === ".." ||
      canonicalRelation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
      isAbsolute(canonicalRelation)
    ) {
      throw new Error(`Path must stay inside the selected workspace: ${this.cwd}`)
    }

    return canonicalPath
  }

  async permissionDenial(toolName, input, signal = this.signal) {
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
        { signal }
      )
    } catch (error) {
      return `Permission request failed: ${asErrorMessage(error)}`
    }

    return response?.outcome?.outcome === "selected" &&
      response.outcome.optionId === "allow_once"
      ? null
      : "The user did not approve this operation."
  }

  async beforeToolCall(context, signal = this.signal) {
    const toolName = context?.toolCall?.name || "tool"
    const input = context?.args || {}
    const inputRecord = getRecord(input)

    try {
      for (const filePath of toolPaths(toolName, input)) {
        assertUnambiguousPiPath(filePath)
        const safePath = this.assertWorkspacePath(filePath)

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

    const denial = await this.permissionDenial(toolName, input, signal)

    return denial ? { block: true, reason: denial } : undefined
  }

  createTools() {
    const options = {
      bash: {
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

    return [...coding, ...search]
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
      const shell = this.env.SHELL || "/bin/sh"
      const child = spawn(shell, ["-lc", command], {
        cwd: this.cwd,
        env: { ...this.env },
        signal: this.signal,
      })
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

      child.stdout.on("data", append)
      child.stderr.on("data", append)
      child.once("error", reject)
      child.once("close", (code) => {
        resolvePromise({
          output: Buffer.concat(chunks).toString("utf8"),
          exitCode: code ?? 1,
          truncated: bytes >= 100_000,
        })
      })
    })
  }
}
