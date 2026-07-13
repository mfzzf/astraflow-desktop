import { posix } from "node:path"

import { type CommandResult, type Sandbox } from "@e2b/code-interpreter"
import {
  BaseSandbox,
  type EditResult,
  type ExecuteResponse,
  type FileData,
  type FileDownloadResponse,
  type FileInfo,
  type FileOperationError,
  type FileUploadResponse,
  type GlobResult,
  type GrepResult,
  type LsResult,
  type ReadRawResult,
  type ReadResult,
  type WriteResult,
} from "deepagents"

import {
  ASTRAFLOW_SANDBOX_DEFAULT_RUN_TIMEOUT_SECONDS,
  ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
  getAstraFlowLongLivedCommandGuidance,
  normalizeAstraFlowCommandResult,
} from "@/lib/astraflow-sandbox-runtime"
import {
  requestToolPermission,
  type PermissionGatewayContext,
} from "@/lib/agent/permission-gateway"
import {
  appendCommandOutput,
  beginCommandRun,
  endCommandRun,
} from "@/lib/agent/command-output-stream"
import { connectStudioSessionWorkspaceSandbox } from "@/lib/astraflow-session-sandbox"
import {
  normalizeSandboxWorkspaceRoot,
  resolveSandboxWorkspacePath,
} from "@/lib/sandbox-workspace-paths"
import { withStudioSessionLock } from "@/lib/studio-session-lock"

const DEEPAGENTS_SANDBOX_MAX_OUTPUT_CHARS = 18_000
type DeepAgentsE2BBackendOptions = {
  sessionId: string
  workspaceId: string
  workspaceRoot: string
  apiKey: string
  commandTimeoutSeconds?: number
  permissionContext: PermissionGatewayContext
  signal: AbortSignal
}

function quoteShell(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function truncateOutput(output: string) {
  if (output.length <= DEEPAGENTS_SANDBOX_MAX_OUTPUT_CHARS) {
    return { output, truncated: false }
  }

  return {
    output: `${output.slice(0, DEEPAGENTS_SANDBOX_MAX_OUTPUT_CHARS)}\n...[truncated ${
      output.length - DEEPAGENTS_SANDBOX_MAX_OUTPUT_CHARS
    } chars]`,
    truncated: true,
  }
}

function formatCommandOutput(result: CommandResult) {
  const sections: string[] = []
  const stdout = result.stdout.trim()
  const stderr = result.stderr.trim()

  if (stdout) {
    sections.push(stdout)
  }

  if (stderr) {
    sections.push(`STDERR:\n${stderr}`)
  }

  if (result.error) {
    sections.push(`ERROR:\n${result.error}`)
  }

  return sections.join("\n\n")
}

function toUint8Array(value: unknown) {
  if (value instanceof Uint8Array) {
    return value
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }

  if (typeof value === "string") {
    return new TextEncoder().encode(value)
  }

  return new Uint8Array()
}

function uint8ArrayToArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)

  return buffer
}

