import { statSync } from "node:fs"
import { basename, extname, isAbsolute, relative, resolve } from "node:path"

import { z } from "zod"

import { createAstraFlowTool } from "@/lib/ai/tools/tool"
import { formatStudioFileDeliveryLinks } from "@/lib/ai/tools/file-delivery"
import {
  ensureLocalSandboxWorkspace,
  resolveLocalSandboxReadPath,
} from "@/lib/agent/sandbox/local-policy"
import { createStudioSessionFile } from "@/lib/studio-db"
import {
  copyStudioFile,
  createGeneratedStoragePath,
  safeFileName,
} from "@/lib/studio-file-storage"
import { withStudioSessionLock } from "@/lib/studio-session-lock"

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  ".csv": "text/csv",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
}

function isPathInsideRoot(root: string, path: string) {
  const relation = relative(root, path)

  return (
    relation === "" ||
    (relation !== ".." &&
      !relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      !isAbsolute(relation))
  )
}

export function resolveLocalDownloadFilePath({
  path,
  rootDir,
  sessionId,
}: {
  path: string
  rootDir: string
  sessionId: string
}) {
  const resolvedPath = resolveLocalSandboxReadPath(rootDir, path)
  const allowedRoots = [
    resolveLocalSandboxReadPath(rootDir, resolve(rootDir)),
    resolveLocalSandboxReadPath(
      rootDir,
      ensureLocalSandboxWorkspace(sessionId)
    ),
  ]

  if (!allowedRoots.some((root) => isPathInsideRoot(root, resolvedPath))) {
    throw new Error(
      "File download is limited to the selected project or session workspace."
    )
  }

  const stats = statSync(/* turbopackIgnore: true */ resolvedPath)

  if (!stats.isFile()) {
    throw new Error("The requested download path is not a file.")
  }

  return { path: resolvedPath, size: stats.size }
}

function inferMimeType(path: string) {
  return (
    MIME_TYPES_BY_EXTENSION[extname(path).toLocaleLowerCase("en-US")] ??
    "application/octet-stream"
  )
}

export function createLocalDownloadFileTool({
  rootDir,
  sessionId,
}: {
  rootDir: string
  sessionId: string
}) {
  return createAstraFlowTool(
    async ({ path, name, mime_type }) => {
      try {
        return await withStudioSessionLock(sessionId, async () => {
          const resolved = resolveLocalDownloadFilePath({
            path,
            rootDir,
            sessionId,
          })
          const fileName = safeFileName(name?.trim() || basename(resolved.path))
          const storagePath = createGeneratedStoragePath({
            sessionId,
            name: fileName,
          })

          copyStudioFile(resolved.path, storagePath)
          const file = createStudioSessionFile({
            sessionId,
            kind: "generated",
            originalName: fileName,
            mimeType: mime_type?.trim() || inferMimeType(fileName),
            size: resolved.size,
            storagePath,
            sandboxPath: resolved.path,
            savedAt: new Date().toISOString(),
          })

          if (!file) {
            return "download_file failed: file metadata could not be saved."
          }

          return [
            `Saved local file for download: ${file.originalName}`,
            `Local path: ${resolved.path}`,
            `Bytes: ${resolved.size}`,
            formatStudioFileDeliveryLinks({
              fileId: file.id,
              fileName: file.originalName,
              filePath: resolved.path,
            }),
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
        "Make an existing workspace artifact available in AstraFlow. Call this for standalone files the user should open or download, then reproduce every returned Preview and Download link in the final response. Do not use it for ordinary repository edits.",
      schema: z.object({
        path: z
          .string()
          .trim()
          .min(1)
          .describe(
            "Existing file path in the selected workspace."
          ),
        name: z
          .string()
          .trim()
          .optional()
          .describe("Optional download filename shown to the user."),
        mime_type: z
          .string()
          .trim()
          .optional()
          .describe(
            "Optional MIME type; inferred from the file extension when omitted."
          ),
      }),
    }
  )
}
