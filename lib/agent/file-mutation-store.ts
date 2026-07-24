import { createHash, randomUUID } from "node:crypto"
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { join, resolve } from "node:path"
import { gunzipSync, gzipSync } from "node:zlib"

const FILE_MUTATION_STORE_VERSION = 1
const FILE_MUTATION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const FILE_MUTATION_SESSION_QUOTA_BYTES = 64 * 1024 * 1024
const FILE_MUTATION_MAX_DIFF_BYTES = 8 * 1024 * 1024
const FILE_MUTATION_MAX_STORED_BYTES = 64 * 1024 * 1024
const FILE_MUTATION_ID_PATTERN = /^[a-f0-9]{64}$/
const FILE_MUTATION_REVISION_PATTERN = /^[a-f0-9]{64}$/

type StoredFileMutation = {
  version: typeof FILE_MUTATION_STORE_VERSION
  id: string
  sessionId: string
  path: string
  revision: string | null
  previousRevision: string | null
  diff: string
  createdAt: number
  expiresAt: number
}

export type FileMutationBlob = Pick<
  StoredFileMutation,
  "id" | "path" | "revision" | "previousRevision" | "diff" | "createdAt" | "expiresAt"
>

function getFileMutationStoreRoot() {
  const configuredRoot =
    process.env.ASTRAFLOW_FILE_MUTATION_STORE_PATH?.trim() ||
    process.env.ASTRAFLOW_USER_DATA_PATH?.trim()

  if (!configuredRoot) {
    return null
  }

  return process.env.ASTRAFLOW_FILE_MUTATION_STORE_PATH?.trim()
    ? resolve(configuredRoot)
    : join(resolve(configuredRoot), "file-mutations")
}

function getSessionDirectory(root: string, sessionId: string) {
  const sessionKey = createHash("sha256").update(sessionId).digest("hex")

  return join(root, sessionKey)
}

function removeFileQuietly(path: string) {
  try {
    unlinkSync(path)
  } catch {
    // A concurrent cleanup may already have removed the entry.
  }
}

