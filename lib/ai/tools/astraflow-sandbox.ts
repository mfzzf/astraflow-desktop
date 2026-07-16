import { createHash } from "node:crypto"
import { z } from "zod"

import { createAstraFlowTool } from "@/lib/ai/tools/tool"

import {
  ASTRAFLOW_SANDBOX_CODE_LANGUAGES,
  ASTRAFLOW_SANDBOX_DEFAULT_AUTO_PAUSE_TIMEOUT_SECONDS,
  ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
  getAstraFlowLongLivedCommandGuidance,
  runCommandInAstraFlowSandbox,
  runCodeInAstraFlowSandbox,
} from "@/lib/astraflow-sandbox-runtime"
import {
  getAstraFlowRuntimeErrorMessage,
  retryAstraFlowTransientOperation,
} from "@/lib/agent/transient-retry"
import { createStudioSessionFile } from "@/lib/studio-db"
import {
  connectStudioSessionWorkspaceSandbox,
  getSessionSandboxRoot,
  getSessionSandboxOutputRoot,
  normalizeSandboxFilePath,
  normalizeSandboxOutputPath,
  uploadSessionFileToSandbox,
  type SessionSandboxContext,
} from "@/lib/astraflow-session-sandbox"
import {
  createGeneratedStoragePath,
  writeStudioFile,
} from "@/lib/studio-file-storage"
import { withStudioSessionLock } from "@/lib/studio-session-lock"

const SANDBOX_FILE_READ_DEFAULT_BYTES = 32 * 1024
const SANDBOX_FILE_READ_MAX_BYTES = 120 * 1024
const SANDBOX_FILE_SUMMARY_LINES = 80
const SANDBOX_COMMAND_ENV_MAX_VARS = 40
const SANDBOX_SERVICE_HEALTH_TIMEOUT_SECONDS = 5
const SANDBOX_SERVICE_NAME_MAX_CHARS = 48
const LIST_FILES_MAX_ENTRIES = 500

function sha256Bytes(bytes: Uint8Array | Buffer | string) {
  return createHash("sha256").update(bytes).digest("hex")
}

function clampReadBytes(value: number | undefined) {
  if (!value || !Number.isFinite(value)) {
    return SANDBOX_FILE_READ_DEFAULT_BYTES
  }

  return Math.min(Math.max(Math.trunc(value), 1), SANDBOX_FILE_READ_MAX_BYTES)
}

function clampReadOffset(value: number | undefined) {
  if (!value || !Number.isFinite(value)) {
    return 0
  }

  return Math.max(Math.trunc(value), 0)
}

function summarizeTextContent(text: string) {
  const lines = text.split(/\r?\n/)
  const nonEmpty = lines
    .filter((line) => line.trim())
    .slice(0, SANDBOX_FILE_SUMMARY_LINES)

  return [`Lines: ${lines.length}`, "", "Preview lines:", ...nonEmpty].join(
    "\n"
  )
}

