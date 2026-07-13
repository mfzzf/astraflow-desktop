import { posix } from "node:path"

import { Sandbox } from "@e2b/code-interpreter"

import { ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS } from "@/lib/astraflow-sandbox-runtime"
import {
  listStudioMessages,
  listStudioSessionFiles,
  touchStudioWorkspace,
  updateStudioMessageAttachments,
  updateStudioSessionFileSandboxPath,
} from "@/lib/studio-db"
import {
  bufferToArrayBuffer,
  readStudioFile,
  safeFileName,
} from "@/lib/studio-file-storage"
import { connectStudioSessionSandboxWorkspace } from "@/lib/studio-workspace-context"
import {
  getSandboxWorkspaceOutputRoot,
  getSandboxWorkspacePrivateRoot,
  isPosixPathInsideRoot,
  normalizeSandboxWorkspaceRoot,
} from "@/lib/sandbox-workspace-paths"
import type { StudioAttachment, StudioSessionFile } from "@/lib/studio-types"

const STUDIO_CHAT_DEBUG = process.env.ASTRAFLOW_STUDIO_CHAT_DEBUG === "1"

export type SessionSandboxContext = {
  sandbox: Sandbox
  sandboxId: string
  workspaceId: string
  workspaceRoot: string
  files: StudioSessionFile[]
  manifest: string
}

function getWorkspaceRoot(workspaceRoot: string) {
  return normalizeSandboxWorkspaceRoot(workspaceRoot)
}

export function getSessionSandboxOutputRoot(workspaceRoot: string) {
  return getSandboxWorkspaceOutputRoot(getWorkspaceRoot(workspaceRoot))
}

export function getSessionSandboxRoot(workspaceRoot: string) {
  return getWorkspaceRoot(workspaceRoot)
}

function getSessionSandboxUploadRoot(workspaceRoot: string) {
  return `${getSandboxWorkspacePrivateRoot(getWorkspaceRoot(workspaceRoot))}/uploads`
}

export function normalizeSandboxFilePath(
  path: string,
  {
    relativeBase,
    workspaceRoot,
  }: {
    relativeBase?: string
    workspaceRoot: string
  }
) {
  const trimmed = path.trim()

  if (!trimmed) {
    throw new Error("File path is required.")
  }

  const normalized = trimmed.startsWith("/")
    ? posix.normalize(trimmed)
    : posix.normalize(
        posix.join(
          relativeBase || getSessionSandboxOutputRoot(workspaceRoot),
          trimmed
        )
      )

  const allowedRoot = getWorkspaceRoot(workspaceRoot)

  if (!isPosixPathInsideRoot(normalized, allowedRoot)) {
    throw new Error(
      `Sandbox file paths must stay under workspace root ${allowedRoot}.`
    )
  }

  return normalized
}

export function normalizeSandboxOutputPath(path: string, workspaceRoot: string) {
  const trimmed = path.trim()

  if (trimmed.startsWith("/")) {
    return normalizeSandboxFilePath(trimmed, { workspaceRoot })
  }

  const safeRelativePath = trimmed
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => safeFileName(part))
    .join("/")

  return normalizeSandboxFilePath(safeRelativePath || "output.txt", {
    relativeBase: getSessionSandboxOutputRoot(workspaceRoot),
    workspaceRoot,
  })
}

export function createSessionSandboxUploadPath(
  file: StudioSessionFile,
  workspaceRoot: string
) {
  const messagePart = file.messageId ? safeFileName(file.messageId) : "session"
  const fileName = `${safeFileName(file.id)}-${safeFileName(file.originalName)}`

  return `${getSessionSandboxUploadRoot(workspaceRoot)}/${messagePart}/${fileName}`
}

function updateAttachmentSandboxPath(
  sessionId: string,
  fileId: string,
  sandboxPath: string
) {
  for (const message of listStudioMessages(sessionId)) {
    let changed = false
    const attachments = message.attachments.map((attachment) => {
      if (attachment.id !== fileId) {
        return attachment
      }

      changed = true
      return { ...attachment, sandboxPath }
    })

    if (changed) {
      updateStudioMessageAttachments(message.id, attachments)
    }
  }
}

/**
 * Connect an Agent run to the Sandbox explicitly selected by its Studio
 * workspace. Unlike the legacy session sandbox helper, this never creates or
 * binds a Sandbox as a side effect.
 */
export async function connectStudioSessionWorkspaceSandbox({
  sessionId,
  workspaceId,
}: {
  apiKey?: string
  sessionId: string
  workspaceId: string
}) {
  const context = await connectStudioSessionSandboxWorkspace(sessionId)
  const workspace = context.workspace

  if (workspace.id !== workspaceId) {
    throw new Error(
      "This session is not bound to the requested Sandbox workspace."
    )
  }

  touchStudioWorkspace(workspace.id)
  return context.sandbox
}

