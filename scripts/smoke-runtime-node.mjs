import { accessSync, constants, mkdirSync, mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function configureSmokeNodeExecutable(env = process.env) {
  const configured = env.ASTRAFLOW_NODE_EXECUTABLE?.trim()

  if (configured && isExecutable(configured)) {
    return realpathSync.native(configured)
  }

  const executableName = process.platform === "win32" ? "node.exe" : "node"

  for (const directory of (env.PATH ?? "").split(delimiter)) {
    if (!directory) {
      continue
    }

    const candidate = join(directory, executableName)

    if (isExecutable(candidate)) {
      const executable = realpathSync.native(candidate)
      env.ASTRAFLOW_NODE_EXECUTABLE = executable
      return executable
    }
  }

  throw new Error(
    "ACP sandbox smoke requires Node.js on PATH so the sandbox runner matches the packaged Electron Node runtime."
  )
}

/**
 * Creates a throwaway root directory for a sandboxed ACP smoke.
 *
 * On Windows the sandboxed Agent runs as the dedicated `srt-sandbox` local
 * account. That account has the "bypass traverse checking" privilege — so it
 * can pass THROUGH another user's directories to reach an explicitly granted
 * leaf — but it has no read-attributes right on those ancestors. `os.tmpdir()`
 * resolves to `%LOCALAPPDATA%\Temp`, i.e. INSIDE the launching user's private
 * profile (`C:\Users\<user>\AppData\...`). When a runtime such as OpenCode
 * canonicalizes its working directory it `lstat()`s every ancestor of that
 * path, hits `C:\Users\<user>\AppData`, and is denied (`EPERM`), which crashes
 * the Agent before the ACP handshake completes.
 *
 * Root the smoke under a machine-wide directory whose ancestor chain grants
 * `BUILTIN\Users` read-and-execute (ProgramData) so ancestor `lstat()`s
 * succeed. Non-Windows sandboxes redirect HOME and use path-based isolation,
 * so the system temp directory is fine there.
 */
export function createSmokeSandboxRoot(prefix) {
  const base =
    process.platform === "win32"
      ? process.env.ProgramData?.trim() ||
        join(process.env.SystemDrive?.trim() || "C:", "ProgramData")
      : tmpdir()

  mkdirSync(base, { recursive: true })

  return mkdtempSync(join(base, prefix))
}