function decodeText(bytes: Uint8Array) {
  if (bytes.includes(0)) {
    return null
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function createFileData(path: string, bytes: Uint8Array): FileData {
  const now = new Date().toISOString()
  const text = decodeText(bytes)

  return {
    content: text ?? bytes,
    mimeType: text === null ? inferBinaryMimeType(path) : "text/plain",
    created_at: now,
    modified_at: now,
  }
}

function inferBinaryMimeType(path: string) {
  const extension = path.split(".").at(-1)?.toLowerCase()

  if (extension === "png") {
    return "image/png"
  }

  if (extension === "jpg" || extension === "jpeg") {
    return "image/jpeg"
  }

  if (extension === "gif") {
    return "image/gif"
  }

  if (extension === "webp") {
    return "image/webp"
  }

  if (extension === "pdf") {
    return "application/pdf"
  }

  return "application/octet-stream"
}

function normalizeFileError(error: unknown): FileOperationError {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()

  if (lower.includes("not found") || lower.includes("no such file")) {
    return "file_not_found"
  }

  if (lower.includes("permission") || lower.includes("denied")) {
    return "permission_denied"
  }

  if (lower.includes("directory")) {
    return "is_directory"
  }

  return "invalid_path"
}

function normalizeFileInfo(basePath: string, entry: unknown): FileInfo {
  const record =
    typeof entry === "object" && entry !== null
      ? (entry as Record<string, unknown>)
      : {}
  const name = typeof record.name === "string" ? record.name : ""
  const path =
    typeof record.path === "string" && record.path
      ? record.path
      : posix.join(basePath, name)
  const type = typeof record.type === "string" ? record.type : ""
  const size = typeof record.size === "number" ? record.size : undefined
  const modifiedAt =
    typeof record.modifiedAt === "string"
      ? record.modifiedAt
      : typeof record.modified_at === "string"
        ? record.modified_at
        : undefined

  return {
    path,
    is_dir: type === "dir" || type === "directory",
    ...(size !== undefined ? { size } : {}),
    ...(modifiedAt ? { modified_at: modifiedAt } : {}),
  }
}

function sliceLines(content: string, offset = 0, limit = 500) {
  const start = Math.max(Math.trunc(offset), 0)
  const count = Math.max(Math.trunc(limit), 1)

  return content
    .split(/\r?\n/)
    .slice(start, start + count)
    .join("\n")
}

export class DeepAgentsE2BBackend extends BaseSandbox {
  readonly id: string

  private readonly apiKey: string
  private readonly commandTimeoutSeconds: number
  private readonly permissionContext: PermissionGatewayContext
  private readonly sessionId: string
  private readonly signal: AbortSignal
  private readonly workspaceRoot: string
  private readonly workspaceId: string
  private sandboxPromise: Promise<Sandbox> | null = null

  constructor({
    apiKey,
    commandTimeoutSeconds = ASTRAFLOW_SANDBOX_DEFAULT_RUN_TIMEOUT_SECONDS,
    permissionContext,
    signal,
    sessionId,
    workspaceId,
    workspaceRoot,
  }: DeepAgentsE2BBackendOptions) {
    super()
    this.apiKey = apiKey
    this.commandTimeoutSeconds = commandTimeoutSeconds
    this.id = `astraflow-e2b:${workspaceId}:${sessionId}`
    this.permissionContext = permissionContext
    this.sessionId = sessionId
    this.signal = signal
    this.workspaceId = workspaceId
    this.workspaceRoot = normalizeSandboxWorkspaceRoot(workspaceRoot)
  }

  private resolveReadPath(path: string) {
    return resolveSandboxWorkspacePath({
      allowPrivateRead: true,
      path,
      workspaceRoot: this.workspaceRoot,
    })
  }

  private resolveWritePath(path: string) {
    return resolveSandboxWorkspacePath({
      path,
      workspaceRoot: this.workspaceRoot,
    })
  }

  private getSandbox() {
    this.sandboxPromise ??= connectStudioSessionWorkspaceSandbox({
      apiKey: this.apiKey,
      sessionId: this.sessionId,
      workspaceId: this.workspaceId,
    }).catch((error) => {
      this.sandboxPromise = null
      throw error
    })

    return this.sandboxPromise
  }

  private async getPermissionDenial(toolName: string, input: unknown) {
    const permission = await requestToolPermission({
      context: this.permissionContext,
      input,
      toolName,
    })

    return permission.allowed ? null : permission.message
  }

  private async runCommand(command: string): Promise<ExecuteResponse> {
    const sandbox = await this.getSandbox()
    const timeoutMs = this.commandTimeoutSeconds * 1000
    // When an event sink is registered for this session, stream stdout/stderr
    // to the UI as it arrives instead of only after the command settles.
    const streamRun = beginCommandRun(this.sessionId, command)
    let result: CommandResult

    try {
      result = await sandbox.commands.run(
        `/bin/bash -l -c ${quoteShell(command)}`,
        {
          cwd: this.workspaceRoot,
          timeoutMs,
          requestTimeoutMs: Math.max(
            timeoutMs + 10_000,
            ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS
          ),
          signal: this.signal,
          ...(streamRun
            ? {
                onStdout: (data: string) =>
                  appendCommandOutput(streamRun, data),
                onStderr: (data: string) =>
                  appendCommandOutput(streamRun, data),
              }
            : {}),
        }
      )
    } catch (error) {
      const commandResult = normalizeAstraFlowCommandResult(error)

      if (!commandResult) {
        throw error
      }

      result = commandResult
    } finally {
      if (streamRun) {
        endCommandRun(this.sessionId, streamRun)
      }
    }

    const truncated = truncateOutput(formatCommandOutput(result))

    return {
      output: truncated.output,
      exitCode: result.exitCode,
      truncated: truncated.truncated,
    }
  }

  async execute(command: string): Promise<ExecuteResponse> {
    const serviceGuidance = getAstraFlowLongLivedCommandGuidance(command)

    if (serviceGuidance) {
      return {
        output: serviceGuidance,
        exitCode: 125,
        truncated: false,
      }
    }

    const denial = await this.getPermissionDenial("execute", { command })

    if (denial) {
      return {
        output: denial,
        exitCode: 1,
        truncated: false,
      }
    }

    return withStudioSessionLock(this.sessionId, () => this.runCommand(command))
  }

  override async ls(path: string): Promise<LsResult> {
    return withStudioSessionLock(this.sessionId, async () => {
      try {
        const sandbox = await this.getSandbox()
        const resolvedPath = this.resolveReadPath(path)
        const entries = await sandbox.files.list(resolvedPath, {
          requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
        })

        return {
          files: entries.map((entry) => normalizeFileInfo(resolvedPath, entry)),
        }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  override async read(
    filePath: string,
    offset?: number,
    limit?: number
  ): Promise<ReadResult> {
    return withStudioSessionLock(this.sessionId, async () => {
      try {
        const sandbox = await this.getSandbox()
        const resolvedPath = this.resolveReadPath(filePath)
        const bytes = toUint8Array(
          await sandbox.files.read(resolvedPath, {
            format: "bytes",
            requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
          })
        )
        const text = decodeText(bytes)

        if (text === null) {
          return {
            content: bytes,
            mimeType: inferBinaryMimeType(resolvedPath),
          }
        }

        return {
          content: sliceLines(text, offset, limit),
          mimeType: "text/plain",
        }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  override async readRaw(filePath: string): Promise<ReadRawResult> {
    return withStudioSessionLock(this.sessionId, async () => {
      try {
        const sandbox = await this.getSandbox()
        const resolvedPath = this.resolveReadPath(filePath)
        const bytes = toUint8Array(
          await sandbox.files.read(resolvedPath, {
            format: "bytes",
            requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
          })
        )

        return {
          data: createFileData(resolvedPath, bytes),
        }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  override async write(
    filePath: string,
    content: string
  ): Promise<WriteResult> {
    const denial = await this.getPermissionDenial("write_file", {
      path: filePath,
      content,
    })

    if (denial) {
      return { error: denial }
    }

    return withStudioSessionLock(this.sessionId, async () => {
      try {
        const sandbox = await this.getSandbox()
        const resolvedPath = this.resolveWritePath(filePath)

        await sandbox.files.write(resolvedPath, content, {
          requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
        })

        return {
          path: resolvedPath,
          filesUpdate: null,
        }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  override async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll = false
  ): Promise<EditResult> {
    const denial = await this.getPermissionDenial("edit_file", {
      path: filePath,
      oldString,
      newString,
      replaceAll,
    })

    if (denial) {
      return { error: denial }
    }

    return withStudioSessionLock(this.sessionId, async () => {
      try {
        const sandbox = await this.getSandbox()
        const resolvedPath = this.resolveWritePath(filePath)
        const bytes = toUint8Array(
          await sandbox.files.read(resolvedPath, {
            format: "bytes",
            requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
          })
        )
        const current = decodeText(bytes)

        if (current === null) {
          return { error: "Cannot edit binary file content." }
        }

        const occurrences = replaceAll
          ? current.split(oldString).length - 1
          : current.includes(oldString)
            ? 1
            : 0

        if (occurrences === 0) {
          return { error: "String to replace was not found." }
        }

        const next = replaceAll
          ? current.split(oldString).join(newString)
          : current.replace(oldString, newString)

        await sandbox.files.write(resolvedPath, next, {
          requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
        })

        return {
          path: resolvedPath,
          filesUpdate: null,
          occurrences,
        }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  override async uploadFiles(
    files: Array<[string, Uint8Array]>
  ): Promise<FileUploadResponse[]> {
    const denial = await this.getPermissionDenial(
      "upload_file",
      files.map(([path, content]) => ({
        path,
        bytes: content.byteLength,
      }))
    )

    if (denial) {
      return files.map(([path]) => ({ path, error: "permission_denied" }))
    }

    return withStudioSessionLock(this.sessionId, async () => {
      const sandbox = await this.getSandbox()
      const responses: FileUploadResponse[] = []

      for (const [path, content] of files) {
        try {
          const resolvedPath = this.resolveWritePath(path)

          await sandbox.files.write(
            resolvedPath,
            uint8ArrayToArrayBuffer(content),
            {
            requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
            }
          )
          responses.push({ path: resolvedPath, error: null })
        } catch (error) {
          responses.push({ path, error: normalizeFileError(error) })
        }
      }

      return responses
    })
  }

  override async downloadFiles(
    paths: string[]
  ): Promise<FileDownloadResponse[]> {
    return withStudioSessionLock(this.sessionId, async () => {
      const sandbox = await this.getSandbox()
      const responses: FileDownloadResponse[] = []

      for (const path of paths) {
        try {
          const resolvedPath = this.resolveReadPath(path)
          const content = toUint8Array(
            await sandbox.files.read(resolvedPath, {
              format: "bytes",
              requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
            })
          )
          responses.push({ path: resolvedPath, content, error: null })
        } catch (error) {
          responses.push({
            path,
            content: null,
            error: normalizeFileError(error),
          })
        }
      }

      return responses
    })
  }

  override async grep(
    pattern: string,
    path = "/",
    glob: string | null = null
  ): Promise<GrepResult> {
    try {
      return await super.grep(pattern, this.resolveReadPath(path), glob)
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  override async glob(pattern: string, path = "/"): Promise<GlobResult> {
    try {
      return await super.glob(pattern, this.resolveReadPath(path))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }
}
