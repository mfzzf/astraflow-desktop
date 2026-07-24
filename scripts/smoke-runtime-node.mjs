import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs"
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
 * Keep Windows under `%LOCALAPPDATA%\Temp` deliberately. OpenCode
 * canonicalizes every ancestor of its workspace, so this exercises the
 * metadata-only grants that let the dedicated sandbox account traverse a
 * real user's protected profile without exposing directory contents.
 */
export function createSmokeSandboxRoot(prefix) {
  return mkdtempSync(join(tmpdir(), prefix))
}

/**
 * Mirrors the installed app's downloaded runtime location on Windows.
 *
 * GitHub's Windows Arm64 workspace is owned exclusively by the runner
 * account, while production runtimes live below Desktop user data. Copying
 * the exact native executable into the protected smoke root tests the real
 * user-profile traversal and srt-sandbox execute grants instead of inheriting
 * runner-image-specific ACLs from C:\a.
 */
export function stageSmokeRuntimeExecutable(source, root, fileName) {
  const runtimeRoot = join(root, "downloaded-agent-runtimes")
  const target = join(runtimeRoot, fileName)

  mkdirSync(runtimeRoot, { recursive: true })
  copyFileSync(source, target)
  if (process.platform !== "win32") {
    chmodSync(target, 0o755)
  }
  return realpathSync.native(target)
}

function hasChildExited(child) {
  return child.exitCode !== null || child.signalCode !== null
}

function waitForChildExit(child, timeoutMs) {
  if (hasChildExited(child)) {
    return Promise.resolve(true)
  }

  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => {
      child.off("exit", onExit)
      resolve(false)
    }, timeoutMs)

    child.once("exit", onExit)
  })
}

/**
 * Stop a sandbox smoke subprocess and wait for all Windows handles owned by
 * its runner to close before removing the temporary workspace.
 */
export async function stopSmokeChild(child) {
  if (hasChildExited(child)) {
    return
  }

  let exited = waitForChildExit(child, 5_000)
  if (!child.killed) {
    child.kill("SIGTERM")
  }
  if (await exited) {
    return
  }

  exited = waitForChildExit(child, 5_000)
  child.kill("SIGKILL")
  await exited
}

export function removeSmokeSandboxRoot(root) {
  rmSync(root, {
    force: true,
    maxRetries: process.platform === "win32" ? 20 : 0,
    recursive: true,
    retryDelay: 100,
  })
}