async function uploadFileToSandbox({
  sandbox,
  sessionId,
  file,
  force,
  workspaceRoot,
}: {
  sandbox: Sandbox
  sessionId: string
  file: StudioSessionFile
  force: boolean
  workspaceRoot: string
}) {
  const targetSandboxPath = createSessionSandboxUploadPath(file, workspaceRoot)

  if (file.sandboxPath === targetSandboxPath && !force) {
    let exists = false

    try {
      exists = await sandbox.files.exists(file.sandboxPath, {
        requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
      })
    } catch (error) {
      if (STUDIO_CHAT_DEBUG) {
        console.info("[studio-chat:sandbox] sandbox_file_exists_failed", {
          fileId: file.id,
          sandboxId: sandbox.sandboxId,
          sandboxPath: file.sandboxPath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (exists) {
      return file
    }

    if (STUDIO_CHAT_DEBUG) {
      console.info(
        "[studio-chat:sandbox] re-uploading_file_missing_from_sandbox",
        {
          fileId: file.id,
          sandboxId: sandbox.sandboxId,
          sandboxPath: file.sandboxPath,
        }
      )
    }
  }

  const sandboxPath = targetSandboxPath
  const buffer = readStudioFile(file.storagePath)

  await sandbox.files.write(sandboxPath, bufferToArrayBuffer(buffer), {
    requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
  })
  updateStudioSessionFileSandboxPath(file.id, sandboxPath)
  updateAttachmentSandboxPath(sessionId, file.id, sandboxPath)

  return { ...file, sandboxPath }
}

function findSessionFile({
  sessionId,
  fileId,
  name,
}: {
  sessionId: string
  fileId?: string
  name?: string
}) {
  const files = listStudioSessionFiles(sessionId)
  const normalizedName = name?.trim().toLowerCase()

  if (fileId?.trim()) {
    return files.find((file) => file.id === fileId.trim()) ?? null
  }

  if (!normalizedName) {
    return null
  }

  const exactMatches = files.filter(
    (file) => file.originalName.toLowerCase() === normalizedName
  )

  if (exactMatches.length === 1) {
    return exactMatches[0]
  }

  const fuzzyMatches = files.filter((file) =>
    file.originalName.toLowerCase().includes(normalizedName)
  )

  return fuzzyMatches.length === 1 ? fuzzyMatches[0] : null
}

export function createAvailableSessionFilesManifest(sessionId: string) {
  const files = listStudioSessionFiles(sessionId)

  if (!files.length) {
    return ""
  }

  return [
    "Session files available for on-demand upload to AstraFlow Sandbox:",
    ...files.map((file) =>
      [
        `- ${file.originalName}`,
        `file_id: ${file.id}`,
        file.kind ? `kind: ${file.kind}` : null,
        file.mimeType ? `mime: ${file.mimeType}` : null,
        typeof file.size === "number" ? `bytes: ${file.size}` : null,
      ]
        .filter(Boolean)
        .join(" | ")
    ),
    "Before analyzing one of these files in run_code, call upload_file with its file_id to get a valid AstraFlow Sandbox path.",
  ].join("\n")
}

export async function uploadSessionFileToSandbox({
  sessionId,
  apiKey,
  fileId,
  name,
  workspaceRoot,
  workspaceId,
}: {
  sessionId: string
  apiKey: string
  fileId?: string
  name?: string
  workspaceRoot: string
  workspaceId: string
}) {
  const file = findSessionFile({ sessionId, fileId, name })

  if (!file) {
    throw new Error("Session file not found or file name is ambiguous.")
  }

  const sandbox = await connectStudioSessionWorkspaceSandbox({
    sessionId,
    apiKey,
    workspaceId,
  })
  const uploaded = await uploadFileToSandbox({
    sandbox,
    sessionId,
    file,
    force: false,
    workspaceRoot,
  })

  return {
    sandbox,
    sandboxId: sandbox.sandboxId,
    file: uploaded,
  }
}

export function describeAttachmentForPrompt(attachment: StudioAttachment) {
  return [
    `Attachment: ${attachment.name}`,
    attachment.id ? `file_id: ${attachment.id}` : null,
    attachment.sandboxPath ? `sandbox_path: ${attachment.sandboxPath}` : null,
    `type: ${attachment.type}`,
    `mime: ${attachment.mimeType}`,
    typeof attachment.size === "number" ? `bytes: ${attachment.size}` : null,
    "Use the session files manifest for the runtime-readable file path when available.",
  ]
    .filter(Boolean)
    .join(" | ")
}
