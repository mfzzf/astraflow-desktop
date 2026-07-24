// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterAll, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const root = mkdtempSync(join(tmpdir(), "opencode-local-sandbox-"))
const nodeExecutable = execFileSync("which", ["node"], {
  encoding: "utf8",
}).trim()
const previousEnvironment = new Map(
  [
    "ASTRAFLOW_ACP_ATTACHMENTS_PATH",
    "ASTRAFLOW_MANAGED_WORKSPACES_PATH",
    "ASTRAFLOW_NODE_EXECUTABLE",
    "ASTRAFLOW_SANDBOX_WORKSPACES_PATH",
    "ASTRAFLOW_SECRET_KEY",
    "ASTRAFLOW_USER_DATA_PATH",
  ].map((name) => [name, process.env[name]])
)

process.env.ASTRAFLOW_ACP_ATTACHMENTS_PATH = join(root, "acp-attachments")
process.env.ASTRAFLOW_MANAGED_WORKSPACES_PATH = join(root, "AstraFlow")
process.env.ASTRAFLOW_NODE_EXECUTABLE = nodeExecutable
process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH = join(root, "sandbox-workspaces")
process.env.ASTRAFLOW_SECRET_KEY = "66".repeat(32)
process.env.ASTRAFLOW_USER_DATA_PATH = join(root, "user-data")

const { applyOpenCodeLocalProcessSandbox, createOpenCodePermissionConfig } =
  await import("@/lib/agent/adapters/opencode-local-sandbox")
const { spawnLocalSandboxedAcpProcess } =
  await import("@/lib/agent/sandbox/local-command")
const { createLocalSandboxPolicy } =
  await import("@/lib/agent/sandbox/local-policy")

afterAll(() => {
  for (const [name, value] of previousEnvironment) {
    if (value === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = value
    }
  }

  rmSync(root, { force: true, recursive: true })
})

function input(
  permissionMode: "default" | "full_access" | "legacy_readonly",
  sessionId = `opencode-${permissionMode}`
) {
  return {
    environment: "local" as const,
    messages: [],
    model: "gpt-5.6-sol" as const,
    permissionMode,
    sessionId,
    signal: new AbortController().signal,
  }
}

function commandForRun(
  permissionMode: "default" | "full_access" | "legacy_readonly",
  sessionId?: string
) {
  const runInput = input(permissionMode, sessionId)

  return applyOpenCodeLocalProcessSandbox({
    command: {
      command: nodeExecutable,
      args: ["acp"],
      env: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          permission: createOpenCodePermissionConfig(permissionMode),
        }),
      },
      providerProxyToken: "a".repeat(43),
      providerProxyTokenTransport: "fd3",
    },
    input: runInput,
    providerEndpoint: { host: "127.0.0.1", port: 3456 },
  })
}

type OpenCodeCommand = ReturnType<typeof commandForRun>
type SandboxedOpenCodeCommand = OpenCodeCommand & {
  command: string
  env: Record<string, string | undefined>
  providerProxyTokenTransport?:
    | "environment"
    | "fd3"
    | "windows_named_pipe"
  providerProxyTokenPath?: string
  sandbox: NonNullable<Extract<OpenCodeCommand, { command: string }>["sandbox"]>
}

function requireSandboxedCommand(
  command: OpenCodeCommand | null
): SandboxedOpenCodeCommand {
  expect(command).toBeTruthy()
  expect(command?.transport).not.toBe("http")
  expect(command?.transport).not.toBe("websocket")

  const stdioCommand = command as Extract<OpenCodeCommand, { command: string }>

  expect(stdioCommand.sandbox).toBeTruthy()
  return stdioCommand as SandboxedOpenCodeCommand
}