function normalizeCommandEnv(env: Record<string, string> | undefined) {
  if (!env) {
    return undefined
  }

  const entries = Object.entries(env)
    .map(([key, value]) => [key.trim(), value] as const)
    .filter(([key]) => key)

  if (entries.length > SANDBOX_COMMAND_ENV_MAX_VARS) {
    throw new Error(
      `Sandbox command env supports at most ${SANDBOX_COMMAND_ENV_MAX_VARS} variables.`
    )
  }

  for (const [key] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid environment variable name: ${key}`)
    }
  }

  return Object.fromEntries(entries)
}

function quoteShell(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function normalizeSandboxServiceCwd(
  cwd: string | undefined,
  workspaceRoot: string
) {
  return normalizeSandboxFilePath(cwd?.trim() || workspaceRoot, {
    relativeBase: workspaceRoot,
    workspaceRoot,
  })
}

function normalizeServiceName(name: string | undefined, port: number) {
  const normalized = (name || `preview-${port}`)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SANDBOX_SERVICE_NAME_MAX_CHARS)

  return normalized || `preview-${port}`
}

function normalizeHealthPath(path: string | undefined) {
  const trimmed = path?.trim()

  if (!trimmed) {
    return "/"
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`
}

function buildServiceShell({
  command,
  cwd,
  env,
  logPath,
}: {
  command: string
  cwd: string
  env?: Record<string, string>
  logPath: string
}) {
  const envExports = Object.entries(env ?? {}).map(
    ([key, value]) => `export ${key}=${quoteShell(value)}`
  )

  return [
    `cd ${quoteShell(cwd)}`,
    ...envExports,
    `exec ${command} > ${quoteShell(logPath)} 2>&1`,
  ].join(" && ")
}

function buildStartServiceCommand({
  command,
  cwd,
  env,
  healthPath,
  port,
  serviceName,
}: {
  command: string
  cwd: string
  env?: Record<string, string>
  healthPath: string
  port: number
  serviceName: string
}) {
  const logPath = `/tmp/astraflow-services/${serviceName}.log`
  const serviceShell = buildServiceShell({ command, cwd, env, logPath })
  const serviceRunner = `/bin/bash -lc ${quoteShell(serviceShell)}`
  const healthUrl = `http://127.0.0.1:${port}${healthPath}`

  return [
    "set -u",
    "mkdir -p /tmp/astraflow-services",
    `if command -v tmux >/dev/null 2>&1; then`,
    `  tmux kill-session -t ${quoteShell(serviceName)} 2>/dev/null || true`,
    `  tmux new-session -d -s ${quoteShell(serviceName)} ${quoteShell(
      serviceRunner
    )}`,
    `  STARTED=${quoteShell(`tmux:${serviceName}`)}`,
    "else",
    `  pkill -f ${quoteShell(`astraflow-service-${serviceName}`)} 2>/dev/null || true`,
    `  setsid /bin/bash -lc ${quoteShell(
      `exec -a ${quoteShell(`astraflow-service-${serviceName}`)} ${serviceRunner}`
    )} >/dev/null 2>&1 < /dev/null &`,
    `  STARTED=${quoteShell(`setsid:${serviceName}`)}`,
    "fi",
    "sleep 1",
    `STATUS=$(curl -sS -o /dev/null -w '%{http_code}' --max-time ${SANDBOX_SERVICE_HEALTH_TIMEOUT_SECONDS} ${quoteShell(
      healthUrl
    )} 2>/dev/null || true)`,
    `echo "Service started: $STARTED"`,
    `echo "Service name: ${serviceName}"`,
    `echo "Port: ${port}"`,
    `echo "Working directory: ${cwd}"`,
    `echo "Log: ${logPath}"`,
    `echo "Health check: ${healthUrl} -> ${"${STATUS:-failed}"}"`,
    `if [ -s ${quoteShell(logPath)} ]; then`,
    `  echo "Recent log:"`,
    `  tail -n 80 ${quoteShell(logPath)}`,
    "fi",
  ].join("\n")
}

export function createSessionSandboxGetter({
  sessionId,
  apiKey,
  workspaceId,
  workspaceRoot,
}: {
  sessionId: string
  apiKey: string
  workspaceId: string
  workspaceRoot: string
}): () => Promise<SessionSandboxContext> {
  let promise: Promise<SessionSandboxContext> | null = null

  return () => {
    promise ??= retryAstraFlowTransientOperation({
      operation: () =>
        connectStudioSessionWorkspaceSandbox({
          sessionId,
          apiKey,
          workspaceId,
        }),
      onRetry: (error, retry) => {
        console.warn("[studio-runtime] transient_operation_retry", {
          runtimeId: "astraflow",
          environment: "remote",
          operation: "connect_sandbox",
          retry,
          maxRetries: 2,
          error: getAstraFlowRuntimeErrorMessage(error),
          sessionId,
          workspaceId,
        })
      },
    })
      .then((sandbox) => ({
        sandbox,
        sandboxId: sandbox.sandboxId,
        workspaceId,
        workspaceRoot,
        files: [],
        manifest: "",
      }))
      .catch((error) => {
        promise = null
        throw error
      })
    return promise as Promise<SessionSandboxContext>
  }
}

export function createCodeInterpreterTool({
  getSandboxContext,
  sessionId,
  workspaceRoot,
}: {
  getSandboxContext: () => Promise<SessionSandboxContext>
  sessionId: string
  workspaceRoot: string
}) {
  return createAstraFlowTool(
    async ({ code, language, timeout_seconds }) => {
      try {
        return await withStudioSessionLock(sessionId, async () => {
          const { sandbox, sandboxId } = await getSandboxContext()

          return runCodeInAstraFlowSandbox({
            sandbox,
            code,
            language: language ?? "python",
            cwd: workspaceRoot,
            timeoutSeconds: timeout_seconds ?? 60,
            lifecycleLine: "Auto pause: true",
            cleanupLine: `Lifecycle: AstraFlow Sandbox ${sandboxId} is reused for this chat session and will auto-pause after ${ASTRAFLOW_SANDBOX_DEFAULT_AUTO_PAUSE_TIMEOUT_SECONDS}s of inactivity with memory and filesystem preserved.`,
          })
        })
      } catch (error) {
        return `run_code failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      }
    },
    {
      name: "run_code",
      description:
        `Run code in this chat session's persistent AstraFlow Sandbox workspace. Supported languages are python, javascript, typescript, bash, r, and java. Code starts in ${workspaceRoot}; save user-visible files under this workspace (prefer ${getSessionSandboxOutputRoot(workspaceRoot)}). The sandbox automatically pauses after inactivity and auto-resumes on later traffic with memory and filesystem preserved. Uploaded session files are available at their sandbox paths.`,
      schema: z.object({
        code: z.string().min(1).describe("The code to execute."),
        language: z
          .enum(ASTRAFLOW_SANDBOX_CODE_LANGUAGES)
          .optional()
          .describe("Code language to execute."),
        timeout_seconds: z
          .number()
          .int()
          .min(1)
          .max(300)
          .optional()
          .describe("Maximum time to allow this code cell to run."),
      }),
    }
  )
}

export function createRunCommandTool({
  getSandboxContext,
  sessionId,
  workspaceRoot,
}: {
  getSandboxContext: () => Promise<SessionSandboxContext>
  sessionId: string
  workspaceRoot: string
}) {
  return createAstraFlowTool(
    async ({ command, cwd, env, timeout_seconds }) => {
      try {
        const serviceGuidance = getAstraFlowLongLivedCommandGuidance(command)

        if (serviceGuidance) {
          return `run_command skipped:\n${serviceGuidance}`
        }

        return await withStudioSessionLock(sessionId, async () => {
          const { sandbox, sandboxId } = await getSandboxContext()
          const workingDirectory = cwd?.trim()
            ? normalizeSandboxFilePath(cwd, {
                relativeBase: getSessionSandboxRoot(workspaceRoot),
                workspaceRoot,
              })
            : getSessionSandboxRoot(workspaceRoot)

          return runCommandInAstraFlowSandbox({
            sandbox,
            command,
            cwd: workingDirectory,
            env: normalizeCommandEnv(env),
            timeoutSeconds: timeout_seconds ?? 60,
            lifecycleLine: "Auto pause: true",
            cleanupLine: `Lifecycle: AstraFlow Sandbox ${sandboxId} is reused for this chat session and will auto-pause after ${ASTRAFLOW_SANDBOX_DEFAULT_AUTO_PAUSE_TIMEOUT_SECONDS}s of inactivity with memory and filesystem preserved.`,
          })
        })
      } catch (error) {
        return `run_command failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      }
    },
    {
      name: "run_command",
      description:
        `Run a shell command in this chat session's persistent AstraFlow Sandbox via sandbox.commands.run. Commands execute with /bin/bash -l -c and default to workspace ${workspaceRoot}. Use this for bash utilities, package or environment inspection, shell pipelines, and workspace filesystem operations. Prefer run_code for calculations, data processing, and language-specific scripts. Use sandbox_start_service instead of run_command for preview servers, dev servers, websocket servers, or other long-running processes. For sandbox-internal health checks, use http://127.0.0.1:<port>, not http://0.0.0.0:<port>. Never present localhost, 127.0.0.1, or 0.0.0.0 as the final user-facing URL; 0.0.0.0 is only a listen address.`,
      schema: z.object({
        command: z
          .string()
          .trim()
          .min(1)
          .describe("Shell command to execute with /bin/bash -l -c."),
        cwd: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            `Optional working directory under ${workspaceRoot}. Defaults to ${workspaceRoot}; relative paths resolve there.`
          ),
        env: z
          .record(z.string(), z.string())
          .optional()
          .describe("Optional environment variables for this command."),
        timeout_seconds: z
          .number()
          .int()
          .min(1)
          .max(300)
          .optional()
          .describe("Maximum time to allow this command to run."),
      }),
    }
  )
}

export function createSandboxGetHostTool({
  getSandboxContext,
  sessionId,
}: {
  getSandboxContext: () => Promise<SessionSandboxContext>
  sessionId: string
}) {
  return createAstraFlowTool(
    async ({ port }) => {
      try {
        return await withStudioSessionLock(sessionId, async () => {
          const { sandbox, sandboxId } = await getSandboxContext()
          const host = sandbox.getHost(port)
          const hostWithScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(host)
            ? host
            : `https://${host}`
          const websocketUrl = hostWithScheme.replace(/^http/i, "ws")

          return [
            "Sandbox host resolved.",
            `Sandbox ID: ${sandboxId}`,
            `Port: ${port}`,
            `Host: ${host}`,
            `URL: ${hostWithScheme}`,
            `WebSocket URL: ${websocketUrl}`,
            `Make sure the service inside the sandbox is listening on 0.0.0.0:${port}.`,
          ].join("\n")
        })
      } catch (error) {
        return `sandbox_get_host failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      }
    },
    {
      name: "sandbox_get_host",
      description:
        "Resolve the public host address for a port in this chat session's persistent AstraFlow Sandbox. This wraps sandbox.getHost(port), equivalent to sandbox.get_host(port). Use sandbox_start_service for new preview servers; use this when the service is already running. The service must already be listening on 0.0.0.0:<port>; localhost or 127.0.0.1 listeners are not reachable through the sandbox proxy. Return the resolved public URL to the user, optionally with the served file path appended. Never present http://0.0.0.0:<port>, http://localhost:<port>, or http://127.0.0.1:<port> as the user-facing URL.",
      schema: z.object({
        port: z
          .number()
          .int()
          .min(1)
          .max(65_535)
          .describe("Port number inside the sandbox to expose."),
      }),
    }
  )
}

export function createSandboxStartServiceTool({
  getSandboxContext,
  sessionId,
  workspaceRoot,
}: {
  getSandboxContext: () => Promise<SessionSandboxContext>
  sessionId: string
  workspaceRoot: string
}) {
  return createAstraFlowTool(
    async ({ command, port, cwd, env, name, health_path }) => {
      try {
        return await withStudioSessionLock(sessionId, async () => {
          const { sandbox, sandboxId } = await getSandboxContext()
          const serviceName = normalizeServiceName(name, port)
          const workingDirectory = normalizeSandboxServiceCwd(
            cwd,
            workspaceRoot
          )
          const normalizedEnv = normalizeCommandEnv(env)
          const healthPath = normalizeHealthPath(health_path)
          const startCommand = buildStartServiceCommand({
            command,
            cwd: workingDirectory,
            env: normalizedEnv,
            healthPath,
            port,
            serviceName,
          })
          const startResult = await runCommandInAstraFlowSandbox({
            sandbox,
            command: startCommand,
            cwd: workspaceRoot,
            timeoutSeconds: 20,
            lifecycleLine: "Auto pause: true",
            cleanupLine: `Lifecycle: AstraFlow Sandbox ${sandboxId} is reused for this chat session and will auto-pause after ${ASTRAFLOW_SANDBOX_DEFAULT_AUTO_PAUSE_TIMEOUT_SECONDS}s of inactivity with memory and filesystem preserved.`,
          })
          const host = sandbox.getHost(port)
          const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(host)
            ? host
            : `https://${host}`

          return [
            startResult,
            "Sandbox service endpoint:",
            `Service name: ${serviceName}`,
            `Port: ${port}`,
            `URL: ${url}`,
            `Health URL inside sandbox: http://127.0.0.1:${port}${healthPath}`,
          ].join("\n\n")
        })
      } catch (error) {
        return `sandbox_start_service failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      }
    },
    {
      name: "sandbox_start_service",
      description:
        "Start a long-lived web preview or API service in the persistent AstraFlow Sandbox without blocking the agent. Pass the foreground service command, such as python3 -m http.server 8080 --bind 0.0.0.0, not nohup/tmux/background wrappers and not a curl health check. The tool starts or replaces a detached tmux/setsid service, runs a short localhost health check, and returns the public sandbox URL. Use this instead of execute/run_command for preview servers, dev servers, websocket servers, or other long-running processes.",
      schema: z.object({
        command: z
          .string()
          .trim()
          .min(1)
          .describe(
            "Foreground command that starts the service. The service must listen on 0.0.0.0:<port>."
          ),
        port: z
          .number()
          .int()
          .min(1)
          .max(65_535)
          .describe("Port the service listens on inside the sandbox."),
        cwd: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            `Working directory under ${workspaceRoot}. Defaults to ${workspaceRoot}.`
          ),
        env: z
          .record(z.string(), z.string())
          .optional()
          .describe("Optional environment variables for the service."),
        name: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Stable service name. Reusing the same name replaces it."),
        health_path: z
          .string()
          .trim()
          .optional()
          .describe("Path to check on http://127.0.0.1:<port>."),
      }),
    }
  )
}

export function createUploadFileTool({
  sessionId,
  apiKey,
  workspaceId,
  workspaceRoot,
}: {
  sessionId: string
  apiKey: string
  workspaceId: string
  workspaceRoot: string
}) {
  return createAstraFlowTool(
    async ({ file_id, name }) => {
      try {
        return await withStudioSessionLock(sessionId, async () => {
          const result = await uploadSessionFileToSandbox({
            sessionId,
            apiKey,
            fileId: file_id,
            name,
            workspaceId,
            workspaceRoot,
          })

          return [
            `Uploaded file: ${result.file.originalName}`,
            `File ID: ${result.file.id}`,
            `Sandbox ID: ${result.sandboxId}`,
            `Sandbox path: ${result.file.sandboxPath}`,
            result.file.mimeType ? `MIME: ${result.file.mimeType}` : null,
            typeof result.file.size === "number"
              ? `Bytes: ${result.file.size}`
              : null,
          ]
            .filter(Boolean)
            .join("\n")
        })
      } catch (error) {
        return `upload_file failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      }
    },
    {
      name: "upload_file",
      description:
        "Upload exactly one local session file into AstraFlow Sandbox on demand. Use this before analyzing uploaded PDFs, Word documents, spreadsheets, CSVs, or other files in run_code. Prefer file_id from the session file manifest; name is a fallback and must uniquely identify a file.",
      schema: z
        .object({
          file_id: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe("The file_id from the session file manifest."),
          name: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe("Fallback file name when file_id is unavailable."),
        })
        .refine((value) => Boolean(value.file_id || value.name), {
          message: "file_id or name is required.",
        }),
    }
  )
}

