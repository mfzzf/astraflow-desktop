import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const managerPath = process.env.ASTRAFLOW_ENVIRONMENT_MANAGER_PATH

if (!managerPath) {
  throw new Error("AstraFlow environment manager path is not configured.")
}

const { createDeveloperRuntimeEnvironmentManager } = require(managerPath)

function developmentRuntimes() {
  if (process.env.ASTRAFLOW_ELECTRON_DEV !== "1") {
    return null
  }

  const pythonRoot = process.env.ASTRAFLOW_BUNDLED_PYTHON_ROOT
  const pythonExecutable = process.env.ASTRAFLOW_PYTHON_BOOTSTRAP_EXECUTABLE
  const nodeRoot = process.env.ASTRAFLOW_DEVELOPER_NODE_ROOT
  const nodeExecutable = process.env.ASTRAFLOW_DEVELOPER_NODE_EXECUTABLE
  const npmExecutable = process.env.ASTRAFLOW_NPM_EXECUTABLE

  if (
    !pythonRoot ||
    !pythonExecutable ||
    !nodeRoot ||
    !nodeExecutable ||
    !npmExecutable
  ) {
    return null
  }

  return {
    python: {
      id: "python",
      label: "Python",
      version: process.env.ASTRAFLOW_PYTHON_BOOTSTRAP_VERSION || "development",
      packageManagerVersion: null,
      root: pythonRoot,
      commands: {
        python: pythonExecutable.slice(pythonRoot.length + 1),
        pip: process.platform === "win32" ? "Scripts/pip.exe" : "bin/pip3",
      },
    },
    node: {
      id: "node",
      label: "Node.js + npm",
      version: process.env.ASTRAFLOW_DEVELOPER_NODE_VERSION || "development",
      packageManagerVersion: process.env.ASTRAFLOW_NPM_VERSION || null,
      root: nodeRoot,
      commands: {
        node: nodeExecutable.slice(nodeRoot.length + 1),
        npm: npmExecutable.slice(nodeRoot.length + 1),
        npx:
          process.platform === "win32"
            ? "npx.cmd"
            : `${npmExecutable.slice(nodeRoot.length + 1).replace(/npm$/, "npx")}`,
      },
    },
  }
}

const appRoot = process.env.ASTRAFLOW_UNPACKED_APP_ROOT
const userDataPath = process.env.ASTRAFLOW_USER_DATA_PATH
const action = process.argv[2]
const runtimeId = process.argv[3]

if (!appRoot || !userDataPath) {
  throw new Error("AstraFlow developer runtime paths are not configured.")
}

const manager = createDeveloperRuntimeEnvironmentManager({
  appRoot,
  userDataPath,
  developmentRuntimes: developmentRuntimes(),
})
let result

if (action === "status" && !runtimeId) {
  result = manager.getStatuses()
} else if (
  action === "health" &&
  (!runtimeId || ["python", "node"].includes(runtimeId))
) {
  result = await manager.checkHealth(runtimeId)
} else if (action === "install" && ["python", "node"].includes(runtimeId)) {
  let status = await manager.install(runtimeId)
  let health = await manager.checkHealth(runtimeId)

  if (!health.healthy && health.installed) {
    status = await manager.install(runtimeId, { force: true })
    health = await manager.checkHealth(runtimeId)
  }

  if (!health.healthy) {
    throw new Error(
      health.message || `${health.label} failed its post-install health check.`
    )
  }

  result = { ...status, health }
} else {
  throw new Error(
    "Usage: environment-installer.mjs status | health [python|node] | install <python|node>"
  )
}

process.stdout.write(`${JSON.stringify(result)}\n`)
