import { spawnSync } from "node:child_process"
import { win32 } from "node:path"

const WINDOWS_SID_PATTERN = /^S-\d(?:-\d+)+$/i
const ICACLS_TIMEOUT_MS = 5_000
const ICACLS_MAX_ATTEMPTS = 3

function normalizeWindowsPathForComparison(value) {
  return win32.resolve(value).replace(/[\\/]+$/, "").toLocaleLowerCase("en-US")
}

function isSameOrDescendantWindowsPath(path, root) {
  const normalizedPath = normalizeWindowsPathForComparison(path)
  const normalizedRoot = normalizeWindowsPathForComparison(root)

  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}\\`)
  )
}

/**
 * Return the strict ancestors under the real user's profile that a Windows
 * Agent runtime may canonicalize while opening an explicitly granted leaf.
 *
 * Sandbox Runtime grants each configured leaf but intentionally does not
 * expose its protected ancestors. Bun's Windows realpath implementation
 * (used by OpenCode) opens every ancestor for metadata, so it otherwise
 * fails at paths such as AppData before reaching the granted workspace.
 */
export function collectWindowsSandboxAncestorMetadataPaths(
  paths,
  userProfile
) {
  if (
    !Array.isArray(paths) ||
    typeof userProfile !== "string" ||
    !win32.isAbsolute(userProfile)
  ) {
    return []
  }

  const canonicalProfile = win32.resolve(userProfile)
  const grantedLeaves = new Set(
    paths
      .filter(
        (value) =>
          typeof value === "string" &&
          win32.isAbsolute(value) &&
          isSameOrDescendantWindowsPath(value, canonicalProfile)
      )
      .map(normalizeWindowsPathForComparison)
  )
  const candidates = new Map()

  for (const value of paths) {
    if (
      typeof value !== "string" ||
      !win32.isAbsolute(value) ||
      !isSameOrDescendantWindowsPath(value, canonicalProfile)
    ) {
      continue
    }

    let current = win32.dirname(win32.resolve(value))
    while (
      current !== win32.dirname(current) &&
      isSameOrDescendantWindowsPath(current, canonicalProfile)
    ) {
      const key = normalizeWindowsPathForComparison(current)
      if (
        key !== normalizeWindowsPathForComparison(canonicalProfile) &&
        !grantedLeaves.has(key) &&
        !candidates.has(key)
      ) {
        candidates.set(key, current)
      }
      if (key === normalizeWindowsPathForComparison(canonicalProfile)) {
        break
      }
      current = win32.dirname(current)
    }
  }

  return [...candidates.values()].sort((left, right) => {
    const leftDepth = left.split(/[\\/]/).length
    const rightDepth = right.split(/[\\/]/).length
    return leftDepth - rightDepth || left.localeCompare(right)
  })
}

/**
 * Provision metadata-only access for the dedicated sandbox SID on protected
 * workspace ancestors.
 *
 * The ACE is deliberately non-inheriting and contains only
 * FILE_READ_ATTRIBUTES (`RA`) plus SYNCHRONIZE (`S`), which libuv needs when
 * opening a directory for `lstat`. It does not permit listing a directory,
 * reading a child, or changing anything. It is safe to keep as part of the
 * machine's sandbox-user provisioning and avoids races between concurrent
 * AstraFlow and CompShare sessions. Repeating `icacls /grant` is idempotent
 * because Windows coalesces the same SID, flags, and access mask.
 */
export function acquireWindowsSandboxAncestorMetadataAccess({
  paths,
  sandboxUserSid,
  userProfile = process.env.USERPROFILE,
  spawnSyncImpl = spawnSync,
  systemRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows",
  platform = process.platform,
}) {
  if (platform !== "win32" || typeof userProfile !== "string") {
    return null
  }
  if (!WINDOWS_SID_PATTERN.test(sandboxUserSid)) {
    throw new Error("The Windows sandbox user SID is invalid.")
  }

  const ancestorPaths = collectWindowsSandboxAncestorMetadataPaths(
    paths,
    userProfile
  )
  if (ancestorPaths.length === 0) {
    return null
  }

  const executable = win32.join(systemRoot, "System32", "icacls.exe")
  for (const path of ancestorPaths) {
    for (let attempt = 1; attempt <= ICACLS_MAX_ATTEMPTS; attempt += 1) {
      const result = spawnSyncImpl(
        executable,
        [path, "/grant", `*${sandboxUserSid}:(RA,S)`, "/q"],
        {
          encoding: "utf8",
          timeout: ICACLS_TIMEOUT_MS,
          windowsHide: true,
        }
      )

      if (result.error?.code === "ETIMEDOUT" && attempt < ICACLS_MAX_ATTEMPTS) {
        continue
      }
      if (result.error) {
        throw new Error(
          `Windows sandbox ancestor metadata grant failed to start for ${path}: ${result.error.message}`
        )
      }
      if (result.status !== 0) {
        throw new Error(
          `Windows sandbox ancestor metadata grant failed for ${path}: ${
            result.stderr?.trim() || result.stdout?.trim() || "unknown error"
          }`
        )
      }
      break
    }
  }

  return {
    paths: ancestorPaths,
    // The minimal, non-inheriting RA+S ACE is provisioning state shared by
    // concurrent AstraFlow and CompShare sessions. Removing it per command
    // would race with another process using the same dedicated sandbox SID.
    release() {},
  }
}