function runWithOpenCodeSandbox({
  args,
  command,
  rootDir,
  spec,
}: {
  args: string[]
  command: string
  rootDir: string
  spec: SandboxedOpenCodeCommand
}) {
  const child = spawnLocalSandboxedAcpProcess({
    additionalReadRoots: spec.sandbox.additionalReadRoots,
    allowedNetworkDomains: spec.sandbox.allowedNetworkDomains,
    allowedNetworkEndpoints: spec.sandbox.allowedNetworkEndpoints,
    args,
    command,
    env: spec.env,
    rootDir,
    runtimeStateRoot: spec.sandbox.runtimeStateRoot,
    sessionId: spec.sandbox.sessionId,
    stateRoot: spec.sandbox.stateRoot,
    providerProxyToken: "a".repeat(43),
    providerProxyTokenTransport: spec.providerProxyTokenTransport,
    providerProxyTokenPath: spec.providerProxyTokenPath,
  })

  return new Promise<{
    code: number | null
    signal: NodeJS.Signals | null
    stderr: string
    stdout: string
  }>((resolve, reject) => {
    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.once("error", reject)
    child.once("close", (code, signal) => {
      resolve({ code, signal, stderr, stdout })
    })
  })
}

test("OpenCode Local Default and legacy readonly are process-sandboxed", () => {
  const defaultCommand = requireSandboxedCommand(commandForRun("default"))
  const legacyReadonly = requireSandboxedCommand(
    commandForRun("legacy_readonly")
  )
  const fullAccess = commandForRun("full_access")
  const config = JSON.parse(defaultCommand.env.OPENCODE_CONFIG_CONTENT ?? "{}")

  expect(config.permission).toBe("allow")
  expect(defaultCommand.env.ASTRAFLOW_MODELVERSE_API_KEY).toBeUndefined()
  expect(defaultCommand.providerProxyTokenTransport).toBe("fd3")
  expect(defaultCommand.sandbox.kind).toBe("astraflow-local")
  expect(defaultCommand.sandbox.allowedNetworkDomains).toEqual([])
  expect(defaultCommand.sandbox.allowedNetworkEndpoints).toEqual([
    { host: "127.0.0.1", port: 3456 },
  ])
  expect(defaultCommand.sandbox.additionalReadRoots).toContain(
    dirname(nodeExecutable)
  )
  expect(
    defaultCommand.env.OPENCODE_DB?.startsWith(
      realpathSync.native(join(root, "sandbox-workspaces", "opencode-default"))
    )
  ).toBe(true)
  expect(legacyReadonly.sandbox.kind).toBe("astraflow-local")
  expect(fullAccess).toBeTruthy()
  expect(
    fullAccess?.transport !== "http" && fullAccess?.transport !== "websocket"
      ? fullAccess?.sandbox
      : null
  ).toBeUndefined()
})

test("Linux credential handoff stays in session TMPDIR instead of the user workspace", () => {
  const runnerSource = readFileSync(
    join(process.cwd(), "electron", "sandbox-command-runner.mjs"),
    "utf8"
  )

  expect(runnerSource).toContain("request.commandEnv.TMPDIR")
  expect(runnerSource).toContain("mkdtempSync")
  expect(runnerSource).toContain(
    'join(canonicalTransportDirectory, "credential.fifo")'
  )
  expect(runnerSource).not.toContain(
    "join(\n    request.cwd,\n    `.astraflow-provider-"
  )
})

const integrationTest =
  process.env.ASTRAFLOW_RUN_SANDBOX_INTEGRATION === "1" ? test : test.skip

integrationTest(
  "OpenCode's process sandbox preserves anonymous provider transport without exporting it",
  async () => {
    const workspaceRoot = join(root, "AstraFlow", "credential-transport")
    const commandSpec = requireSandboxedCommand(
      commandForRun("default", "opencode-credential-transport")
    )

    mkdirSync(workspaceRoot, { recursive: true })
    const result = await runWithOpenCodeSandbox({
      args: [
        "-e",
        [
          "const fs = require('node:fs')",
          "const credential = fs.readFileSync('/dev/fd/3', 'utf8')",
          "process.stdout.write(JSON.stringify({ credential, environmentCredential: process.env.ASTRAFLOW_MODELVERSE_API_KEY || null }))",
        ].join(";"),
      ],
      command: nodeExecutable,
      rootDir: workspaceRoot,
      spec: commandSpec,
    })

    if (result.code !== 0) {
      throw new Error(
        `Sandboxed credential transport probe failed (${result.code}):\n${result.stderr}`
      )
    }
    expect(JSON.parse(result.stdout)).toEqual({
      credential: "a".repeat(43),
      environmentCredential: null,
    })
    expect(
      readdirSync(workspaceRoot).some((name) =>
        name.startsWith(".astraflow-provider-")
      )
    ).toBe(false)
  },
  30_000
)

