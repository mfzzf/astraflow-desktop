// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { createEnvironmentRuntimeTools } from "@/lib/ai/tools/environment"

const environmentNames = [
  "ASTRAFLOW_BUNDLED_PYTHON_ROOT",
  "ASTRAFLOW_DEVELOPER_NODE_EXECUTABLE",
  "ASTRAFLOW_DEVELOPER_NODE_ROOT",
  "ASTRAFLOW_DEVELOPER_NODE_VERSION",
  "ASTRAFLOW_ELECTRON_DEV",
  "ASTRAFLOW_ENVIRONMENT_INSTALLER_PATH",
  "ASTRAFLOW_ENVIRONMENT_MANAGER_PATH",
  "ASTRAFLOW_NODE_EXECUTABLE",
  "ASTRAFLOW_NPM_EXECUTABLE",
  "ASTRAFLOW_NPM_VERSION",
  "ASTRAFLOW_PYTHON_BOOTSTRAP_EXECUTABLE",
  "ASTRAFLOW_UNPACKED_APP_ROOT",
  "ASTRAFLOW_USER_DATA_PATH",
] as const

describe("AstraFlow environment MCP tools", () => {
  let testRoot = ""
  let previousEnvironment: Partial<
    Record<(typeof environmentNames)[number], string>
  >

  beforeEach(() => {
    previousEnvironment = Object.fromEntries(
      environmentNames.map((name) => [name, process.env[name]])
    )
    testRoot = mkdtempSync(join(tmpdir(), "astraflow-environment-tool-"))
    const pythonRoot = join(testRoot, "python")
    const pythonBin =
      process.platform === "win32" ? pythonRoot : join(pythonRoot, "bin")
    const pythonExecutable = join(
      pythonBin,
      process.platform === "win32" ? "python.exe" : "python3"
    )
    const pipExecutable = join(
      process.platform === "win32" ? join(pythonRoot, "Scripts") : pythonBin,
      process.platform === "win32" ? "pip.cmd" : "pip3"
    )
    const nodeRoot = join(testRoot, "node")
    const nodeBin =
      process.platform === "win32" ? nodeRoot : join(nodeRoot, "bin")
    const commands = [
      pythonExecutable,
      pipExecutable,
      join(nodeBin, process.platform === "win32" ? "node.exe" : "node"),
      join(nodeBin, process.platform === "win32" ? "npm.cmd" : "npm"),
      join(nodeBin, process.platform === "win32" ? "npx.cmd" : "npx"),
    ]

    const outputs = ["3.12.13", "pip 25.0", "v24.17.0", "11.13.0", "11.13.0"]

    for (const [index, command] of commands.entries()) {
      mkdirSync(dirname(command), { recursive: true })
      writeFileSync(
        command,
        process.platform === "win32"
          ? "fake runtime command"
          : `#!/bin/sh\nprintf '%s\\n' '${outputs[index]}'\n`
      )
      chmodSync(command, 0o755)
    }

    process.env.ASTRAFLOW_ELECTRON_DEV = "1"
    process.env.ASTRAFLOW_NODE_EXECUTABLE = process.execPath
    process.env.ASTRAFLOW_ENVIRONMENT_INSTALLER_PATH = resolve(
      "runtime/developer-runtimes/environment-installer.mjs"
    )
    process.env.ASTRAFLOW_ENVIRONMENT_MANAGER_PATH = resolve(
      "electron/developer-runtime-environment.cjs"
    )
    process.env.ASTRAFLOW_UNPACKED_APP_ROOT = process.cwd()
    process.env.ASTRAFLOW_USER_DATA_PATH = join(testRoot, "user-data")
    process.env.ASTRAFLOW_BUNDLED_PYTHON_ROOT = pythonRoot
    process.env.ASTRAFLOW_PYTHON_BOOTSTRAP_EXECUTABLE = pythonExecutable
    process.env.ASTRAFLOW_DEVELOPER_NODE_ROOT = nodeRoot
    process.env.ASTRAFLOW_DEVELOPER_NODE_EXECUTABLE = commands[2]
    process.env.ASTRAFLOW_DEVELOPER_NODE_VERSION = "24.17.0"
    process.env.ASTRAFLOW_NPM_EXECUTABLE = commands[3]
    process.env.ASTRAFLOW_NPM_VERSION = "11.13.0"
    process.env.ASTRAFLOW_PYTHON_BOOTSTRAP_VERSION = "3.12.13"
  })

  afterEach(() => {
    for (const name of environmentNames) {
      const previous = previousEnvironment[name]

      if (previous === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = previous
      }
    }

    rmSync(testRoot, { recursive: true, force: true })
  })

  test("reports and installs runtimes without depending on Python or npm", async () => {
    if (process.platform === "win32") {
      return
    }

    const [statusTool, healthTool, installTool] =
      createEnvironmentRuntimeTools()
    const statuses = (await statusTool.invoke({})) as Array<{
      runtimeId: string
      ready: boolean
      commands: string[]
    }>

    expect(statuses.map((status) => status.runtimeId)).toEqual([
      "python",
      "node",
    ])
    expect(statuses.every((status) => status.ready)).toBe(true)
    expect(statuses[1]?.commands).toEqual(["node", "npm", "npx"])

    const health = (await healthTool.invoke({})) as Array<{
      runtimeId: string
      healthy: boolean
    }>
    expect(health.every((runtime) => runtime.healthy)).toBe(true)

    const installed = (await installTool.invoke({ runtime: "node" })) as {
      runtimeId: string
      ready: boolean
      health: { healthy: boolean }
    }
    expect(installed.runtimeId).toBe("node")
    expect(installed.ready).toBe(true)
    expect(installed.health.healthy).toBe(true)
  })
})
