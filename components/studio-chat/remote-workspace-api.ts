const REMOTE_TEXT_PREVIEW_LIMIT_BYTES = 2 * 1024 * 1024
const REMOTE_BINARY_PREVIEW_LIMIT_BYTES = 50 * 1024 * 1024
const REMOTE_LEGACY_XLS_LIMIT_BYTES = 12 * 1024 * 1024

function remoteWorkspaceEndpoint(
  workspaceId: string,
  resource: string,
  path?: string,
  options: { download?: boolean } = {}
) {
  const endpoint = `/api/studio/workspaces/${encodeURIComponent(
    workspaceId
  )}/fs/${resource}`

  if (path === undefined) {
    return endpoint
  }

  const search = new URLSearchParams({ path })

  if (options.download) {
    search.set("download", "1")
  }

  return `${endpoint}?${search}`
}

export function getStudioRemoteFileUrl(
  workspaceId: string,
  path: string,
  options: { download?: boolean } = {}
) {
  return remoteWorkspaceEndpoint(workspaceId, "file", path, options)
}

async function getErrorMessage(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as {
    message?: string
    error?: { message?: string }
  } | null

  return payload?.message || payload?.error?.message || fallback
}

function getRemotePathName(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? path
}

function getRemotePathDirectory(path: string) {
  const normalized = path.replace(/\/+$/, "")
  const index = normalized.lastIndexOf("/")

  return index > 0 ? normalized.slice(0, index) : "/"
}

function getRemoteMimeType(path: string) {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? ""
  const mimeTypes: Record<string, string> = {
    avif: "image/avif",
    bmp: "image/bmp",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    gif: "image/gif",
    ico: "image/x-icon",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    pdf: "application/pdf",
    png: "image/png",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    svg: "image/svg+xml",
    wasm: "application/wasm",
    webp: "image/webp",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }

  return mimeTypes[extension] ?? "application/octet-stream"
}

export async function statStudioRemoteFile(workspaceId: string, path: string) {
  const response = await fetch(
    getStudioRemoteFileUrl(workspaceId, path),
    {
      method: "HEAD",
      cache: "no-store",
    }
  )

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to read remote file."))
  }

  return {
    size: Number(response.headers.get("content-length") || 0),
    modifiedAt: Date.parse(response.headers.get("last-modified") || "") || 0,
  }
}

export async function listStudioRemoteDirectory(
  workspaceId: string,
  directory: string
) {
  const response = await fetch(
    remoteWorkspaceEndpoint(workspaceId, "entries", directory),
    { cache: "no-store" }
  )
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean
    data?: AstraFlowSidePanelDirectory
    message?: string
    error?: { message?: string }
  } | null

  if (!response.ok || !payload?.ok || !payload.data) {
    throw new Error(
      payload?.message ||
        payload?.error?.message ||
        "Failed to list remote workspace."
    )
  }

  return payload.data
}

export async function readStudioRemoteTextFile(
  workspaceId: string,
  path: string
): Promise<AstraFlowSidePanelTextFile> {
  const stats = await statStudioRemoteFile(workspaceId, path)
  const previewSize = Math.min(stats.size, REMOTE_TEXT_PREVIEW_LIMIT_BYTES)
  let content = ""

  if (previewSize > 0) {
    const response = await fetch(
      getStudioRemoteFileUrl(workspaceId, path),
      {
        cache: "no-store",
        headers:
          stats.size > previewSize
            ? { range: `bytes=0-${previewSize - 1}` }
            : undefined,
      }
    )

    if (!response.ok) {
      throw new Error(
        await getErrorMessage(response, "Failed to read remote text file.")
      )
    }

    content = await response.text()
  }

  return {
    path,
    name: getRemotePathName(path),
    directory: getRemotePathDirectory(path),
    size: stats.size,
    modifiedAt: stats.modifiedAt,
    content,
    truncated: stats.size > previewSize,
  }
}

export async function readStudioRemoteDataUrlFile(
  workspaceId: string,
  path: string,
  requestedLimitBytes = REMOTE_BINARY_PREVIEW_LIMIT_BYTES
): Promise<AstraFlowSidePanelDataUrlFile> {
  const stats = await statStudioRemoteFile(workspaceId, path)
  const limit = Math.max(
    1,
    Math.min(REMOTE_BINARY_PREVIEW_LIMIT_BYTES, requestedLimitBytes)
  )
  const extension = path.split(".").at(-1)?.toLowerCase()

  if (stats.size > limit) {
    throw new Error("Selected remote file is too large to preview.")
  }

  if (extension === "xls" && stats.size > REMOTE_LEGACY_XLS_LIMIT_BYTES) {
    throw new Error("Selected legacy XLS file is too large to preview.")
  }

  const response = await fetch(
    getStudioRemoteFileUrl(workspaceId, path),
    { cache: "no-store" }
  )

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, "Failed to read remote binary file.")
    )
  }

  const mimeType = getRemoteMimeType(path)
  const bytes = new Uint8Array(await response.arrayBuffer())
  let binary = ""
  const chunkSize = 32_768

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }

  return {
    path,
    name: getRemotePathName(path),
    directory: getRemotePathDirectory(path),
    size: stats.size,
    modifiedAt: stats.modifiedAt,
    mimeType,
    dataUrl: `data:${mimeType};base64,${btoa(binary)}`,
  }
}
