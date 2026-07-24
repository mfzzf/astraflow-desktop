import { createHash } from "node:crypto"
import { z } from "zod"

import { createAstraFlowTool } from "@/lib/ai/tools/tool"
import { formatStudioFileDeliveryLinks } from "@/lib/ai/tools/file-delivery"
import {
  CODEBOX_WORKSPACE_SERVICE_CAPABILITY,
  getCodeBoxWorkspaceGatewayHealth,
  startWorkspaceGatewayService,
} from "@/lib/codebox-runtime"

import { ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS } from "@/lib/astraflow-sandbox-runtime"
import {
  getAstraFlowRuntimeErrorMessage,
  retryAstraFlowTransientOperation,
} from "@/lib/agent/transient-retry"
import { createStudioSessionFile } from "@/lib/studio-db"
import {
  connectStudioSessionWorkspaceSandbox,
  getSessionSandboxOutputRoot,
  normalizeSandboxFilePath,
  uploadSessionFileToSandbox,
  type SessionSandboxContext,
} from "@/lib/astraflow-session-sandbox"
import {
  createGeneratedStoragePath,
  writeStudioFile,
} from "@/lib/studio-file-storage"
import { withStudioSessionLock } from "@/lib/studio-session-lock"

const SANDBOX_COMMAND_ENV_MAX_VARS = 40
const SANDBOX_SERVICE_FULL_ACCESS_REQUIRED =
  "Interactive Sandbox services require Full Access. Default can still preview static HTML without starting a service."