function listStoredFiles(directory: string) {
  try {
    return readdirSync(directory)
      .filter((name) => name.endsWith(".json.gz"))
      .flatMap((name) => {
        const path = join(directory, name)

        try {
          const stat = statSync(path)

          return stat.isFile()
            ? [{ path, size: stat.size, modifiedAt: stat.mtimeMs }]
            : []
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}

function pruneSessionDirectory(directory: string, now: number) {
  const liveFiles = listStoredFiles(directory)
    .filter((entry) => {
      if (now - entry.modifiedAt <= FILE_MUTATION_TTL_MS) {
        return true
      }

      removeFileQuietly(entry.path)
      return false
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
  let retainedBytes = 0

  for (const entry of liveFiles) {
    retainedBytes += entry.size

    if (retainedBytes > FILE_MUTATION_SESSION_QUOTA_BYTES) {
      removeFileQuietly(entry.path)
    }
  }
}

function parseStoredMutation(raw: Buffer): StoredFileMutation | null {
  try {
    if (raw.byteLength > FILE_MUTATION_MAX_DIFF_BYTES) {
      return null
    }

    const value = JSON.parse(
      gunzipSync(raw, {
        maxOutputLength: FILE_MUTATION_MAX_STORED_BYTES,
      }).toString("utf8")
    ) as Partial<StoredFileMutation>

    if (
      value.version !== FILE_MUTATION_STORE_VERSION ||
      typeof value.id !== "string" ||
      !FILE_MUTATION_ID_PATTERN.test(value.id) ||
      typeof value.sessionId !== "string" ||
      typeof value.path !== "string" ||
      typeof value.diff !== "string" ||
      typeof value.createdAt !== "number" ||
      typeof value.expiresAt !== "number" ||
      !FILE_MUTATION_REVISION_PATTERN.test(value.revision ?? "") ||
      !(
        value.previousRevision === null ||
        (typeof value.previousRevision === "string" &&
          FILE_MUTATION_REVISION_PATTERN.test(value.previousRevision))
      ) ||
      Buffer.byteLength(value.diff) > FILE_MUTATION_MAX_DIFF_BYTES
    ) {
      return null
    }

    return value as StoredFileMutation
  } catch {
    return null
  }
}

export function storeFileMutationDiff(input: {
  sessionId: string
  path: string
  revision: string | null
  previousRevision: string | null
  diff: string
  now?: number
}): string | null {
  const root = getFileMutationStoreRoot()
  const sessionId = input.sessionId.trim()
  const path = input.path.trim()
  const revision = input.revision?.trim().toLowerCase() ?? null
  const previousRevision =
    input.previousRevision?.trim().toLowerCase() ?? null
  const diffBytes = Buffer.byteLength(input.diff)

  if (
    !root ||
    !sessionId ||
    !path ||
    !revision ||
    !FILE_MUTATION_REVISION_PATTERN.test(revision) ||
    (previousRevision !== null &&
      !FILE_MUTATION_REVISION_PATTERN.test(previousRevision)) ||
    !input.diff ||
    diffBytes > FILE_MUTATION_MAX_DIFF_BYTES
  ) {
    return null
  }

  const now = input.now ?? Date.now()
  const id = createHash("sha256")
    .update(sessionId)
    .update("\0")
    .update(path)
    .update("\0")
    .update(revision)
    .update("\0")
    .update(previousRevision ?? "")
    .update("\0")
    .update(input.diff)
    .digest("hex")
  const directory = getSessionDirectory(root, sessionId)
  const destination = join(directory, `${id}.json.gz`)
  const mutation: StoredFileMutation = {
    version: FILE_MUTATION_STORE_VERSION,
    id,
    sessionId,
    path,
    revision,
    previousRevision,
    diff: input.diff,
    createdAt: now,
    expiresAt: now + FILE_MUTATION_TTL_MS,
  }

  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    chmodSync(directory, 0o700)

    try {
      const existing = parseStoredMutation(readFileSync(destination))

      if (
        existing?.sessionId === sessionId &&
        existing.path === path &&
        existing.revision === revision &&
        existing.previousRevision === previousRevision &&
        existing.diff === input.diff
      ) {
        return id
      }
    } catch {
      // The content-addressed entry does not exist yet.
    }

    const serialized = JSON.stringify(mutation)

    if (Buffer.byteLength(serialized) > FILE_MUTATION_MAX_STORED_BYTES) {
      return null
    }

    const compressed = gzipSync(serialized, { level: 6 })

    if (compressed.byteLength > FILE_MUTATION_MAX_DIFF_BYTES) {
      return null
    }

    const temporary = join(directory, `.${id}.${randomUUID()}.tmp`)

    writeFileSync(temporary, compressed, { mode: 0o600 })
    renameSync(temporary, destination)
    pruneSessionDirectory(directory, now)

    return id
  } catch {
    return null
  }
}

export function readFileMutationDiff(input: {
  sessionId: string
  id: string
  path?: string
  revision?: string | null
  now?: number
}): FileMutationBlob | null {
  const root = getFileMutationStoreRoot()
  const sessionId = input.sessionId.trim()
  const id = input.id.trim().toLowerCase()
  const expectedPath = input.path?.trim()
  const expectedRevision =
    typeof input.revision === "string"
      ? input.revision.trim().toLowerCase()
      : input.revision

  if (
    !root ||
    !sessionId ||
    !FILE_MUTATION_ID_PATTERN.test(id) ||
    (input.path !== undefined && !expectedPath) ||
    (typeof expectedRevision === "string" &&
      !FILE_MUTATION_REVISION_PATTERN.test(expectedRevision))
  ) {
    return null
  }

  const directory = getSessionDirectory(root, sessionId)
  const path = join(directory, `${id}.json.gz`)
  let stored: StoredFileMutation | null = null

  try {
    stored = parseStoredMutation(readFileSync(path))
  } catch {
    return null
  }

  const now = input.now ?? Date.now()

  if (
    !stored ||
    stored.id !== id ||
    stored.sessionId !== sessionId ||
    stored.expiresAt <= now ||
    (expectedPath !== undefined && stored.path !== expectedPath) ||
    (expectedRevision !== undefined &&
      stored.revision !== expectedRevision)
  ) {
    if (stored?.expiresAt !== undefined && stored.expiresAt <= now) {
      removeFileQuietly(path)
    }

    return null
  }

  return {
    id: stored.id,
    path: stored.path,
    revision: stored.revision,
    previousRevision: stored.previousRevision,
    diff: stored.diff,
    createdAt: stored.createdAt,
    expiresAt: stored.expiresAt,
  }
}
