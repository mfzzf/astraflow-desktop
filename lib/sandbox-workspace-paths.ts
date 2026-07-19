import { posix } from "node:path"

export const ASTRAFLOW_SANDBOX_GATEWAY_ROOT = "/workspace"

/**
 * Runtime-owned files may be read or executed by a prepared Skill, but they
 * are deliberately not part of the user's workspace and must never become a
 * default output location.
 */
export const ASTRAFLOW_SANDBOX_PRIVATE_READ_ROOTS = [
  "/home/user/astraflow/skills",
  "/opt/astraflow",
] as const

/**
 * Agent runtimes and third-party tools occasionally write final artifacts to
 * conventional temporary or mounted-data roots even when their cwd is under
 * /workspace. These roots are safe to expose to the owner through the file
 * preview transport; runtime-owned configuration roots remain excluded.
 */
export const ASTRAFLOW_SANDBOX_EXTERNAL_FILE_ROOTS = [
  "/tmp",
  "/mnt/data",
] as const

export function normalizeSandboxWorkspaceRoot(root: string) {
  if (root.includes("\0")) {
    throw new Error("Sandbox workspace root contains an invalid null byte.")
  }

  const normalized = posix.normalize(root.trim()).replace(/\/+$/, "") || "/"

  if (
    !normalized.startsWith("/") ||
    (normalized !== ASTRAFLOW_SANDBOX_GATEWAY_ROOT &&
      !normalized.startsWith(`${ASTRAFLOW_SANDBOX_GATEWAY_ROOT}/`))
  ) {
    throw new Error(
      `Sandbox workspace root must stay under ${ASTRAFLOW_SANDBOX_GATEWAY_ROOT}.`
    )
  }

  return normalized
}

export function isPosixPathInsideRoot(path: string, root: string) {
  const normalizedPath = posix.normalize(path)
  const normalizedRoot = posix.normalize(root)

  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}/`)
  )
}

export function normalizeSandboxReadableFilePath({
  gatewayRoot,
  path,
}: {
  gatewayRoot: string
  path: string
}) {
  const normalizedGatewayRoot = normalizeSandboxWorkspaceRoot(gatewayRoot)
  const trimmed = path.trim()

  if (!trimmed || trimmed.includes("\0") || !trimmed.startsWith("/")) {
    throw new Error("Sandbox file path must be an absolute path.")
  }

  const normalized = posix.normalize(trimmed)
  const readableRoots = [
    normalizedGatewayRoot,
    ...ASTRAFLOW_SANDBOX_EXTERNAL_FILE_ROOTS,
  ]

  if (
    ASTRAFLOW_SANDBOX_PRIVATE_READ_ROOTS.some((privateRoot) =>
      isPosixPathInsideRoot(normalized, privateRoot)
    ) ||
    !readableRoots.some((root) => isPosixPathInsideRoot(normalized, root))
  ) {
    throw new Error(
      `Sandbox file path must stay inside ${readableRoots.join(", ")}.`
    )
  }

  return normalized
}

export function resolveSandboxWorkspacePath({
  allowPrivateRead = false,
  path,
  workspaceRoot,
}: {
  allowPrivateRead?: boolean
  path: string
  workspaceRoot: string
}) {
  const root = normalizeSandboxWorkspaceRoot(workspaceRoot)
  const trimmed = path.trim()

  if (!trimmed || trimmed === "/") {
    return root
  }

  if (trimmed.includes("\0")) {
    throw new Error("Sandbox file path contains an invalid null byte.")
  }

  const normalized = trimmed.startsWith("/")
    ? posix.normalize(trimmed)
    : posix.normalize(posix.join(root, trimmed))

  if (isPosixPathInsideRoot(normalized, root)) {
    return normalized
  }

  if (
    allowPrivateRead &&
    ASTRAFLOW_SANDBOX_PRIVATE_READ_ROOTS.some((privateRoot) =>
      isPosixPathInsideRoot(normalized, privateRoot)
    )
  ) {
    return normalized
  }

  throw new Error(`Sandbox path must stay inside workspace root ${root}.`)
}

export function getSandboxWorkspaceOutputRoot(workspaceRoot: string) {
  return posix.join(normalizeSandboxWorkspaceRoot(workspaceRoot), "outputs")
}

export function getSandboxWorkspaceAttachmentsRoot(workspaceRoot: string) {
  return posix.join(normalizeSandboxWorkspaceRoot(workspaceRoot), "attachments")
}

export function getSandboxWorkspacePrivateRoot(workspaceRoot: string) {
  return posix.join(normalizeSandboxWorkspaceRoot(workspaceRoot), ".astraflow")
}
