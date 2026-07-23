import { copyFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

import { ensureAcpAttachmentDirectory } from "@/lib/agent/acp/attachments"
import {
  getStudioModelverseApiKey,
  getStudioSessionFile,
  listStudioSessionFiles,
  updateStudioSessionFileSandboxPath,
} from "@/lib/studio-db"
import { assertAstraFlowHostToolNames } from "@/lib/ai/tools/studio-tool-manifest"
import {
  type AstraFlowTool,
  type AstraFlowToolInvokeOptions,
} from "@/lib/ai/tools/tool"
import { createLocalDownloadFileTool } from "@/lib/ai/tools/local-download"
import { createSendFileToMobileTool } from "@/lib/ai/tools/mobile-channel"
import {
  createExaWebSearchTool,
  createWebFetchTool,
  getStoredExaApiKey,
} from "@/lib/ai/tools/web"
import { createListInstalledMcpServersTool } from "@/lib/ai/tools/mcp"
import {
  createGetStudioMediaModelSchemaTool,
  createGetStudioMediaGenerationTool,
  createListStudioImageModelsTool,
  createListStudioMediaGenerationModelsTool,
  createListStudioMediaGenerationsTool,
  createListStudioVideoModelsTool,
  createStudioGenerateImageTool,
  createStudioGenerateVideoTool,
} from "@/lib/ai/tools/media-generation"
import {
  createSandboxStartServiceTool,
  createDownloadFileTool,
  createSessionSandboxGetter,
  createUploadFileTool,
} from "@/lib/ai/tools/astraflow-sandbox"
import {
  createMobileChannelFileReference,
  registerMobileChannelFileReference,
} from "@/lib/mobile-channels/file-transfer"
import { getMobileChannelBindingBySessionId } from "@/lib/mobile-channels/store"
import {
  resolveStudioStoragePath,
  safeFileName,
} from "@/lib/studio-file-storage"
import { withStudioSessionLock } from "@/lib/studio-session-lock"
import type { StudioPermissionMode } from "@/lib/studio-types"

export type StudioAgentToolsWorkspace = {
  id: string
  rootPath: string
  type: "local" | "sandbox"
}

export type StudioAgentToolsOptions = {
  exaApiKey?: string | null
  mobileChannelBound?: boolean
  sessionId: string
  workspace?: StudioAgentToolsWorkspace | null
  modelverseApiKey?: string | null
  permissionMode?: StudioPermissionMode
  sandboxServiceFullAccessAvailable?: () => boolean
  sandboxServiceCapabilityAvailable?:
    | boolean
    | (() => boolean | Promise<boolean>)
}

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function createToolFromSharedDefinition(
  definition: AstraFlowTool,
  execute: (
    input: unknown,
    options: AstraFlowToolInvokeOptions
  ) => unknown | Promise<unknown>
): AstraFlowTool {
  return {
    name: definition.name,
    description: definition.description,
    schema: definition.schema,
    effectCategory: definition.effectCategory,
    allowInSubagent: definition.allowInSubagent,
    ...(definition.inputJsonSchema
      ? { inputJsonSchema: definition.inputJsonSchema }
      : {}),
    ...(definition.isAvailable
      ? { isAvailable: definition.isAvailable }
      : {}),
    ...(definition.unavailableMessage
      ? { unavailableMessage: definition.unavailableMessage }
      : {}),
    async invoke(input, options = {}) {
      const parsed = await definition.schema.parseAsync(input)

      return execute(parsed, options)
    },
  }
}

function findSessionFile(
  sessionId: string,
  input: Record<string, unknown>
) {
  const files = listStudioSessionFiles(sessionId)
  const fileId =
    typeof input.file_id === "string" ? input.file_id.trim() : ""
  const normalizedName =
    typeof input.name === "string" ? input.name.trim().toLowerCase() : ""

  if (fileId) {
    return files.find((file) => file.id === fileId) ?? null
  }

  const exact = files.filter(
    (file) => file.originalName.toLowerCase() === normalizedName
  )
  if (exact.length === 1) {
    return exact[0]
  }

  const fuzzy = files.filter((file) =>
    file.originalName.toLowerCase().includes(normalizedName)
  )

  return fuzzy.length === 1 ? fuzzy[0] : null
}

function createLocalUploadFileTool({
  definition,
  sessionId,
}: {
  definition: AstraFlowTool
  sessionId: string
}) {
  return createToolFromSharedDefinition(
    definition,
    async (input, { signal }) => {
      try {
        signal?.throwIfAborted()

        return await withStudioSessionLock(sessionId, async () => {
          const file = findSessionFile(sessionId, getRecord(input))

          if (!file) {
            throw new Error(
              "Session file not found or file name is ambiguous."
            )
          }

          const messagePart = file.messageId
            ? safeFileName(file.messageId)
            : "session"
          const targetPath = join(
            ensureAcpAttachmentDirectory(sessionId),
            messagePart,
            `${safeFileName(file.id)}-${safeFileName(file.originalName)}`
          )

          signal?.throwIfAborted()
          mkdirSync(dirname(targetPath), { recursive: true })
          copyFileSync(
            /* turbopackIgnore: true */ resolveStudioStoragePath(
              file.storagePath
            ),
            targetPath
          )
          updateStudioSessionFileSandboxPath(file.id, targetPath)

          return [
            `Uploaded file: ${file.originalName}`,
            `File ID: ${file.id}`,
            `Read-only attachment path: ${targetPath}`,
            file.mimeType ? `MIME: ${file.mimeType}` : null,
            typeof file.size === "number" ? `Bytes: ${file.size}` : null,
          ]
            .filter(Boolean)
            .join("\n")
        })
      } catch (error) {
        return `upload_file failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      }
    }
  )
}

function sessionFileIdFromDownloadResult(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  const match =
    /\/api\/studio\/files\/([^/?#]+)\/content(?:\?[^)\s]*)?/.exec(text)

  if (!match) {
    return null
  }

  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

function createSandboxSendFileToMobileTool({
  definition,
  downloadTool,
  sessionId,
}: {
  definition: AstraFlowTool
  downloadTool: AstraFlowTool
  sessionId: string
}) {
  return createToolFromSharedDefinition(
    definition,
    async (input, options) => {
      const record = getRecord(input)
      const path = typeof record.path === "string" ? record.path : ""
      const fileName =
        typeof record.fileName === "string" ? record.fileName : undefined
      const downloaded = await downloadTool.invoke(
        {
          path,
          ...(fileName ? { name: fileName } : {}),
        },
        options
      )
      const fileId = sessionFileIdFromDownloadResult(downloaded)
      const file = fileId ? getStudioSessionFile(fileId) : null

      if (!file) {
        throw new Error(
          `studio_send_file could not materialize the Sandbox file locally: ${
            typeof downloaded === "string" ? downloaded : "unknown result"
          }`
        )
      }

      options.signal?.throwIfAborted()
      const reference = createMobileChannelFileReference({
        path: resolveStudioStoragePath(file.storagePath),
        fileName,
      })
      registerMobileChannelFileReference(sessionId, reference)

      return reference
    }
  )
}

/**
 * AstraFlow product tools shared by every AstraFlow Agent execution surface.
 *
 * Filesystem and terminal tools belong to the Agent runtime itself. Keeping
 * them out of this factory avoids duplicate read/bash implementations while
 * letting Desktop-only capabilities (media, web, downloads, and MCP catalog
 * inspection) travel through the same ACP MCP bridge in local and Sandbox
 * sessions.
 */
export function createStudioAgentTools(options: StudioAgentToolsOptions) {
  const exaApiKey =
    options.exaApiKey === undefined
      ? getStoredExaApiKey()
      : options.exaApiKey
  const modelverseApiKey =
    options.modelverseApiKey === undefined
      ? getStudioModelverseApiKey()?.key
      : options.modelverseApiKey
  const mobileChannelBound =
    options.mobileChannelBound ??
    Boolean(getMobileChannelBindingBySessionId(options.sessionId))
  const tools: AstraFlowTool[] = [
    createWebFetchTool(),
    createListInstalledMcpServersTool(),
    createListStudioImageModelsTool(),
    createListStudioVideoModelsTool(),
    createListStudioMediaGenerationModelsTool(),
    createGetStudioMediaModelSchemaTool(),
    createListStudioMediaGenerationsTool({
      sessionId: options.sessionId,
      apiKey: modelverseApiKey,
    }),
    createGetStudioMediaGenerationTool({
      sessionId: options.sessionId,
      apiKey: modelverseApiKey,
    }),
  ]

  const workspace = options.workspace
  const hasWorkspaceTransfer = Boolean(
    workspace &&
      (workspace.type === "local" ||
        (workspace.type === "sandbox" && modelverseApiKey))
  )
  const sandboxServiceEnabled = Boolean(
    workspace?.type === "sandbox" &&
      modelverseApiKey &&
      options.permissionMode === "full_access"
  )
  let downloadTool: AstraFlowTool | null = null

  if (modelverseApiKey) {
    tools.push(
      createStudioGenerateImageTool({
        sessionId: options.sessionId,
        apiKey: modelverseApiKey,
      }),
      createStudioGenerateVideoTool({
        sessionId: options.sessionId,
        apiKey: modelverseApiKey,
      })
    )
  }

  if (workspace?.type === "local") {
    const downloadDefinition = createLocalDownloadFileTool({
      rootDir: workspace.rootPath,
      sessionId: options.sessionId,
    })
    downloadTool = createToolFromSharedDefinition(
      downloadDefinition,
      (input, invokeOptions) =>
        downloadDefinition.invoke(input, invokeOptions)
    )
    const uploadDefinition = createUploadFileTool({
      sessionId: options.sessionId,
      apiKey: modelverseApiKey || "descriptor-only",
      workspaceId: workspace.id,
      workspaceRoot: workspace.rootPath,
    })

    tools.push(
      downloadTool,
      createLocalUploadFileTool({
        definition: uploadDefinition,
        sessionId: options.sessionId,
      })
    )
  } else if (workspace?.type === "sandbox" && modelverseApiKey) {
    const getSandboxContext = createSessionSandboxGetter({
      sessionId: options.sessionId,
      apiKey: modelverseApiKey,
      workspaceId: workspace.id,
      workspaceRoot: workspace.rootPath,
    })

    const downloadImplementation = createDownloadFileTool({
      getSandboxContext,
      sessionId: options.sessionId,
      workspaceRoot: workspace.rootPath,
    })
    const downloadDefinition = createLocalDownloadFileTool({
      rootDir: workspace.rootPath,
      sessionId: options.sessionId,
    })
    downloadTool = createToolFromSharedDefinition(
      downloadDefinition,
      (input, invokeOptions) =>
        downloadImplementation.invoke(input, invokeOptions)
    )

    if (sandboxServiceEnabled) {
      tools.push(
        createSandboxStartServiceTool({
          fullAccessEnabled:
            options.sandboxServiceFullAccessAvailable ?? true,
          getSandboxContext,
          serviceCapabilityAvailable:
            options.sandboxServiceCapabilityAvailable,
          sessionId: options.sessionId,
          workspaceRoot: workspace.rootPath,
        })
      )
    }

    tools.push(
      downloadTool,
      createUploadFileTool({
        sessionId: options.sessionId,
        apiKey: modelverseApiKey,
        workspaceId: workspace.id,
        workspaceRoot: workspace.rootPath,
      })
    )
  }

  if (exaApiKey) {
    tools.push(createExaWebSearchTool(exaApiKey))
  }

  const hasMobileTool = Boolean(
    mobileChannelBound && workspace && downloadTool
  )
  if (hasMobileTool && workspace && downloadTool) {
    const definition = createSendFileToMobileTool({
      rootDir: workspace.rootPath,
      sessionId: options.sessionId,
    })

    tools.push(
      workspace.type === "local"
        ? createToolFromSharedDefinition(
            definition,
            (input, invokeOptions) =>
              definition.invoke(input, invokeOptions)
          )
        : createSandboxSendFileToMobileTool({
            definition,
            downloadTool,
            sessionId: options.sessionId,
          })
    )
  }

  assertAstraFlowHostToolNames(
    tools.map((tool) => tool.name),
    {
      exa: Boolean(exaApiKey),
      mobile: hasMobileTool,
      modelverse: Boolean(modelverseApiKey),
      sandboxService: sandboxServiceEnabled,
      workspace: hasWorkspaceTransfer,
    }
  )

  return tools
}
