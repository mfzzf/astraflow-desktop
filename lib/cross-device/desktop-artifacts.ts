import { createHash, randomUUID } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { lstat, mkdir, realpath, rename, unlink } from "node:fs/promises"
import { basename, join, resolve, sep } from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"

import { unwrapAstraFlowApiResult } from "@/lib/astraflow-api"
import {
  artifactServiceListArtifacts,
  type AstraflowV1Artifact,
} from "@/lib/generated/astraflow-api"
import {
  getStudioSessionWorkspace,
  listStudioMessages,
  updateStudioMessageAttachments,
} from "@/lib/studio-db"
import type { StudioAttachment } from "@/lib/studio-types"

const maxDesktopAttachmentBytes = 2 * 1024 * 1024 * 1024

export async function materializeRemoteSessionArtifacts(input: {
  authorization: string
  sessionId: string
}) {
  const workspace = getStudioSessionWorkspace(input.sessionId)
  if (!workspace || workspace.type !== "local") {
    throw new Error(
      "The mobile task is not bound to an available local Mac workspace."
    )
  }
  const artifacts = await listSessionArtifacts(
    input.authorization,
    input.sessionId
  )
  if (!artifacts.length) return []
  const directory = await ensureAttachmentDirectory(
    workspace.rootPath,
    input.sessionId
  )
  const attachments: StudioAttachment[] = []
  for (const artifact of artifacts) {
    const path = await downloadArtifact(artifact, directory)
    attachments.push({
      id: artifact.id,
      type: artifact.mimeType?.startsWith("image/") ? "image" : "file",
      name: artifact.fileName || basename(path),
      mimeType: artifact.mimeType || "application/octet-stream",
      size: Number(artifact.size || 0),
      dataUrl: null,
      storagePath: path,
      sandboxPath: path,
    })
  }
  const latestUserMessage = listStudioMessages(input.sessionId).findLast(
    (message) => message.role === "user"
  )
  if (latestUserMessage) {
    updateStudioMessageAttachments(latestUserMessage.id, attachments)
  }
  return attachments
}

async function listSessionArtifacts(authorization: string, sessionId: string) {
  const artifacts: AstraflowV1Artifact[] = []
  let pageToken = ""
  do {
    const page = unwrapAstraFlowApiResult(
      await artifactServiceListArtifacts({
        headers: { Accept: "application/json", Authorization: authorization },
        query: { sessionId, pageSize: 100, pageToken: pageToken || undefined },
        signal: AbortSignal.timeout(15_000),
      }),
      "Mobile task attachments could not be loaded."
    )
    artifacts.push(...(page.artifacts ?? []))
    const nextPageToken = page.nextPageToken || ""
    if (nextPageToken && nextPageToken === pageToken) {
      throw new Error("Artifact pagination cursor did not advance.")
    }
    pageToken = nextPageToken
  } while (pageToken)
  return artifacts.filter(
    (artifact) =>
      artifact.id &&
      artifact.downloadUrl &&
      artifact.sha256 &&
      Number.isSafeInteger(Number(artifact.size)) &&
      Number(artifact.size) >= 0 &&
      Number(artifact.size) <= maxDesktopAttachmentBytes
  )
}

async function ensureAttachmentDirectory(root: string, sessionId: string) {
  const workspaceRoot = await realpath(root)
  let current = workspaceRoot
  for (const segment of [".astraflow", "attachments", safeSegment(sessionId)]) {
    current = join(current, segment)
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error(`Unsafe attachment directory: ${current}`)
      }
    } catch (error) {
      if (!isNotFound(error)) throw error
      await mkdir(current, { mode: 0o700 })
    }
    const canonical = await realpath(current)
    if (!isInside(workspaceRoot, canonical)) {
      throw new Error("Attachment directory escaped the local workspace.")
    }
    current = canonical
  }
  return current
}

async function downloadArtifact(
  artifact: AstraflowV1Artifact,
  directory: string
) {
  const expectedSize = Number(artifact.size)
  const expectedSHA = artifact.sha256!.toLowerCase()
  const name = `${safeSegment(artifact.id!)}-${safeSegment(artifact.fileName || "attachment")}`
  const finalPath = resolve(directory, name)
  if (!isInside(directory, finalPath)) {
    throw new Error("Attachment file name escaped the local workspace.")
  }
  if (await existingFileMatches(finalPath, expectedSize, expectedSHA)) {
    return finalPath
  }
  const temporaryPath = join(directory, `.${name}.${randomUUID()}.tmp`)
  const response = await fetch(artifact.downloadUrl!, {
    signal: AbortSignal.timeout(10 * 60_000),
  })
  if (!response.ok || !response.body) {
    throw new Error(
      `Attachment download failed with HTTP ${response.status || 503}.`
    )
  }
  const digest = createHash("sha256")
  let received = 0
  const verifier = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      if (received > expectedSize || received > maxDesktopAttachmentBytes) {
        callback(new Error("Attachment download exceeded its declared size."))
        return
      }
      digest.update(chunk)
      callback(null, chunk)
    },
  })
  try {
    await pipeline(
      Readable.fromWeb(response.body as never),
      verifier,
      createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 })
    )
    if (received !== expectedSize || digest.digest("hex") !== expectedSHA) {
      throw new Error("Attachment download failed SHA-256 verification.")
    }
    await rename(temporaryPath, finalPath)
    return finalPath
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

async function existingFileMatches(
  path: string,
  expectedSize: number,
  expectedSHA: string
) {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size !== expectedSize) {
      return false
    }
    const digest = createHash("sha256")
    for await (const chunk of createReadStream(path)) digest.update(chunk)
    return digest.digest("hex") === expectedSHA
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}

function safeSegment(value: string) {
  const result = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 180)
  return result || "attachment"
}

function isInside(parent: string, child: string) {
  return (
    child === parent ||
    child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`)
  )
}

function isNotFound(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  )
}
