import { mkdirSync, rmSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"

import { safeFileName } from "@/lib/studio-file-storage"

function getPrivateDataRoot() {
  const configured = process.env.ASTRAFLOW_ACP_ATTACHMENTS_PATH?.trim()

  if (configured) {
    return resolve(configured)
  }

  const userDataRoot = process.env.ASTRAFLOW_USER_DATA_PATH?.trim()

  if (userDataRoot) {
    return join(resolve(userDataRoot), "acp-attachments")
  }

  const sqlitePath = process.env.ASTRAFLOW_SQLITE_PATH?.trim()

  return sqlitePath
    ? join(dirname(resolve(sqlitePath)), "..", "acp-attachments")
    : join(process.cwd(), ".data", "acp-attachments")
}

function getAcpAttachmentDirectory(sessionId: string) {
  const normalizedSessionId = safeFileName(sessionId)

  if (
    !sessionId ||
    normalizedSessionId !== sessionId ||
    normalizedSessionId === "." ||
    normalizedSessionId === ".."
  ) {
    throw new Error("Invalid ACP attachment session id.")
  }

  const root = resolve(getPrivateDataRoot())
  const directory = resolve(root, normalizedSessionId)
  const pathFromRoot = relative(root, directory)

  if (
    !pathFromRoot ||
    pathFromRoot.startsWith("..") ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error("Invalid ACP attachment directory.")
  }

  return directory
}

export function ensureAcpAttachmentDirectory(sessionId: string) {
  const directory = getAcpAttachmentDirectory(sessionId)

  mkdirSync(directory, { recursive: true, mode: 0o700 })
  return directory
}

export function removeAcpAttachmentDirectory(sessionId: string) {
  const directory = getAcpAttachmentDirectory(sessionId)

  rmSync(directory, { recursive: true, force: true })
}
