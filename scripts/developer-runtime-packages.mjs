import { readFileSync } from "node:fs"
import { join } from "node:path"

export const DEVELOPER_RUNTIME_DOWNLOAD_BASE_URL =
  "https://astraflow-desktop.cn-sh2.ufileos.com/developer-runtimes/v1"
export const NODE_RUNTIME_VERSION = "24.17.0"
export const NPM_RUNTIME_VERSION = "11.13.0"

function pythonVersion(appRoot) {
  const manifest = JSON.parse(
    readFileSync(
      join(appRoot, "runtime", "python", "runtime-manifest.json"),
      "utf8"
    )
  )

  if (typeof manifest.pythonVersion !== "string" || !manifest.pythonVersion) {
    throw new Error("Python runtime manifest does not declare pythonVersion.")
  }

  return manifest.pythonVersion
}

export function getDeveloperRuntimeLayout(runtimeTarget) {
  const windows = runtimeTarget.startsWith("win32-")

  return {
    python: {
      commands: {
        python: windows ? "python.exe" : "bin/python3",
        pip: windows ? "Scripts/pip.exe" : "bin/pip3",
      },
    },
    node: {
      commands: {
        node: windows ? "node.exe" : "bin/node",
        npm: windows ? "npm.cmd" : "bin/npm",
        npx: windows ? "npx.cmd" : "bin/npx",
      },
    },
  }
}

export function createDeveloperRuntimeCatalog({
  appRoot,
  downloadBaseUrl = DEVELOPER_RUNTIME_DOWNLOAD_BASE_URL,
  runtimeTarget,
}) {
  const layout = getDeveloperRuntimeLayout(runtimeTarget)

  return {
    schemaVersion: 1,
    target: runtimeTarget,
    downloadBaseUrl,
    runtimes: {
      python: {
        id: "python",
        label: "Python",
        version: pythonVersion(appRoot),
        commands: layout.python.commands,
      },
      node: {
        id: "node",
        label: "Node.js + npm",
        version: NODE_RUNTIME_VERSION,
        packageManagerVersion: NPM_RUNTIME_VERSION,
        commands: layout.node.commands,
      },
    },
  }
}
