import {
  accessSync,
  chmodSync,
  constants,
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join } from "node:path"

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

function getNodeModulePath(nodeModulesDir, packageName) {
  return join(nodeModulesDir, ...packageName.split("/"))
}

/**
 * Copies a JavaScript runtime and its ordinary dependency closure below the
 * disposable smoke root.
 *
 * GitHub's Windows Arm64 checkout ACL can deny the dedicated sandbox account
 * even after a narrow read grant. Installed Desktop runtimes live below the
 * user's profile instead, so stage the ACP adapter there to exercise the
 * production layout. Optional native packages are deliberately excluded:
 * their verified executable is staged separately and selected through the
 * runtime's explicit executable environment variable.
 */
export function stageSmokeNodeModuleClosure({
  nodeModulesDir,
  packageNames,
  root,
}) {
  const targetNodeModules = join(
    root,
    "downloaded-agent-runtime",
    "node_modules"
  )
  const seen = new Set()

  function stagePackage(packageName) {
    if (seen.has(packageName)) {
      return
    }

    seen.add(packageName)
    const sourcePackage = getNodeModulePath(nodeModulesDir, packageName)

    if (!existsSync(sourcePackage)) {
      throw new Error(
        `ACP sandbox smoke runtime dependency is missing: ${packageName}`
      )
    }

    const packageJson = JSON.parse(
      readFileSync(join(sourcePackage, "package.json"), "utf8")
    )
    const targetPackage = getNodeModulePath(
      targetNodeModules,
      packageName
    )

    mkdirSync(dirname(targetPackage), { recursive: true })
    cpSync(sourcePackage, targetPackage, {
      dereference: true,
      force: true,
      recursive: true,
      filter: (source) => !source.endsWith(".map"),
    })

    for (const dependencyName of Object.keys(
      packageJson.dependencies ?? {}
    )) {
      stagePackage(dependencyName)
    }
  }

  for (const packageName of packageNames) {
    stagePackage(packageName)
  }

  return realpathSync.native(targetNodeModules)
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

const WINDOWS_REMOVE_RETRYABLE_CODES = new Set([
  "EACCES",
  "EBUSY",
  "ENOTEMPTY",
  "EPERM",
])

/**
 * Windows can keep a just-exited native executable mapped for a short time.
 * Node's recursive rm retries EPERM/EBUSY but Bun reports that case as
 * EACCES, so retry the complete removal until every sandbox process handle
 * and ACL broker operation has settled.
 */
export async function removeSmokeSandboxRoot(
  root,
  {
    platform = process.platform,
    removeSync = rmSync,
    wait = (delayMs) =>
      new Promise((resolve) => setTimeout(resolve, delayMs)),
  } = {}
) {
  const maxAttempts = platform === "win32" ? 51 : 1

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      removeSync(root, {
        force: true,
        recursive: true,
      })
      return
    } catch (error) {
      if (
        platform !== "win32" ||
        !WINDOWS_REMOVE_RETRYABLE_CODES.has(error?.code) ||
        attempt === maxAttempts
      ) {
        throw error
      }

      await wait(200)
    }
  }
}