integrationTest(
  "OpenCode's process sandbox blocks Node and Python read/write bypasses",
  async () => {
    const workspaceRoot = join(root, "AstraFlow", "sandbox-bypass")
    const outsideReadPath = join(
      root,
      "AstraFlow",
      "sibling-workspace",
      "outside-secret.txt"
    )
    const outsideNodeWritePath = join(root, "outside-node-write.txt")
    const outsidePythonWritePath = join(root, "outside-python-write.txt")
    const nodeWorkspaceOutput = join(workspaceRoot, "node-output.txt")
    const pythonWorkspaceOutput = join(workspaceRoot, "python-output.txt")
    const commandSpec = requireSandboxedCommand(
      commandForRun("default", "opencode-bypass-session")
    )

    mkdirSync(dirname(outsideReadPath), { recursive: true })
    mkdirSync(workspaceRoot, { recursive: true })
    writeFileSync(outsideReadPath, "host-secret")

    const nodeScript = [
      "const fs = require('node:fs')",
      "const attempt = fn => { try { fn(); return true } catch { return false } }",
      `const readOutside = attempt(() => fs.readFileSync(${JSON.stringify(
        outsideReadPath
      )}, 'utf8'))`,
      `const writeOutside = attempt(() => fs.writeFileSync(${JSON.stringify(
        outsideNodeWritePath
      )}, 'escaped'))`,
      `fs.writeFileSync(${JSON.stringify(nodeWorkspaceOutput)}, 'node-ok')`,
      "process.stdout.write(JSON.stringify({ readOutside, writeOutside }))",
    ].join(";")
    const nodeResult = await runWithOpenCodeSandbox({
      args: ["-e", nodeScript],
      command: nodeExecutable,
      rootDir: workspaceRoot,
      spec: commandSpec,
    })

    if (nodeResult.code !== 0) {
      throw new Error(
        `Sandboxed Node bypass probe failed (${nodeResult.code}):\n${nodeResult.stderr}`
      )
    }
    expect(nodeResult.code).toBe(0)
    expect(JSON.parse(nodeResult.stdout)).toEqual({
      readOutside: false,
      writeOutside: false,
    })
    expect(existsSync(outsideNodeWritePath)).toBe(false)
    expect(readFileSync(nodeWorkspaceOutput, "utf8")).toBe("node-ok")

    const policy = createLocalSandboxPolicy({
      rootDir: workspaceRoot,
      sessionId: "opencode-python-probe",
    })
    const pythonExecutable = policy.commandEnv.ASTRAFLOW_PYTHON_EXECUTABLE
    const pythonScript = [
      "import json",
      "from pathlib import Path",
      "def attempt(operation):",
      "    try:",
      "        operation()",
      "        return True",
      "    except Exception:",
      "        return False",
      `read_outside = attempt(lambda: Path(${JSON.stringify(
        outsideReadPath
      )}).read_text())`,
      `write_outside = attempt(lambda: Path(${JSON.stringify(
        outsidePythonWritePath
      )}).write_text("escaped"))`,
      `Path(${JSON.stringify(pythonWorkspaceOutput)}).write_text("python-ok")`,
      "print(json.dumps({'readOutside': read_outside, 'writeOutside': write_outside}))",
    ].join("\n")
    const pythonResult = await runWithOpenCodeSandbox({
      args: ["-c", pythonScript],
      command: pythonExecutable,
      rootDir: workspaceRoot,
      spec: commandSpec,
    })

    if (pythonResult.code !== 0) {
      throw new Error(
        `Sandboxed Python bypass probe failed (${pythonResult.code}):\n${pythonResult.stderr}`
      )
    }
    expect(pythonResult.code).toBe(0)
    expect(JSON.parse(pythonResult.stdout)).toEqual({
      readOutside: false,
      writeOutside: false,
    })
    expect(existsSync(outsidePythonWritePath)).toBe(false)
    expect(readFileSync(pythonWorkspaceOutput, "utf8")).toBe("python-ok")
  },
  30_000
)
