import { homedir } from "node:os"
import { isAbsolute, resolve } from "node:path"

import {
  LocalShellBackend,
  type EditResult,
  type ExecuteResponse,
  type FileDownloadResponse,
  type FileUploadResponse,
  type GlobResult,
  type GrepResult,
  type LsResult,
  type ReadRawResult,
  type ReadResult,
  type WriteResult,
} from "deepagents"

import { ASTRAFLOW_SANDBOX_DEFAULT_RUN_TIMEOUT_SECONDS } from "@/lib/astraflow-sandbox-runtime"
import {
  requestToolPermission,
  type PermissionGatewayContext,
} from "@/lib/agent/permission-gateway"
import {
  appendCommandOutput,
  beginCommandRun,
  endCommandRun,
} from "@/lib/agent/command-output-stream"
import {
  spawnLocalSandboxedCommand,
  terminateLocalSandboxedCommand,
} from "@/lib/agent/sandbox/local-command"
import {
  ensureLocalSandboxWorkspace,
  resolveLocalSandboxReadPath,
  resolveLocalSandboxWritePath,
} from "@/lib/agent/sandbox/local-policy"
import { withStudioSessionLock } from "@/lib/studio-session-lock"

type DeepAgentsLocalBackendOptions = {
  rootDir: string
  sessionId: string
  permissionContext: PermissionGatewayContext
}

const LOCAL_SEARCH_TIMEOUT_MS = 10_000
const LOCAL_SEARCH_MAX_RESULTS = 200
// Matches LocalShellBackend's default maxOutputBytes so the streamed override
// produces the same final output as the parent implementation.
const LOCAL_COMMAND_MAX_OUTPUT_BYTES = 100_000
const BROAD_HOME_GLOB_ERROR =
  "Glob search was not started because recursive ** searches from the home directory can hang the desktop client. Select or open a project folder, or retry with a narrower path/pattern such as AGENTS.md, */AGENTS.md, or a known project directory."
const BROAD_HOME_GREP_ERROR =
  "Grep search was not started because searching the entire home directory can hang the desktop client. Select or open a project folder, or retry with a narrower path or file glob."

// Runs Deep Agent filesystem tools against the selected local project and
// executes every command through the fail-closed AstraFlow OS sandbox.
// Permissions decide whether an operation is approved; the path policy and
// @anthropic-ai/sandbox-runtime enforce the boundary after approval.
export class DeepAgentsLocalBackend extends LocalShellBackend {
  private readonly rootDir: string
  private readonly permissionContext: PermissionGatewayContext
  private readonly sessionId: string
  private readonly workspaceDir: string
  private initializePromise: Promise<void> | null = null

  constructor({
    permissionContext,
    rootDir,
    sessionId,
  }: DeepAgentsLocalBackendOptions) {
    super({
      rootDir,
      inheritEnv: false,
      timeout: ASTRAFLOW_SANDBOX_DEFAULT_RUN_TIMEOUT_SECONDS,
    })
    this.rootDir = resolve(rootDir)
    this.permissionContext = permissionContext
    this.sessionId = sessionId
    this.workspaceDir = ensureLocalSandboxWorkspace(sessionId)
  }

  private ensureReady() {
    if (this.isInitialized) {
      return Promise.resolve()
    }

    this.initializePromise ??= this.initialize().catch((error) => {
      this.initializePromise = null
      throw error
    })

    return this.initializePromise
  }

  private async getPermissionDenial(toolName: string, input: unknown) {
    const permission = await requestToolPermission({
      context: this.permissionContext,
      input,
      toolName,
    })

    return permission.allowed ? null : permission.message
  }