export function createListFilesTool({
  getSandboxContext,
  sessionId,
  workspaceRoot,
}: {
  getSandboxContext: () => Promise<SessionSandboxContext>
  sessionId: string
  workspaceRoot: string
}) {
  return createAstraFlowTool(
    async ({ path }) => {
      try {
        return await withStudioSessionLock(sessionId, async () => {
          const { sandbox } = await getSandboxContext()
          const directory = normalizeSandboxFilePath(
            path?.trim() || workspaceRoot,
            { relativeBase: workspaceRoot, workspaceRoot }
          )
          const entries = await sandbox.files.list(directory, {
            requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
          })

          if (!entries.length) {
            return `No files found in ${directory}`
          }

          const limitedEntries = entries.slice(0, LIST_FILES_MAX_ENTRIES)

          return [
            `Files in ${directory}:`,
            ...limitedEntries.map((entry) =>
              [
                `- ${entry.name}`,
                `type: ${entry.type ?? "unknown"}`,
                `path: ${entry.path}`,
                `bytes: ${entry.size}`,
              ].join(" | ")
            ),
            ...(entries.length > limitedEntries.length
              ? [
                  `...Listed the first ${limitedEntries.length} of ${entries.length} entries. Pass a narrower path to see the rest.`,
                ]
              : []),
          ].join("\n")
        })
      } catch (error) {
        return `list_files failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      }
    },
    {
      name: "list_files",
      description:
        "List files in AstraFlow Sandbox. Use this to inspect uploaded files and generated outputs.",
      schema: z.object({
        path: z
          .string()
          .trim()
          .optional()
          .describe(`Directory to list. Defaults to ${workspaceRoot}.`),
      }),
    }
  )
}

export function createReadFileTool({
  getSandboxContext,
  sessionId,
  workspaceRoot,
}: {
  getSandboxContext: () => Promise<SessionSandboxContext>
  sessionId: string
  workspaceRoot: string
}) {
  return createAstraFlowTool(
    async ({ path, offset_bytes, max_bytes, mode }) => {
      try {
        return await withStudioSessionLock(sessionId, async () => {
          const { sandbox } = await getSandboxContext()
          const sandboxPath = normalizeSandboxFilePath(path, {
            relativeBase: workspaceRoot,
            workspaceRoot,
          })
          const bytes = await sandbox.files.read(sandboxPath, {
            format: "bytes",
            requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
          })
          const offset = clampReadOffset(offset_bytes ?? 0)
          const limit = clampReadBytes(
            max_bytes ?? SANDBOX_FILE_READ_DEFAULT_BYTES
          )
          const end = Math.min(offset + limit, bytes.byteLength)
          const slice = bytes.slice(offset, end)
          const text = new TextDecoder("utf-8", { fatal: false }).decode(slice)
          const isBinary = slice.includes(0)
          const content =
            mode === "summary"
              ? summarizeTextContent(text)
              : isBinary
                ? "Binary-looking content. Use run_code with an appropriate parser instead of read_file for this file."
                : text

          return [
            `Read file: ${sandboxPath}`,
            `Bytes: ${bytes.byteLength}`,
            `SHA256: ${sha256Bytes(bytes)}`,
            `Returned bytes: ${offset}-${end} of ${bytes.byteLength}`,
            end < bytes.byteLength
              ? `More content is available. Call read_file with offset_bytes=${end}.`
              : "End of file reached.",
            "",
            content,
          ].join("\n")
        })
      } catch (error) {
        return `read_file failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      }
    },
    {
      name: "read_file",
      description:
        "Read a bounded page or summary of a text-like file from AstraFlow Sandbox. Returns SHA256 so write_file can safely overwrite later. For PDFs, Word documents, spreadsheets, or binary data, prefer run_code with Python libraries to parse the file.",
      schema: z.object({
        path: z
          .string()
          .trim()
          .min(1)
          .describe(
            `Sandbox file path under ${workspaceRoot}. Relative paths are resolved under ${workspaceRoot}.`
          ),
        offset_bytes: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Byte offset for paginated reads."),
        max_bytes: z
          .number()
          .int()
          .min(1)
          .max(SANDBOX_FILE_READ_MAX_BYTES)
          .optional()
          .describe("Maximum bytes to return. Hard-capped at 120 KB."),
        mode: z
          .enum(["page", "summary"])
          .optional()
          .describe(
            "page returns the requested byte page; summary returns metadata plus representative lines."
          ),
      }),
    }
  )
}

