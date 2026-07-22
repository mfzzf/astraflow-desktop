import type { StudioMessagePart } from "@/lib/studio-types"

export type StudioFileReferenceKind = "create" | "edit" | "delete" | "reference"

export type StudioFileReferenceOrigin = "user" | "assistant" | "tool" | "source"

export type StudioFileReference = {
  key: string
  path: string
  name: string
  kind: StudioFileReferenceKind
  origin?: StudioFileReferenceOrigin | null
  messageId?: string | null
  version?: number | null
  mimeType?: string | null
  sizeBytes?: number | null
  sandboxPath?: string | null
  libraryFileId?: string | null
  fileId?: string | null
  downloadUrl?: string | null
}

export type StudioFileReferenceKeyInput = {
  libraryFileId?: string | null
  sandboxPath?: string | null
  fileId?: string | null
  downloadUrl?: string | null
  path: string
  name: string
}

export type StudioCategorizedFileReferences = {
  inputs: StudioFileReference[]
  outputs: StudioFileReference[]
  sources: StudioFileReference[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()

  return trimmed.length > 0 ? trimmed : null
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value)

    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function getPathBasename(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0)

  return segments[segments.length - 1] ?? path
}

// Dedup priority follows ChatGPT's content_references pattern:
// library:<id> → sandbox:<path> → file:<id> → download:<url> → path → name.
export function getStudioFileReferenceKey(
  reference: StudioFileReferenceKeyInput
): string {
  const libraryFileId = asString(reference.libraryFileId)

  if (libraryFileId) {
    return `library:${libraryFileId}`
  }

  const sandboxPath = asString(reference.sandboxPath)

  if (sandboxPath) {
    return `sandbox:${sandboxPath}`
  }

  const fileId = asString(reference.fileId)

  if (fileId) {
    return `file:${fileId}`
  }

  const downloadUrl = asString(reference.downloadUrl)

  if (downloadUrl) {
    return `download:${downloadUrl}`
  }

  const path = asString(reference.path)

  if (path) {
    return `path:${path}`
  }

  return `name:${asString(reference.name) ?? ""}`
}

function getMetadataRole(
  metadata: Record<string, unknown> | null
): StudioFileReferenceOrigin | null {
  if (!metadata) {
    return null
  }

  const role =
    asString(metadata.role) ??
    asString(metadata.author_role) ??
    asString(metadata.message_role) ??
    asString(asRecord(metadata.author)?.role)

  if (role === "user" || role === "assistant" || role === "tool") {
    return role
  }

  return null
}

function buildReference(input: {
  path: string
  name?: string | null
  kind: StudioFileReferenceKind
  origin?: StudioFileReferenceOrigin | null
  messageId?: string | null
  version?: number | null
  mimeType?: string | null
  sizeBytes?: number | null
  sandboxPath?: string | null
  libraryFileId?: string | null
  fileId?: string | null
  downloadUrl?: string | null
}): StudioFileReference {
  const name = asString(input.name) ?? getPathBasename(input.path)
  const key = getStudioFileReferenceKey({
    libraryFileId: input.libraryFileId,
    sandboxPath: input.sandboxPath,
    fileId: input.fileId,
    downloadUrl: input.downloadUrl,
    path: input.path,
    name,
  })

  return {
    key,
    path: input.path,
    name,
    kind: input.kind,
    origin: input.origin ?? null,
    messageId: input.messageId ?? null,
    version: input.version ?? null,
    mimeType: input.mimeType ?? null,
    sizeBytes: input.sizeBytes ?? null,
    sandboxPath: input.sandboxPath ?? null,
    libraryFileId: input.libraryFileId ?? null,
    fileId: input.fileId ?? null,
    downloadUrl: input.downloadUrl ?? null,
  }
}

function getContentReferenceKind(
  raw: Record<string, unknown>
): StudioFileReferenceKind {
  const kind =
    asString(raw.kind) ?? asString(raw.operation) ?? asString(raw.action)

  if (kind === "create" || kind === "edit" || kind === "delete") {
    return kind
  }

  return "reference"
}