function sha256Bytes(bytes: Uint8Array | Buffer | string) {
  return createHash("sha256").update(bytes).digest("hex")
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

function normalizeSandboxServiceCwd(
  cwd: string | undefined,
  workspaceRoot: string
) {
  return normalizeSandboxFilePath(cwd?.trim() || workspaceRoot, {
    relativeBase: workspaceRoot,
    workspaceRoot,
  })
}

function normalizeHealthPath(path: string | undefined) {
  const trimmed = path?.trim()

  if (!trimmed) {
    return "/"
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`
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

export function createSandboxStartServiceTool({
  fullAccessEnabled,
  getSandboxContext,
  serviceCapabilityAvailable,
  sessionId,
  workspaceRoot,
}: {
  fullAccessEnabled: boolean | (() => boolean)
  getSandboxContext: () => Promise<SessionSandboxContext>
  serviceCapabilityAvailable?: boolean | (() => boolean | Promise<boolean>)
  sessionId: string
  workspaceRoot: string
}) {
  const hasFullAccess = () =>
    typeof fullAccessEnabled === "function"
      ? fullAccessEnabled()
      : fullAccessEnabled
  const hasServiceCapability = async () => {
    if (typeof serviceCapabilityAvailable === "boolean") {
      return serviceCapabilityAvailable
    }

    if (serviceCapabilityAvailable) {
      return serviceCapabilityAvailable()
    }

    const { sandboxId } = await getSandboxContext()
    const health = await getCodeBoxWorkspaceGatewayHealth(sandboxId)

    return (
      health.capabilities?.includes(CODEBOX_WORKSPACE_SERVICE_CAPABILITY) ===
      true
    )
  }
  const isServiceCapabilityAvailable = async () =>
    hasFullAccess() && (await hasServiceCapability())

  return createAstraFlowTool(
    async (
      {
        command,
        port,
        cwd,
        env,
        name,
        health_path,
        entry_path,
        idempotency_key,
        replace_service_id,
        spec_revision,
      },
      { signal }
    ) => {
      try {
        if (!hasFullAccess()) {
          throw new Error(SANDBOX_SERVICE_FULL_ACCESS_REQUIRED)
        }

        const serviceCapability = await hasServiceCapability()

        if (!hasFullAccess()) {
          throw new Error(SANDBOX_SERVICE_FULL_ACCESS_REQUIRED)
        }

        if (!serviceCapability) {
          throw new Error(
            "This Sandbox Workspace Gateway does not support service lifecycle management."
          )
        }

        return await withStudioSessionLock(sessionId, async () => {
          if (!hasFullAccess()) {
            throw new Error(SANDBOX_SERVICE_FULL_ACCESS_REQUIRED)
          }

          const { sandbox, sandboxId, workspaceId } = await getSandboxContext()
          const serviceName =
            name?.trim() ||
            `preview-${sha256Bytes(`${sessionId}\0${command}\0${cwd || ""}`).slice(0, 10)}`
          const workingDirectory = normalizeSandboxServiceCwd(
            cwd,
            workspaceRoot
          )
          const normalizedEnv = normalizeCommandEnv(env)
          const healthPath = health_path
            ? normalizeHealthPath(health_path)
            : undefined
          const entryPath = entry_path
            ? normalizeSandboxFilePath(entry_path, {
                relativeBase: workspaceRoot,
                workspaceRoot,
              })
            : undefined
          const idempotencyKey =
            idempotency_key?.trim() ||
            sha256Bytes(
              JSON.stringify({
                sessionId,
                workspaceRoot,
                serviceName,
                command,
                port,
                workingDirectory,
                normalizedEnv,
                healthPath,
                entryPath,
                spec_revision,
                replace_service_id,
              })
            )
          const service = await startWorkspaceGatewayService({
            sandboxId,
            workspacePath: workspaceRoot,
            signal,
            input: {
              ownerSessionId: sessionId,
              name: serviceName,
              command,
              cwd: workingDirectory,
              port,
              env: normalizedEnv,
              healthPath,
              entryPath,
              idempotencyKey,
              specRevision: spec_revision,
              replaceServiceId: replace_service_id,
            },
          })
          let publicUrl: string | null = null

          if (service.status === "healthy") {
            const host = sandbox.getHost(service.port)
            const candidate = new URL(
              /^[a-z][a-z0-9+.-]*:\/\//i.test(host) ? host : `https://${host}`
            )

            if (
              !["http:", "https:"].includes(candidate.protocol) ||
              candidate.username ||
              candidate.password ||
              ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(
                candidate.hostname.toLowerCase()
              )
            ) {
              throw new Error("Sandbox provider returned an unsafe public URL.")
            }

            publicUrl = candidate.toString()
          }

          const summary = [
            `Service ${service.name}: ${service.status}`,
            `Service ID: ${service.serviceId}`,
            `Port: ${service.port}`,
            publicUrl ? `URL: ${publicUrl}` : null,
            service.failure ? `Failure: ${service.failure}` : null,
          ]
            .filter(Boolean)
            .join("\n")

          return {
            content: [{ type: "text" as const, text: summary }],
            ...(service.status === "healthy" ? {} : { isError: true }),
            structuredContent: {
              astraflow: {
                service: {
                  ...service,
                  sessionId,
                  workspaceId,
                  sandboxId,
                  publicUrl,
                },
              },
            },
            _meta: {
              "astraflow/resultSchema": "service.v1",
              astraflowSessionId: sessionId,
            },
          }
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error"

        return {
          content: [
            {
              type: "text" as const,
              text: `sandbox_start_service failed: ${message}`,
            },
          ],
          isError: true,
          structuredContent: {
            astraflow: {
              service: {
                schemaVersion: 1,
                serviceId: null,
                name: name?.trim() || "Sandbox service",
                status: "failed",
                port: port ?? null,
                cwd: cwd?.trim() || workspaceRoot,
                healthPath: health_path?.trim() || null,
                logPath: "",
                entryPath: entry_path?.trim() || null,
                artifactKey: entry_path?.trim() || null,
                specFingerprint: "",
                specRevision: spec_revision?.trim() || null,
                publicUrl: null,
                sessionId,
                failure: message,
              },
            },
          },
          _meta: {
            "astraflow/resultSchema": "service.v1",
            astraflowSessionId: sessionId,
          },
        }
      }
    },
    {
      name: "sandbox_start_service",
      description:
        "Start a managed long-lived web preview or API service in a remote AstraFlow Sandbox running with Full Access. Default mode can preview static HTML but does not expose this tool. Pass one foreground command that reads the injected PORT environment variable and listens on 0.0.0.0; never use nohup, tmux, shell &, setsid, or another background wrapper. The Workspace Gateway owns health checks, logs, replacement, and shutdown. The result includes a structured trusted public URL only after the service is healthy.",
      isAvailable: isServiceCapabilityAvailable,
      unavailableMessage: SANDBOX_SERVICE_FULL_ACCESS_REQUIRED,
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
          .min(1024)
          .max(65_535)
          .optional()
          .describe(
            "Optional requested port. Prefer reading the injected PORT environment variable so the manager can resolve conflicts."
          ),
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
          .describe(
            "Stable service name. A changed spec requires replace_service_id."
          ),
        health_path: z
          .string()
          .trim()
          .optional()
          .describe("Path to check on http://127.0.0.1:<port>."),
        entry_path: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Optional workspace entry file represented by this service, such as index.html."
          ),
        idempotency_key: z
          .string()
          .trim()
          .min(8)
          .optional()
          .describe("Stable retry key. AstraFlow derives one when omitted."),
        replace_service_id: z
          .string()
          .uuid()
          .optional()
          .describe("Existing service ID to replace when the spec changed."),
        spec_revision: z
          .string()
          .trim()
          .min(1)
          .max(128)
          .optional()
          .describe("Optional caller revision for an explicit replacement."),
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
        "Upload exactly one session file into the selected AstraFlow workspace on demand. Use this before analyzing uploaded PDFs, Word documents, spreadsheets, CSVs, or other attachments. Prefer file_id from the session file manifest; name is a fallback and must uniquely identify a file.",
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
            throw new Error("File metadata could not be saved.")
          }

          return [
            `Saved sandbox file for download: ${file.originalName}`,
            `Sandbox path: ${sandboxPath}`,
            `Bytes: ${buffer.byteLength}`,
            `SHA256: ${sha256Bytes(buffer)}`,
            formatStudioFileDeliveryLinks({
              fileId: file.id,
              fileName: file.originalName,
              filePath: sandboxPath,
            }),
          ].join("\n")
        })
      } catch (error) {
        throw new Error(
          `download_file failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        )
      }
    },
    {
      name: "download_file",
      description:
        "Make a sandbox file available through AstraFlow's local file library. Use after generating reports, CSVs, plots, PDFs, or other output files, then reproduce every returned Preview and Download link in the final response.",
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