export function createWriteFileTool({
  getSandboxContext,
  sessionId,
  workspaceRoot,
}: {
  getSandboxContext: () => Promise<SessionSandboxContext>
  sessionId: string
  workspaceRoot: string
}) {
  return createAstraFlowTool(
    async ({ path, content, expected_sha256 }) => {
      try {
        return await withStudioSessionLock(sessionId, async () => {
          const { sandbox } = await getSandboxContext()
          const sandboxPath = normalizeSandboxOutputPath(path, workspaceRoot)

          try {
            const existing = await sandbox.files.read(sandboxPath, {
              format: "bytes",
              requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
            })
            const currentHash = sha256Bytes(existing)

            if (!expected_sha256 || expected_sha256 !== currentHash) {
              return [
                `write_file refused to overwrite existing file: ${sandboxPath}`,
                `Current SHA256: ${currentHash}`,
                "Call read_file first, then retry write_file with expected_sha256 equal to the current SHA256 if overwriting is intended.",
              ].join("\n")
            }
          } catch {
            // Missing file is fine; write creates it.
          }

          await sandbox.files.write(sandboxPath, content, {
            requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
          })

          return [
            `Wrote file: ${sandboxPath}`,
            `Bytes: ${new TextEncoder().encode(content).byteLength}`,
            `SHA256: ${sha256Bytes(content)}`,
            `Use download_file with this path if the user should download it.`,
          ].join("\n")
        })
      } catch (error) {
        return `write_file failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      }
    },
    {
      name: "write_file",
      description:
        "Write a text file inside AstraFlow Sandbox. Relative paths are written under the sandbox outputs directory. Existing files are protected: call read_file first and pass expected_sha256 to overwrite.",
      schema: z.object({
        path: z
          .string()
          .trim()
          .min(1)
          .describe(
            `Absolute path under ${workspaceRoot}, or relative path under ${getSessionSandboxOutputRoot(workspaceRoot)}.`
          ),
        content: z.string().describe("Text content to write."),
        expected_sha256: z
          .string()
          .trim()
          .regex(/^[a-f0-9]{64}$/i)
          .optional()
          .describe(
            "Required to overwrite an existing file. Use SHA256 returned by read_file."
          ),
      }),
    }
  )
}

export function createDownloadFileTool({
  getSandboxContext,
  sessionId,
  workspaceRoot,
}: {
  getSandboxContext: () => Promise<SessionSandboxContext>
  sessionId: string
  workspaceRoot: string
}) {
  return createAstraFlowTool(
    async ({ path, name, mime_type }) => {
      try {
        return await withStudioSessionLock(sessionId, async () => {
          const { sandbox } = await getSandboxContext()
          const sandboxPath = normalizeSandboxFilePath(path, {
            relativeBase: getSessionSandboxOutputRoot(workspaceRoot),
            workspaceRoot,
          })
          const bytes = await sandbox.files.read(sandboxPath, {
            format: "bytes",
            requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
          })
          const fileName =
            name?.trim() || path.split("/").filter(Boolean).at(-1) || "download"
          const storagePath = createGeneratedStoragePath({
            sessionId,
            name: fileName,
          })
          const buffer = Buffer.from(bytes)

          writeStudioFile(storagePath, buffer)
          const file = createStudioSessionFile({
            sessionId,
            kind: "generated",
            originalName: fileName,
            mimeType: mime_type?.trim() || "application/octet-stream",
            size: buffer.byteLength,
            storagePath,
            sandboxPath,
            savedAt: new Date().toISOString(),
          })

          if (!file) {
            return "download_file failed: file metadata could not be saved."
          }

          return [
            `Saved sandbox file for download: ${file.originalName}`,
            `Sandbox path: ${sandboxPath}`,
            `Bytes: ${buffer.byteLength}`,
            `SHA256: ${sha256Bytes(buffer)}`,
            `Download: [${file.originalName}](/api/studio/files/${file.id}/content?download=1)`,
          ].join("\n")
        })
      } catch (error) {
        return `download_file failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      }
    },
    {
      name: "download_file",
      description:
        "Make a sandbox file downloadable by saving it to AstraFlow's local file library. Use after generating reports, CSVs, plots, PDFs, or other output files the user may want.",
      schema: z.object({
        path: z
          .string()
          .trim()
          .min(1)
          .describe(
            `Sandbox file path under ${workspaceRoot}. Relative paths are resolved under ${getSessionSandboxOutputRoot(workspaceRoot)}.`
          ),
        name: z
          .string()
          .trim()
          .optional()
          .describe("Download filename to show in the file library."),
        mime_type: z
          .string()
          .trim()
          .optional()
          .describe("Optional MIME type for the downloaded file."),
      }),
    }
  )
}