// Normalizes one ChatGPT-style content_reference entry. Entries with an
// `items` array are grouped references and expand to one file per item.
// Non-file entries (webpage, sources, …) become `origin: "source"`.
function normalizeContentReference(
  raw: unknown,
  messageId: string | null,
  defaultOrigin: StudioFileReferenceOrigin | null
): StudioFileReference[] {
  const entry = asRecord(raw)

  if (!entry) {
    return []
  }

  if (Array.isArray(entry.items)) {
    return entry.items.flatMap((item) =>
      normalizeContentReference(item, messageId, defaultOrigin)
    )
  }

  const name =
    asString(entry.name) ?? asString(entry.title) ?? asString(entry.file_name)
  const sandboxPath =
    asString(entry.sandbox_path) ?? asString(entry.sandboxPath)
  const downloadUrl = asString(entry.download_url) ?? asString(entry.url)
  const path =
    asString(entry.path) ?? sandboxPath ?? asString(entry.file_path) ?? ""

  if (!name && !path && !downloadUrl) {
    return []
  }

  const type = asString(entry.type)
  const isFile = !type || type === "file"

  return [
    buildReference({
      path: path || name || downloadUrl || "",
      name,
      kind: isFile ? getContentReferenceKind(entry) : "reference",
      origin: isFile ? defaultOrigin : "source",
      messageId,
      version:
        asNumber(entry.current_version_number) ?? asNumber(entry.version),
      mimeType: asString(entry.mime_type),
      sizeBytes: asNumber(entry.size) ?? asNumber(entry.file_size_bytes),
      sandboxPath,
      libraryFileId: asString(entry.library_file_id),
      fileId: asString(entry.id) ?? asString(entry.file_id),
      downloadUrl,
    }),
  ]
}

function normalizeFilePart(
  part: Extract<StudioMessagePart, { type: "file" }>,
  origin: StudioFileReferenceOrigin | null
): StudioFileReference {
  return buildReference({
    path: part.path,
    kind: part.kind,
    origin,
    messageId: null,
    sandboxPath: part.path,
  })
}

function compareVersions(
  a: number | null | undefined,
  b: number | null | undefined
): number {
  return (a ?? Number.NEGATIVE_INFINITY) - (b ?? Number.NEGATIVE_INFINITY)
}

// Keeps the newer version's scalar fields, filling gaps from the older one.
function mergeReferences(
  existing: StudioFileReference,
  incoming: StudioFileReference
): StudioFileReference {
  const [newer, older] =
    compareVersions(incoming.version, existing.version) >= 0
      ? [incoming, existing]
      : [existing, incoming]

  return {
    ...older,
    ...newer,
    kind: newer.kind === "reference" ? older.kind : newer.kind,
    origin: newer.origin ?? older.origin,
    messageId: newer.messageId ?? older.messageId,
    version: newer.version ?? older.version,
    mimeType: newer.mimeType ?? older.mimeType,
    sizeBytes: newer.sizeBytes ?? older.sizeBytes,
    sandboxPath: newer.sandboxPath ?? older.sandboxPath,
    libraryFileId: newer.libraryFileId ?? older.libraryFileId,
    fileId: newer.fileId ?? older.fileId,
    downloadUrl: newer.downloadUrl ?? older.downloadUrl,
  }
}

export function aggregateStudioFileReferences(
  parts: StudioMessagePart[],
  metadata?: Record<string, unknown> | null
): StudioFileReference[] {
  const role = getMetadataRole(metadata ?? null)
  const messageId =
    asString(metadata?.message_id) ?? asString(metadata?.messageId)
  const references: StudioFileReference[] = []

  for (const part of parts) {
    if (part.type === "file") {
      references.push(normalizeFilePart(part, role ?? "assistant"))
    }
  }

  const contentReferences = asRecord(metadata ?? null)?.content_references

  if (Array.isArray(contentReferences)) {
    for (const entry of contentReferences) {
      references.push(...normalizeContentReference(entry, messageId, role))
    }
  }

  const byFile = asRecord(
    asRecord(metadata ?? null)?.content_references_by_file
  )

  if (byFile) {
    for (const value of Object.values(byFile)) {
      const entries = Array.isArray(value) ? value : [value]

      for (const entry of entries) {
        references.push(...normalizeContentReference(entry, messageId, role))
      }
    }
  }

  // Dedup by canonical key. References sharing a library file id collapse to
  // the same `library:<id>` key, so only the highest version survives.
  const deduped = new Map<string, StudioFileReference>()

  for (const reference of references) {
    const existing = deduped.get(reference.key)

    deduped.set(
      reference.key,
      existing ? mergeReferences(existing, reference) : reference
    )
  }

  return [...deduped.values()]
}

export function categorizeStudioFileReferences(
  references: StudioFileReference[]
): StudioCategorizedFileReferences {
  const categorized: StudioCategorizedFileReferences = {
    inputs: [],
    outputs: [],
    sources: [],
  }

  for (const reference of references) {
    if (reference.origin === "user") {
      categorized.inputs.push(reference)
    } else if (reference.origin === "source") {
      categorized.sources.push(reference)
    } else {
      // Assistant- and tool-generated files are outputs; unknown origins
      // default to outputs since aggregation is assistant-message-centric.
      categorized.outputs.push(reference)
    }
  }

  return categorized
}
