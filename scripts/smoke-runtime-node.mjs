import { accessSync, constants, realpathSync } from "node:fs"
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