  private getReadPathDenial(filePath: string) {
    try {
      resolveLocalSandboxReadPath(this.rootDir, filePath)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  private getSearchResultPathDenial(searchPath: string, resultPath: string) {
    const candidate = isAbsolute(resultPath)
      ? resultPath
      : resolve(this.resolveSearchPath(searchPath), resultPath)

    return this.getReadPathDenial(candidate)
  }

  private getWritePathDenial(filePath: string) {
    try {
      resolveLocalSandboxWritePath(this.rootDir, filePath, [this.workspaceDir])
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  private resolveSearchPath(searchPath = "/") {
    const trimmedSearchPath = searchPath.trim()

    if (!trimmedSearchPath || trimmedSearchPath === "/") {
      return this.rootDir
    }

    if (isAbsolute(trimmedSearchPath)) {
      return resolve(trimmedSearchPath)
    }

    return resolve(this.rootDir, trimmedSearchPath)
  }

  private isBroadHomeGlob(pattern: string, searchPath = "/") {
    const normalizedPattern = pattern.replace(/\\/g, "/").replace(/^\/+/, "")

    return (
      normalizedPattern.includes("**") &&
      this.isHomeDirectorySearch(searchPath)
    )
  }

  private isHomeDirectorySearch(searchPath = "/") {
    return this.resolveSearchPath(searchPath) === resolve(homedir())
  }

  private async runWithTimeout<T extends { error?: string }>(
    work: Promise<T>,
    timeoutMessage: string
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null

    try {
      return await Promise.race([
        work,
        new Promise<T>((resolveTimeout) => {
          timer = setTimeout(() => {
            resolveTimeout({ error: timeoutMessage } as T)
          }, LOCAL_SEARCH_TIMEOUT_MS)
        }),
      ])
    } finally {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }

  private limitGlobResult(result: GlobResult): GlobResult {
    if (!result.files || result.files.length <= LOCAL_SEARCH_MAX_RESULTS) {
      return result
    }

    return {
      error:
        result.error ??
        `Glob matched ${result.files.length} entries; returning the first ${LOCAL_SEARCH_MAX_RESULTS}. Retry with a narrower path or pattern.`,
      files: result.files.slice(0, LOCAL_SEARCH_MAX_RESULTS),
    }
  }

  private limitGrepResult(result: GrepResult): GrepResult {
    if (!result.matches || result.matches.length <= LOCAL_SEARCH_MAX_RESULTS) {
      return result
    }

    return {
      error:
        result.error ??
        `Grep matched ${result.matches.length} entries; returning the first ${LOCAL_SEARCH_MAX_RESULTS}. Retry with a narrower path or file glob.`,
      matches: result.matches.slice(0, LOCAL_SEARCH_MAX_RESULTS),
    }
  }

  // Read paths run on the user's real machine, so they must pass through the
  // permission gateway too. Ordinary reads can auto-approve, while the path
  // policy still hard-denies secret stores and .env files after approval.
  override async read(
    filePath: string,
    offset = 0,
    limit = 500
  ): Promise<ReadResult> {
    const denial = await this.getPermissionDenial("read_file", {
      path: filePath,
      offset,
      limit,
    })

    if (denial) {
      return { error: denial }
    }

    const pathDenial = this.getReadPathDenial(filePath)

    if (pathDenial) {
      return { error: pathDenial }
    }

    return super.read(filePath, offset, limit)
  }

  override async readRaw(filePath: string): Promise<ReadRawResult> {
    const denial = await this.getPermissionDenial("read_file", {
      path: filePath,
    })

    if (denial) {
      return { error: denial }
    }

    const pathDenial = this.getReadPathDenial(filePath)

    if (pathDenial) {
      return { error: pathDenial }
    }

    return super.readRaw(filePath)
  }

  override async downloadFiles(
    paths: string[]
  ): Promise<FileDownloadResponse[]> {
    const denial = await this.getPermissionDenial(
      "read_file",
      paths.map((path) => ({ path }))
    )

    if (denial) {
      return paths.map((path) => ({
        path,
        content: null,
        error: "permission_denied",
      }))
    }

    const responses: FileDownloadResponse[] = []

    for (const path of paths) {
      if (this.getReadPathDenial(path)) {
        responses.push({ path, content: null, error: "permission_denied" })
        continue
      }

      responses.push(...(await super.downloadFiles([path])))
    }

    return responses
  }

  override async ls(dirPath: string): Promise<LsResult> {
    const denial = await this.getPermissionDenial("ls", { path: dirPath })

    if (denial) {
      return { error: denial }
    }

    const pathDenial = this.getReadPathDenial(dirPath)

    if (pathDenial) {
      return { error: pathDenial }
    }

    const result = await super.ls(dirPath)

    return {
      ...result,
      files: result.files?.filter(
        (file) => this.getReadPathDenial(file.path) === null
      ),
    }
  }

  override async glob(pattern: string, searchPath = "/"): Promise<GlobResult> {
    const denial = await this.getPermissionDenial("glob", {
      pattern,
      path: searchPath,
    })

    if (denial) {
      return { error: denial }
    }

    const pathDenial = this.getReadPathDenial(this.resolveSearchPath(searchPath))

    if (pathDenial) {
      return { error: pathDenial }
    }

    if (this.isBroadHomeGlob(pattern, searchPath)) {
      return { error: BROAD_HOME_GLOB_ERROR }
    }

    const result = this.limitGlobResult(
      await this.runWithTimeout(
        super.glob(pattern, searchPath),
        `Glob search timed out after ${
          LOCAL_SEARCH_TIMEOUT_MS / 1000
        }s. Retry with a narrower path or pattern.`
      )
    )

    return {
      ...result,
      files: result.files?.filter(
        (file) =>
          this.getSearchResultPathDenial(searchPath, file.path) === null
      ),
    }
  }

  override async grep(
    pattern: string,
    searchPath = "/",
    glob: string | null = null
  ): Promise<GrepResult> {
    // Grep returns matching file content, so gate it like read: silent for
    // ordinary paths, user approval when the target matches secret patterns.
    const denial = await this.getPermissionDenial("grep", {
      pattern,
      path: searchPath,
      glob,
    })

    if (denial) {
      return { error: denial }
    }

    const pathDenial = this.getReadPathDenial(this.resolveSearchPath(searchPath))

    if (pathDenial) {
      return { error: pathDenial }
    }

    if (this.isHomeDirectorySearch(searchPath)) {
      return { error: BROAD_HOME_GREP_ERROR }
    }

    const result = this.limitGrepResult(
      await this.runWithTimeout(
        super.grep(pattern, searchPath, glob),
        `Grep search timed out after ${
          LOCAL_SEARCH_TIMEOUT_MS / 1000
        }s. Retry with a narrower path or file glob.`
      )
    )

    return {
      ...result,
      matches: result.matches?.filter(
        (match) => this.getReadPathDenial(match.path) === null
      ),
    }
  }

  override async execute(command: string): Promise<ExecuteResponse> {
    const denial = await this.getPermissionDenial("execute", { command })

    if (denial) {
      return {
        output: denial,
        exitCode: 1,
        truncated: false,
      }
    }

    return withStudioSessionLock(this.sessionId, async () => {
      await this.ensureReady()

      return this.runStreamingCommand(command)
    })
  }

  // Reimplements LocalShellBackend.execute with a spawned child so stdout and
  // stderr can stream to the UI as they arrive, while preserving the parent's
  // final output format (combined stdout + `[stderr]`-prefixed stderr, byte
  // truncation, exit-code suffix, and timeout message).
  private runStreamingCommand(command: string): Promise<ExecuteResponse> {
    if (!command || typeof command !== "string") {
      return Promise.resolve({
        output: "Error: Command must be a non-empty string.",
        exitCode: 1,
        truncated: false,
      })
    }

    const timeoutSeconds = ASTRAFLOW_SANDBOX_DEFAULT_RUN_TIMEOUT_SECONDS
    const streamRun = beginCommandRun(this.sessionId, command)

    return new Promise<ExecuteResponse>((resolvePromise) => {
      let stdout = ""
      let stderr = ""
      let timedOut = false
      let cancelled = false
      let settled = false

      const finish = (response: ExecuteResponse) => {
        if (settled) {
          return
        }

        settled = true

        if (streamRun) {
          endCommandRun(this.sessionId, streamRun)
        }

        resolvePromise(response)
      }

      let child: ReturnType<typeof spawnLocalSandboxedCommand>

      try {
        child = spawnLocalSandboxedCommand({
          command,
          rootDir: this.rootDir,
          sessionId: this.sessionId,
        })
      } catch (error) {
        finish({
          output: `Sandbox initialization failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          exitCode: 126,
          truncated: false,
        })
        return
      }

      const onAbort = () => {
        cancelled = true
        terminateLocalSandboxedCommand(child)
      }

      if (this.permissionContext.signal.aborted) {
        onAbort()
      } else {
        this.permissionContext.signal.addEventListener("abort", onAbort, {
          once: true,
        })
      }

      const timer = setTimeout(() => {
        timedOut = true
        terminateLocalSandboxedCommand(child)
      }, timeoutSeconds * 1000)

      timer.unref?.()

      child.stdout?.on("data", (data: Buffer) => {
        const text = data.toString()
        stdout += text

        if (streamRun) {
          appendCommandOutput(streamRun, text)
        }
      })
      child.stderr?.on("data", (data: Buffer) => {
        const text = data.toString()
        stderr += text

        if (streamRun) {
          appendCommandOutput(streamRun, text)
        }
      })
      child.on("error", (error) => {
        clearTimeout(timer)
        this.permissionContext.signal.removeEventListener("abort", onAbort)
        finish({
          output: `Sandbox command failed to start: ${error.message}`,
          exitCode: 126,
          truncated: false,
        })
      })
      child.on("close", (code, signal) => {
        clearTimeout(timer)
        this.permissionContext.signal.removeEventListener("abort", onAbort)

        if (timedOut) {
          finish({
            output: `Error: Command timed out after ${timeoutSeconds.toFixed(1)} seconds.`,
            exitCode: 124,
            truncated: false,
          })
          return
        }

        if (cancelled || signal === "SIGTERM") {
          finish({
            output: "Command cancelled before completion.",
            exitCode: 130,
            truncated: false,
          })
          return
        }

        const outputParts: string[] = []

        if (stdout) {
          outputParts.push(stdout)
        }

        if (stderr) {
          const stderrLines = stderr.trim().split("\n")
          outputParts.push(...stderrLines.map((line) => `[stderr] ${line}`))
        }

        let output = outputParts.length > 0 ? outputParts.join("\n") : "<no output>"
        let truncated = false

        if (output.length > LOCAL_COMMAND_MAX_OUTPUT_BYTES) {
          output = output.slice(0, LOCAL_COMMAND_MAX_OUTPUT_BYTES)
          output += `\n\n... Output truncated at ${LOCAL_COMMAND_MAX_OUTPUT_BYTES} bytes.`
          truncated = true
        }

        const exitCode = code ?? 1

        if (exitCode !== 0) {
          output = `${output.trimEnd()}\n\nExit code: ${exitCode}`
        }

        finish({ output, exitCode, truncated })
      })
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

    const pathDenial = this.getWritePathDenial(filePath)

    if (pathDenial) {
      return { error: pathDenial }
    }

    return withStudioSessionLock(this.sessionId, () =>
      super.write(filePath, content)
    )
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

    const pathDenial = this.getWritePathDenial(filePath)

    if (pathDenial) {
      return { error: pathDenial }
    }

    return withStudioSessionLock(this.sessionId, () =>
      super.edit(filePath, oldString, newString, replaceAll)
    )
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
      const responses: FileUploadResponse[] = []

      for (const file of files) {
        const [path] = file

        if (this.getWritePathDenial(path)) {
          responses.push({ path, error: "permission_denied" })
          continue
        }

        responses.push(...(await super.uploadFiles([file])))
      }

      return responses
    })
  }
}
