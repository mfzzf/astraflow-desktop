import { spawn, spawnSync } from "node:child_process"

import {
  SandboxManager,
  SandboxRuntimeConfigSchema,
} from "@anthropic-ai/sandbox-runtime"

const MAX_REQUEST_BYTES = 2 * 1024 * 1024
const WINDOWS_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

let sandboxChild = null
let terminating = false
let nextNetworkPermissionRequestId = 0
const networkPermissionDecisions = new Map()
const networkPermissionRequests = new Map()
const pendingNetworkPermissions = new Map()

function writeSandboxError(error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[AstraFlow sandbox] ${message}\n`)
}

async function readRequest() {
  const chunks = []
  let totalBytes = 0

  for await (const chunk of process.stdin) {
    totalBytes += chunk.byteLength

    if (totalBytes > MAX_REQUEST_BYTES) {
      throw new Error("Sandbox command request is too large.")
    }

    chunks.push(chunk)
  }

  const raw = Buffer.concat(chunks).toString("utf8")
  const request = JSON.parse(raw)

  if (
    !request ||
    typeof request.command !== "string" ||
    !request.command.trim() ||
    typeof request.cwd !== "string" ||
    typeof request.shell !== "string" ||
    typeof request.commandEnv !== "object" ||
    request.commandEnv === null ||
    (request.networkPromptEnabled !== undefined &&
      typeof request.networkPromptEnabled !== "boolean")
  ) {
    throw new Error("Sandbox command request is invalid.")
  }

  return {
    command: request.command,
    commandEnv: Object.fromEntries(
      Object.entries(request.commandEnv).filter(
        ([key, value]) =>
          WINDOWS_ENV_NAME_PATTERN.test(key) && typeof value === "string"
      )
    ),
    config: SandboxRuntimeConfigSchema.parse(request.config),
    cwd: request.cwd,
    networkPromptEnabled: request.networkPromptEnabled === true,
    shell: request.shell,
  }
}

function getNetworkPermissionKey(host, port) {
  return JSON.stringify([host, port ?? null])
}

function settleNetworkPermission(requestId, allowed) {
  const pending = pendingNetworkPermissions.get(requestId)

  if (!pending) {
    return
  }

  pendingNetworkPermissions.delete(requestId)
  networkPermissionRequests.delete(pending.key)
  networkPermissionDecisions.set(pending.key, allowed)
  pending.resolve(allowed)
}

function denyPendingNetworkPermissions() {
  for (const requestId of pendingNetworkPermissions.keys()) {
    settleNetworkPermission(requestId, false)
  }
}

function requestNetworkPermission({ host, port }) {
  const key = getNetworkPermissionKey(host, port)

  if (networkPermissionDecisions.has(key)) {
    return Promise.resolve(networkPermissionDecisions.get(key) === true)
  }

  const existing = networkPermissionRequests.get(key)

  if (existing) {
    return existing
  }

  if (!process.connected || typeof process.send !== "function") {
    return Promise.resolve(false)
  }

  nextNetworkPermissionRequestId += 1
  const requestId = `network-${nextNetworkPermissionRequestId}`
  let resolveRequest = () => undefined
  const request = new Promise((resolve) => {
    resolveRequest = resolve
  })
  networkPermissionRequests.set(key, request)
  pendingNetworkPermissions.set(requestId, { key, resolve: resolveRequest })

  try {
    process.send(
      {
        type: "network_permission_request",
        requestId,
        host,
        ...(port === undefined ? {} : { port }),
      },
      (error) => {
        if (error) {
          settleNetworkPermission(requestId, false)
        }
      }
    )
  } catch {
    settleNetworkPermission(requestId, false)
  }

  return request
}

function addWindowsCommandEnvironment(argv, commandEnv) {
  if (process.platform !== "win32") {
    return argv
  }

  const commandSeparator = argv.indexOf("--")

  if (commandSeparator < 0) {
    throw new Error("Windows sandbox wrapper returned an invalid argv array.")
  }

  const overlay = Object.entries(commandEnv).flatMap(([key, value]) => [
    "--env",
    `${key}=${value}`,
  ])

  return [
    ...argv.slice(0, commandSeparator),
    ...overlay,
    ...argv.slice(commandSeparator),
  ]
}

function killSandboxTree(signal = "SIGTERM") {
  if (!sandboxChild?.pid) {
    return
  }

  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/pid", String(sandboxChild.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    })
    return
  }

  try {
    process.kill(-sandboxChild.pid, signal)
  } catch {
    try {
      sandboxChild.kill(signal)
    } catch {
      // The process already exited.
    }
  }
}

async function terminate(signal) {
  if (terminating) {
    return
  }

  terminating = true
  denyPendingNetworkPermissions()
  killSandboxTree(signal)

  try {
    SandboxManager.cleanupAfterCommand()
    await SandboxManager.reset()
  } catch {
    // The caller is already terminating the command; teardown is best-effort.
  }

  process.exit(signal === "SIGTERM" ? 143 : 130)
}

process.once("SIGTERM", () => void terminate("SIGTERM"))
process.once("SIGINT", () => void terminate("SIGINT"))
process.on("message", (message) => {
  if (message?.type === "terminate") {
    void terminate(message.signal === "SIGINT" ? "SIGINT" : "SIGTERM")
    return
  }

  if (
    message?.type === "network_permission_response" &&
    typeof message.requestId === "string" &&
    typeof message.allowed === "boolean"
  ) {
    settleNetworkPermission(message.requestId, message.allowed)
  }
})

async function run() {
  const request = await readRequest()

  await SandboxManager.initialize(
    request.config,
    request.networkPromptEnabled ? requestNetworkPermission : undefined,
    true
  )
  // Keep Sandbox Runtime's own bridge sockets under the host's short system
  // temp path. Session HOME/TMP overrides are applied only to the command;
  // long Application Support paths can exceed AF_UNIX's path-length limit.
  Object.assign(process.env, request.commandEnv)

  const wrapped = await SandboxManager.wrapWithSandboxArgv(
    request.command,
    request.shell,
    undefined,
    undefined,
    request.cwd
  )
  const argv = addWindowsCommandEnvironment(wrapped.argv, request.commandEnv)

  sandboxChild = spawn(argv[0], argv.slice(1), {
    cwd: request.cwd,
    detached: process.platform !== "win32",
    env: wrapped.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })

  sandboxChild.stdout.pipe(process.stdout)
  sandboxChild.stderr.pipe(process.stderr)

  const result = await new Promise((resolve, reject) => {
    sandboxChild.once("error", reject)
    sandboxChild.once("close", (code, signal) => resolve({ code, signal }))
  })

  const annotation = SandboxManager.annotateStderrWithSandboxFailures(
    request.command,
    ""
  ).trim()

  if (annotation) {
    process.stderr.write(`${annotation}\n`)
  }

  SandboxManager.cleanupAfterCommand()
  await SandboxManager.reset()

  if (result.signal) {
    process.exitCode = 1
  } else {
    process.exitCode = result.code ?? 1
  }

  process.disconnect?.()
}

try {
  await run()
} catch (error) {
  writeSandboxError(error)

  try {
    killSandboxTree("SIGKILL")
    SandboxManager.cleanupAfterCommand()
    await SandboxManager.reset()
  } catch {
    // Preserve the original fail-closed error.
  }

  process.exitCode = 126
  process.disconnect?.()
}
