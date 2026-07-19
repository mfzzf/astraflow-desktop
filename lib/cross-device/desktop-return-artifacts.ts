import { createHash, randomUUID } from "node:crypto"
import { lstat, readFile, realpath } from "node:fs/promises"
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path"

import { unwrapAstraFlowApiResult } from "@/lib/astraflow-api"
import {
  artifactServiceCompleteUpload,
  artifactServiceCreateUpload,
} from "@/lib/generated/astraflow-api"
import { getStudioLocalProject } from "@/lib/studio-db"
import type { StudioMessagePart, StudioSession } from "@/lib/studio-types"

const maxArtifactFiles = 20
const maxArtifactBytes = 50 * 1024 * 1024
const maxArtifactTotalBytes = 200 * 1024 * 1024

export async function uploadDesktopRunArtifacts({
  authorization,
  deviceId,
  runId,
  session,
  parts,
}: {
  authorization: string
  deviceId: string
  runId: string
  session: StudioSession
  parts: StudioMessagePart[]
}) {
  if (!session.projectId) {
    throw new Error("The Desktop session is not bound to a local project.")
  }
  const project = getStudioLocalProject(session.projectId)
  if (!project) throw new Error("The Desktop local project is unavailable.")
  const projectRoot = await realpath(project.path)
  const candidates = changedFiles(parts)
  let totalBytes = 0
  let uploaded = 0
  let skipped = 0

  for (const [index, candidate] of candidates.entries()) {
    if (uploaded >= maxArtifactFiles) {
      skipped += candidates.length - index
      break
    }
    const file = await resolveSafeDesktopArtifactFile(
      projectRoot,
      candidate.path
    ).catch(() => null)
    if (!file || isSensitiveDesktopArtifactPath(file.relativePath)) {
      skipped += 1
      continue
    }
    if (
      file.size > maxArtifactBytes ||
      totalBytes + file.size > maxArtifactTotalBytes
    ) {
      skipped += 1
      continue
    }
    const bytes = await readFile(file.absolutePath)
    if (bytes.byteLength !== file.size) {
      skipped += 1
      continue
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex")
    const mutationHash = createHash("sha256")
      .update(`${runId}\0${file.relativePath}\0${sha256}`)
      .digest("hex")
    const uploadId = randomUUID()
    const headers = authHeaders(authorization)
    const upload = unwrapAstraFlowApiResult(
      await artifactServiceCreateUpload({
        headers,
        body: {
          uploadId,
          artifactId: randomUUID(),
          sessionId: session.id,
          runId,
          kind: "artifact",
          fileName: basename(file.relativePath),
          mimeType: mimeTypeForPath(file.relativePath),
          size: String(file.size),
          sha256,
          sourceDeviceId: deviceId,
          clientMutationId: `desktop-artifact:${mutationHash}`,
        },
        signal: AbortSignal.timeout(15_000),
      }),
      `Could not prepare Desktop artifact ${file.relativePath}.`
    )
    if (!upload.uploadUrl || !upload.id) {
      throw new Error("Artifact upload response is incomplete.")
    }
    const response = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: upload.uploadHeaders,
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) {
      throw new Error(
        `Desktop artifact upload returned HTTP ${response.status}.`
      )
    }
    unwrapAstraFlowApiResult(
      await artifactServiceCompleteUpload({
        headers,
        path: { uploadId: upload.id },
        body: {
          uploadId: upload.id,
          sourceDeviceId: deviceId,
          clientMutationId: `desktop-artifact-complete:${mutationHash}`,
        },
        signal: AbortSignal.timeout(15_000),
      }),
      `Could not verify Desktop artifact ${file.relativePath}.`
    )
    totalBytes += file.size
    uploaded += 1
  }

  return { uploaded, skipped, totalBytes }
}

function changedFiles(parts: StudioMessagePart[]) {
  const byPath = new Map<string, Extract<StudioMessagePart, { type: "file" }>>()
  for (const part of parts) {
    if (
      part.type === "file" &&
      part.status === "complete" &&
      part.kind !== "delete"
    ) {
      byPath.set(part.path, part)
    }
  }
  return Array.from(byPath.values())
}

export async function resolveSafeDesktopArtifactFile(
  projectRoot: string,
  candidatePath: string
) {
  const canonicalProjectRoot = await realpath(projectRoot)
  const unresolved = isAbsolute(candidatePath)
    ? resolve(candidatePath)
    : resolve(canonicalProjectRoot, candidatePath)
  const absolutePath = await realpath(unresolved)
  const relativePath = relative(canonicalProjectRoot, absolutePath)
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("Artifact path escapes the local project.")
  }
  let current = canonicalProjectRoot
  for (const segment of relativePath.split(sep)) {
    current = join(current, segment)
    const info = await lstat(current)
    if (info.isSymbolicLink()) {
      throw new Error("Artifact path contains a symbolic link.")
    }
  }
  const info = await lstat(absolutePath)
  if (!info.isFile()) throw new Error("Artifact is not a regular file.")
  return { absolutePath, relativePath, size: info.size }
}

export function isSensitiveDesktopArtifactPath(path: string) {
  const segments = path.toLowerCase().split(/[\\/]+/)
  const name = segments.at(-1) ?? ""
  return (
    segments.some((segment) =>
      [".git", ".ssh", ".gnupg", ".aws", ".kube"].includes(segment)
    ) ||
    name === ".env" ||
    name.startsWith(".env.") ||
    /\.(pem|key|p12|pfx|kdbx)$/.test(name) ||
    /^(id_rsa|id_ed25519|credentials)$/.test(name)
  )
}

function mimeTypeForPath(path: string) {
  switch (extname(path).toLowerCase()) {
    case ".json":
      return "application/json"
    case ".pdf":
      return "application/pdf"
    case ".png":
      return "image/png"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".svg":
      return "image/svg+xml"
    case ".txt":
    case ".md":
    case ".csv":
      return "text/plain"
    case ".zip":
      return "application/zip"
    default:
      return "application/octet-stream"
  }
}

function authHeaders(authorization: string) {
  return { Accept: "application/json", Authorization: authorization }
}
