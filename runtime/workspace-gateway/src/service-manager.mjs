import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import {
  access,
  mkdir,
  readFile,
  readlink,
  realpath,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises"
import http from "node:http"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"

import { resolveExistingWorkspacePath } from "./path-policy.mjs"

const DEFAULT_START_TIMEOUT_MS = 20_000
const DEFAULT_STOP_TIMEOUT_MS = 3_000
const DEFAULT_LOG_BYTES = 128 * 1024
const DEFAULT_PORT_ATTEMPTS = 4
const MAX_COMMAND_BYTES = 16 * 1024
const MAX_ENV_ENTRIES = 40
const MAX_RECENT_FAILURE_LOG_BYTES = 8 * 1024
const SERVICE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/
const SERVICE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SERVICE_OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const SENSITIVE_ENV_PATTERN =
  /(?:^|_)(?:API_?KEY|AUTH|BEARER|COOKIE|CREDENTIAL|PASSWORD|PRIVATE|PROXY|SECRET|TOKEN)(?:_|$)/i
const SERVICE_ENV_ALLOWLIST = new Set([
  "BROWSER",
  "CI",
  "DEBUG",
  "FLASK_DEBUG",
  "FLASK_ENV",
  "FORCE_COLOR",
  "HOST",
  "HOSTNAME",
  "NODE_ENV",
  "NO_COLOR",
  "PYTHONDONTWRITEBYTECODE",
  "PYTHONUNBUFFERED",
  "UVICORN_HOST",
])
const SERVICE_ENV_PUBLIC_PREFIXES = [
  "ASTRO_PUBLIC_",
  "NEXT_PUBLIC_",
  "PUBLIC_",
  "REACT_APP_",
  "VITE_",
]
const BACKGROUND_WRAPPER_PATTERN =
  /(?:^|[\s;&|])(?:daemonize|nohup|pm2|screen|setsid|tmux)(?=$|[\s;&|])/i
const SINGLE_AMPERSAND_PATTERN = /(?<![&>])&(?![&>])/

export const WORKSPACE_SERVICE_CAPABILITY = "service.lifecycle.v2"

function platformLifecycleContract(platform = process.platform) {
  if (platform === "win32") {
    return {
      supported: false,
      ownership: "unsupported",
      detachedDescendants: "unsupported",
      restartRecovery: "mark_failed_unowned",
      reason:
        "Workspace service lifecycle requires a Job Object supervisor on Windows.",
    }
  }

  return {
    supported: true,
    ownership: "process_group",
    detachedDescendants: "not_contained",
    restartRecovery: "mark_failed_unowned",
    reason: null,
  }
}

export function workspaceServiceLifecycleContract(
  platform = process.platform
) {
  return { ...platformLifecycleContract(platform) }
}

export class ServiceManagerError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = "ServiceManagerError"
    this.status = status
    this.code = code
  }
}

function serviceError(status, code, message) {
  return new ServiceManagerError(status, code, message)
}

function boundedText(value, field, maxBytes = MAX_COMMAND_BYTES) {
  const text = typeof value === "string" ? value.trim() : ""

  if (!text) {
    throw serviceError(400, "INVALID_SERVICE_SPEC", `${field} is required.`)
  }

  if (Buffer.byteLength(text) > maxBytes) {
    throw serviceError(
      400,
      "INVALID_SERVICE_SPEC",
      `${field} exceeds the maximum size.`
    )
  }

  return text
}

function normalizeName(value) {
  const name = boundedText(value, "name", 128)

  if (!SERVICE_NAME_PATTERN.test(name)) {
    throw serviceError(
      400,
      "INVALID_SERVICE_NAME",
      "Service name must use letters, numbers, dots, underscores, or dashes."
    )
  }

  return name
}

function normalizeOwnerSessionId(value) {
  const ownerSessionId = boundedText(value, "ownerSessionId", 256)

  if (!SERVICE_OWNER_PATTERN.test(ownerSessionId)) {
    throw serviceError(
      400,
      "INVALID_SERVICE_OWNER",
      "Service ownerSessionId is invalid."
    )
  }

  return ownerSessionId
}

function normalizeForegroundCommand(value) {
  const command = boundedText(value, "command")

  if (
    BACKGROUND_WRAPPER_PATTERN.test(command) ||
    SINGLE_AMPERSAND_PATTERN.test(command)
  ) {
    throw serviceError(
      400,
      "BACKGROUND_SERVICE_FORBIDDEN",
      "Service command must remain in the foreground; background wrappers and shell & are not allowed."
    )
  }

  return command
}

function normalizePort(value) {
  if (value === undefined || value === null || value === "") {
    return null
  }

  const port = Number(value)

  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw serviceError(
      400,
      "INVALID_SERVICE_PORT",
      "Service port must be an integer from 1024 through 65535."
    )
  }

  return port
}

function normalizeHealthPath(value) {
  if (value === undefined || value === null || value === "") {
    return null
  }

  const healthPath = String(value).trim()

  if (
    !healthPath.startsWith("/") ||
    healthPath.startsWith("//") ||
    healthPath.includes("\\") ||
    healthPath.length > 512
  ) {
    throw serviceError(
      400,
      "INVALID_HEALTH_PATH",
      "healthPath must be an absolute HTTP path."
    )
  }

  return healthPath
}

function sanitizeEnvironment(value) {
  if (value === undefined || value === null) {
    return {}
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw serviceError(
      400,
      "INVALID_SERVICE_ENV",
      "Service env must be an object."
    )
  }

  const entries = Object.entries(value)

  if (entries.length > MAX_ENV_ENTRIES) {
    throw serviceError(
      400,
      "INVALID_SERVICE_ENV",
      `Service env supports at most ${MAX_ENV_ENTRIES} entries.`
    )
  }

  const env = {}

  for (const [rawName, rawValue] of entries) {
    const name = rawName.trim()

    if (!ENV_NAME_PATTERN.test(name)) {
      throw serviceError(
        400,
        "INVALID_SERVICE_ENV",
        `Invalid environment variable name: ${rawName}`
      )
    }

    if (SENSITIVE_ENV_PATTERN.test(name)) {
      throw serviceError(
        400,
        "SENSITIVE_SERVICE_ENV",
        `Sensitive environment variable is not allowed: ${name}`
      )
    }

    if (
      !SERVICE_ENV_ALLOWLIST.has(name) &&
      !SERVICE_ENV_PUBLIC_PREFIXES.some((prefix) => name.startsWith(prefix))
    ) {
      throw serviceError(
        400,
        "SERVICE_ENV_NOT_ALLOWED",
        `Environment variable is not in the service allowlist: ${name}`
      )
    }

    if (typeof rawValue !== "string" || rawValue.length > 8_192) {
      throw serviceError(
        400,
        "INVALID_SERVICE_ENV",
        `Environment variable ${name} must be a bounded string.`
      )
    }

    env[name] = rawValue
  }

  return env
}

function normalizedSpecFingerprint(spec) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ownerSessionId: spec.ownerSessionId,
        command: spec.command,
        cwd: spec.cwd,
        requestedPort: spec.requestedPort,
        env: Object.fromEntries(
          Object.entries(spec.env).sort(([left], [right]) =>
            left.localeCompare(right)
          )
        ),
        healthPath: spec.healthPath,
        entryPath: spec.entryPath,
        specRevision: spec.specRevision,
      })
    )
    .digest("hex")
}

function artifactKey(workspaceId, ownerSessionId, entryPath) {
  if (!entryPath) {
    return null
  }

  return createHash("sha256")
    .update(`${workspaceId}\0${ownerSessionId}\0${entryPath}`)
    .digest("hex")
}

function ownerScopedKey(ownerSessionId, value) {
  return `${ownerSessionId}\0${value}`
}

function publicService(service) {
  const failed = service.status === "failed"

  return {
    schemaVersion: 1,
    serviceId: service.serviceId,
    ownerSessionId: service.ownerSessionId,
    name: service.name,
    status: service.status,
    port: service.port,
    cwd: service.cwd,
    pid: service.child?.pid ?? service.pid ?? null,
    healthPath: service.healthPath,
    logPath: service.logPath,
    entryPath: service.entryPath,
    artifactKey: service.artifactKey,
    specFingerprint: service.specFingerprint,
    specRevision: service.specRevision,
    startedAt: service.startedAt,
    stoppedAt: service.stoppedAt,
    failure: service.failure,
    failureCode: service.failureCode ?? null,
    recentLog: failed
      ? Buffer.from(service.log || "")
          .subarray(-MAX_RECENT_FAILURE_LOG_BYTES)
          .toString("utf8")
      : null,
    lifecycle: service.lifecycle,
    reconciledAt: service.reconciledAt ?? null,
  }
}

function safeManifest(service) {
  return {
    ...publicService(service),
    idempotencyKey: service.idempotencyKey,
    requestedPort: service.requestedPort,
  }
}

function appendLog(service, chunk, stream) {
  const text = chunk.toString("utf8")
  const line = `[${new Date().toISOString()}] [${stream}] ${text}`
  service.log = `${service.log}${line}`

  if (Buffer.byteLength(service.log) > service.maxLogBytes) {
    service.log = Buffer.from(service.log)
      .subarray(-service.maxLogBytes)
      .toString("utf8")
  }
}

async function reserveCandidatePort() {
  const server = net.createServer()

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  const port =
    typeof address === "object" && address ? Number(address.port) : null
  await new Promise((resolve) => server.close(resolve))

  if (!port) {
    throw serviceError(
      500,
      "PORT_ALLOCATION_FAILED",
      "Unable to allocate a service port."
    )
  }

  return port
}

async function detectLifecycleContract(platform = process.platform) {
  const contract = platformLifecycleContract(platform)

  if (!contract.supported) {
    return contract
  }

  try {
    if (platform === "linux") {
      await Promise.all([
        access("/proc/net/tcp"),
        access("/proc/self/fd"),
      ])
    } else if (platform === "darwin") {
      await access("/usr/sbin/lsof")
    }
  } catch {
    return {
      ...contract,
      supported: false,
      ownership: "unsupported",
      reason:
        platform === "linux"
          ? "Workspace service lifecycle requires readable procfs socket ownership metadata."
          : "Workspace service lifecycle requires the system lsof utility.",
    }
  }

  return contract
}

function parseProcNetListeners(contents, port) {
  const expectedPort = port.toString(16).toUpperCase().padStart(4, "0")
  const listeners = []

  for (const line of contents.split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/)

    if (fields.length < 10 || fields[3] !== "0A") {
      continue
    }

    const [address, encodedPort] = String(fields[1] || "").split(":")

    if (encodedPort !== expectedPort) {
      continue
    }

    const inode = fields[9]

    if (!/^\d+$/.test(inode || "")) {
      continue
    }

    listeners.push({
      inode,
      publiclyBound: /^0+$/.test(address || ""),
    })
  }

  return listeners
}

async function readLinuxProcessGroup(pid) {
  const stat = await readFile(`/proc/${pid}/stat`, "utf8")
  const closing = stat.lastIndexOf(")")

  if (closing < 0) {
    return null
  }

  const fields = stat.slice(closing + 1).trim().split(/\s+/)
  const processGroup = Number(fields[2])

  return Number.isInteger(processGroup) && processGroup > 0
    ? processGroup
    : null
}

async function linuxProcessGroupMembers(processGroup) {
  const entries = await readdir("/proc", { withFileTypes: true })
  const members = []

  await Promise.all(
    entries
      .filter(
        (entry) => entry.isDirectory() && /^[1-9]\d*$/.test(entry.name)
      )
      .map(async (entry) => {
        const pid = Number(entry.name)

        try {
          if ((await readLinuxProcessGroup(pid)) === processGroup) {
            members.push(pid)
          }
        } catch {
          // Processes can exit while procfs is being inspected.
        }
      })
  )

  return members
}

async function verifyLinuxListenerOwnership(service) {
  const [tcp4, tcp6] = await Promise.all([
    readFile("/proc/net/tcp", "utf8").catch(() => ""),
    readFile("/proc/net/tcp6", "utf8").catch(() => ""),
  ])
  const listeners = [
    ...parseProcNetListeners(tcp4, service.port),
    ...parseProcNetListeners(tcp6, service.port),
  ]

  if (listeners.length === 0) {
    return { found: false, owned: false, publiclyBound: false }
  }

  const expectedGroup = service.pid
  const members = await linuxProcessGroupMembers(expectedGroup)
  const ownedInodes = new Set()

  await Promise.all(
    members.map(async (pid) => {
      let descriptors

      try {
        descriptors = await readdir(`/proc/${pid}/fd`)
      } catch {
        return
      }

      await Promise.all(
        descriptors.map(async (descriptor) => {
          try {
            const target = await readlink(`/proc/${pid}/fd/${descriptor}`)
            const match = target.match(/^socket:\[(\d+)\]$/)

            if (match) {
              ownedInodes.add(match[1])
            }
          } catch {
            // File descriptors can close while procfs is being inspected.
          }
        })
      )
    })
  )
  const ownedListeners = listeners.filter((listener) =>
    ownedInodes.has(listener.inode)
  )

  return {
    found: true,
    owned: ownedListeners.length > 0,
    publiclyBound: ownedListeners.some((listener) => listener.publiclyBound),
  }
}

async function capturedCommand(command, args, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { PATH: process.env.PATH || "" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    const chunks = []
    let settled = false
    const settle = (error, output = "") => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      if (error) {
        reject(error)
      } else {
        resolve(output)
      }
    }
    const timeout = setTimeout(() => {
      child.kill("SIGKILL")
      settle(new Error(`${command} timed out.`))
    }, timeoutMs)

    child.stdout?.on("data", (chunk) => {
      if (Buffer.concat(chunks).length < 1024 * 1024) {
        chunks.push(Buffer.from(chunk))
      }
    })
    child.once("error", (error) => settle(error))
    child.once("close", (code) => {
      const output = Buffer.concat(chunks).toString("utf8")

      if (code === 0 || (code === 1 && output === "")) {
        settle(null, output)
      } else {
        settle(new Error(`${command} exited with code ${code}.`))
      }
    })
  })
}

function parseLsofListeners(output, expectedProcessGroup) {
  const listeners = []
  let record = null

  for (const line of output.split("\n")) {
    const field = line[0]
    const value = line.slice(1)

    if (field === "p") {
      if (record?.name) {
        listeners.push(record)
      }
      record = { pid: Number(value), processGroup: null, name: null }
    } else if (record && field === "g") {
      record.processGroup = Number(value)
    } else if (record && field === "n") {
      record.name = value
    }
  }

  if (record?.name) {
    listeners.push(record)
  }

  const owned = listeners.filter(
    (listener) => listener.processGroup === expectedProcessGroup
  )

  return {
    found: listeners.length > 0,
    owned: owned.length > 0,
    publiclyBound: owned.some((listener) => {
      const host = listener.name.slice(
        0,
        Math.max(listener.name.lastIndexOf(":"), 0)
      )
      return host === "*" || host === "0.0.0.0" || host === "[::]"
    }),
  }
}

async function verifyDarwinListenerOwnership(service) {
  const output = await capturedCommand("/usr/sbin/lsof", [
    "-nP",
    "-a",
    `-iTCP:${service.port}`,
    "-sTCP:LISTEN",
    "-FpgPn",
  ])

  return parseLsofListeners(output, service.pid)
}

async function verifyListenerOwnership(service) {
  if (!service.pid) {
    return { found: false, owned: false, publiclyBound: false }
  }

  if (process.platform === "linux") {
    return verifyLinuxListenerOwnership(service)
  }

  if (process.platform === "darwin") {
    return verifyDarwinListenerOwnership(service)
  }

  return { found: false, owned: false, publiclyBound: false }
}

async function probeTcp(port, signal) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port })
    const settle = (healthy) => {
      socket.destroy()
      signal?.removeEventListener("abort", abort)
      resolve(healthy)
    }
    const abort = () => settle(false)

    socket.setTimeout(750)
    socket.once("connect", () => settle(true))
    socket.once("timeout", () => settle(false))
    socket.once("error", () => settle(false))
    signal?.addEventListener("abort", abort, { once: true })
  })
}

async function probeHttp(port, healthPath, signal) {
  return new Promise((resolve) => {
    const request = http.get(
      {
        host: "127.0.0.1",
        port,
        path: healthPath,
        timeout: 1_000,
      },
      (response) => {
        response.resume()
        resolve(
          typeof response.statusCode === "number" &&
            response.statusCode >= 200 &&
            response.statusCode < 400
        )
      }
    )
    const fail = () => resolve(false)
    const abort = () => {
      request.destroy()
      resolve(false)
    }

    request.once("timeout", () => {
      request.destroy()
      fail()
    })
    request.once("error", fail)
    signal?.addEventListener("abort", abort, { once: true })
    request.once("close", () =>
      signal?.removeEventListener("abort", abort)
    )
  })
}

async function waitUntilHealthy(service, timeoutMs, signal) {
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    if (signal?.aborted) {
      return {
        healthy: false,
        failure: "Service start was cancelled.",
        failureCode: "SERVICE_START_CANCELLED",
      }
    }

    if (service.exit) {
      return {
        healthy: false,
        failure: `Service exited before becoming healthy (code ${service.exit.code ?? "null"}, signal ${service.exit.signal ?? "none"}).`,
        failureCode: "SERVICE_ROOT_EXITED",
      }
    }

    const healthy = service.healthPath
      ? await probeHttp(service.port, service.healthPath, signal)
      : await probeTcp(service.port, signal)

    if (healthy) {
      let identity

      try {
        identity = await verifyListenerOwnership(service)
      } catch (error) {
        return {
          healthy: false,
          failure: `Service listener ownership could not be verified: ${error instanceof Error ? error.message : String(error)}`,
          failureCode: "SERVICE_IDENTITY_UNAVAILABLE",
        }
      }

      if (identity.found && !identity.owned) {
        return {
          healthy: false,
          failure:
            "The health port is owned by a process outside the managed service process group.",
          failureCode: "SERVICE_PORT_OWNERSHIP_MISMATCH",
        }
      }

      if (identity.owned && !identity.publiclyBound) {
        return {
          healthy: false,
          failure:
            "The service listener must bind to 0.0.0.0 or :: so the Sandbox host can reach it.",
          failureCode: "SERVICE_NOT_PUBLICLY_BOUND",
        }
      }

      if (identity.owned && hasLiveChild(service)) {
        return {
          healthy: true,
          failure: null,
          failureCode: null,
        }
      }
    }

    await delay(200, undefined, { signal }).catch(() => undefined)
  }

  return {
    healthy: false,
    failure: `Service did not become healthy within ${timeoutMs}ms.`,
    failureCode: "SERVICE_HEALTH_TIMEOUT",
  }
}

async function waitForExit(service, timeoutMs) {
  if (!service.child || service.exit) {
    return
  }

  await Promise.race([
    new Promise((resolve) => service.child.once("close", resolve)),
    delay(timeoutMs),
  ])
}

function hasLiveChild(service) {
  return Boolean(
    service.child &&
      !service.exit &&
      service.child.exitCode === null &&
      service.child.signalCode === null
  )
}

function hasLiveProcessGroup(service) {
  if (
    process.platform === "win32" ||
    !service.ownedByInstance ||
    !service.pid
  ) {
    return false
  }

  try {
    process.kill(-service.pid, 0)
    return true
  } catch (error) {
    return error?.code !== "ESRCH"
  }
}

function hasLiveOwnership(service) {
  return hasLiveChild(service) || hasLiveProcessGroup(service)
}

function terminateChild(service, signal = "SIGTERM") {
  const child = service.child
  const pid = service.pid ?? child?.pid ?? null

  if (!pid && !child) {
    return
  }

  if (process.platform === "win32" && pid && signal === "SIGKILL") {
    try {
      const killer = spawn(
        "taskkill.exe",
        ["/pid", String(pid), "/t", "/f"],
        { stdio: "ignore", windowsHide: true }
      )
      killer.unref()
      return
    } catch {
      // Fall back to the direct child below.
    }
  }

  if (
    process.platform !== "win32" &&
    service.ownedByInstance &&
    pid
  ) {
    try {
      process.kill(-pid, signal)
      return
    } catch {
      // Fall back to the direct child below.
    }
  }

  if (!child) {
    return
  }

  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }

  child.kill(signal)
}

async function waitForOwnershipExit(service, timeoutMs) {
  const deadline = Date.now() + timeoutMs

  while (hasLiveOwnership(service) && Date.now() < deadline) {
    await delay(25)
  }
}

async function terminateAndReap(service, timeoutMs) {
  if (!hasLiveOwnership(service)) {
    return
  }

  terminateChild(service, "SIGTERM")
  await Promise.all([
    waitForExit(service, timeoutMs),
    waitForOwnershipExit(service, timeoutMs),
  ])

  // The shell can exit after forwarding TERM while a backgrounded or
  // signal-resistant descendant keeps the process group alive. Always attempt
  // a final tree/group reap; killing an already empty group is harmless.
  terminateChild(service, "SIGKILL")
  await Promise.all([
    waitForExit(service, 1_000),
    waitForOwnershipExit(service, 1_000),
  ])
}

export class ServiceManager {
  constructor({
    workspaceId,
    workspaceRoot,
    stateRoot,
    startTimeoutMs = DEFAULT_START_TIMEOUT_MS,
    stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
    maxLogBytes = DEFAULT_LOG_BYTES,
  }) {
    this.workspaceId = workspaceId
    this.workspaceRoot = workspaceRoot
    this.stateRoot =
      stateRoot ||
      path.join(
        process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"),
        "astraflow",
        "workspace-gateway",
        workspaceId,
        "services"
      )
    this.startTimeoutMs = startTimeoutMs
    this.stopTimeoutMs = stopTimeoutMs
    this.maxLogBytes = maxLogBytes
    this.services = new Map()
    this.idempotency = new Map()
    this.pendingIdempotency = new Map()
    this.startLocks = new Map()
    this.activeStarts = new Set()
    this.closing = false
    this.lifecycle = platformLifecycleContract()
  }

  releaseIdempotency(service) {
    if (!service) {
      return false
    }

    let changed = service.idempotencyKey !== null

    for (const [idempotencyKey, serviceId] of this.idempotency) {
      if (serviceId === service.serviceId) {
        this.idempotency.delete(idempotencyKey)
        changed = true
      }
    }

    service.idempotencyKey = null
    return changed
  }

  async initialize() {
    this.workspaceRoot = await realpath(this.workspaceRoot)
    this.lifecycle = await detectLifecycleContract()
    await mkdir(this.stateRoot, { recursive: true, mode: 0o700 })
    const entries = await readdir(this.stateRoot, { withFileTypes: true })
    const reconciled = []

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue
      }

      try {
        const manifest = JSON.parse(
          await readFile(path.join(this.stateRoot, entry.name), "utf8")
        )

        if (
          !SERVICE_ID_PATTERN.test(String(manifest.serviceId || "")) ||
          !SERVICE_OWNER_PATTERN.test(
            String(manifest.ownerSessionId || "")
          ) ||
          !SERVICE_NAME_PATTERN.test(String(manifest.name || "")) ||
          typeof manifest.startedAt !== "string"
        ) {
          continue
        }

        const logPath = path.join(
          this.stateRoot,
          `${manifest.serviceId}.log`
        )
        const persistedLog = await readFile(logPath, "utf8").catch(() => "")
        const service = {
          ...manifest,
          status:
            manifest.status === "stopped" ? "stopped" : "failed",
          failure:
            manifest.status === "stopped"
              ? manifest.failure ?? null
              : "Gateway restarted; previous process ownership could not be verified.",
          failureCode:
            manifest.status === "stopped"
              ? manifest.failureCode ?? null
              : "GATEWAY_RESTART_UNVERIFIED",
          child: null,
          exit: null,
          ownedByInstance: false,
          log: Buffer.from(persistedLog)
            .subarray(-this.maxLogBytes)
            .toString("utf8"),
          logPath,
          maxLogBytes: this.maxLogBytes,
          lifecycle: manifest.lifecycle || this.lifecycle,
          reconciledAt:
            manifest.status === "stopped"
              ? manifest.reconciledAt ?? null
              : new Date().toISOString(),
        }
        this.releaseIdempotency(service)
        this.services.set(service.serviceId, service)
        reconciled.push(service)
      } catch {
        // Ignore malformed stale manifests; a later cleanup can remove them.
      }
    }

    await Promise.allSettled(reconciled.map((service) => this.persist(service)))
  }

  isSupported() {
    return this.lifecycle.supported
  }

  capability() {
    return { ...this.lifecycle }
  }

  assertSupported() {
    if (!this.lifecycle.supported) {
      throw serviceError(
        501,
        "SERVICE_LIFECYCLE_UNSUPPORTED",
        this.lifecycle.reason ||
          "Workspace service lifecycle is unsupported on this platform."
      )
    }
  }

  list(ownerSessionId) {
    const owner = normalizeOwnerSessionId(ownerSessionId)

    return [...this.services.values()]
      .filter((service) => service.ownerSessionId === owner)
      .map(publicService)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
  }

  get(serviceId, ownerSessionId) {
    const owner = normalizeOwnerSessionId(ownerSessionId)
    const service = this.services.get(serviceId)

    if (!service || service.ownerSessionId !== owner) {
      throw serviceError(404, "SERVICE_NOT_FOUND", "Service was not found.")
    }

    return publicService(service)
  }

  logs(serviceId, ownerSessionId) {
    const owner = normalizeOwnerSessionId(ownerSessionId)
    const service = this.services.get(serviceId)

    if (!service || service.ownerSessionId !== owner) {
      throw serviceError(404, "SERVICE_NOT_FOUND", "Service was not found.")
    }

    return {
      serviceId,
      status: service.status,
      truncated: Buffer.byteLength(service.log) >= service.maxLogBytes,
      text: service.log,
    }
  }

  async persist(service) {
    const previous = service.persistPromise || Promise.resolve()
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.stateRoot, { recursive: true, mode: 0o700 })
        const target = path.join(
          this.stateRoot,
          `${service.serviceId}.json`
        )
        const temporary = `${target}.${randomUUID()}.tmp`
        const manifest = JSON.stringify(safeManifest(service), null, 2)

        await writeFile(temporary, manifest, { mode: 0o600 })
        await rename(temporary, target)
      })
    service.persistPromise = operation

    try {
      await operation
    } finally {
      if (service.persistPromise === operation) {
        service.persistPromise = null
      }
    }
  }

  async removeManifest(serviceId) {
    await unlink(path.join(this.stateRoot, `${serviceId}.json`)).catch(
      () => undefined
    )
  }

  async normalizeSpec(input) {
    const ownerSessionId = normalizeOwnerSessionId(input?.ownerSessionId)
    const name = normalizeName(input?.name)
    const command = normalizeForegroundCommand(input?.command)
    const requestedPort = normalizePort(input?.port)
    const env = sanitizeEnvironment(input?.env)
    const healthPath = normalizeHealthPath(
      input?.healthPath ?? input?.health_path
    )
    const cwdRequest =
      typeof input?.cwd === "string" && input.cwd.trim()
        ? input.cwd.trim()
        : ""
    const cwd = await resolveExistingWorkspacePath(
      this.workspaceRoot,
      cwdRequest,
      { kind: "directory" }
    )
    let entryPath = null

    if (typeof input?.entryPath === "string" && input.entryPath.trim()) {
      const entry = await resolveExistingWorkspacePath(
        this.workspaceRoot,
        input.entryPath.trim(),
        { allowRoot: false, kind: "file" }
      )
      entryPath = entry.relativePath
    }

    const spec = {
      ownerSessionId,
      name,
      command,
      requestedPort,
      env,
      healthPath,
      cwd: cwd.relativePath,
      absoluteCwd: cwd.absolutePath,
      entryPath,
      idempotencyKey: boundedText(
        input?.idempotencyKey,
        "idempotencyKey",
        256
      ),
      specRevision:
        typeof input?.specRevision === "string" && input.specRevision.trim()
          ? input.specRevision.trim().slice(0, 128)
          : null,
      replaceServiceId:
        typeof input?.replaceServiceId === "string" &&
        input.replaceServiceId.trim()
          ? input.replaceServiceId.trim()
          : null,
    }
    spec.specFingerprint = normalizedSpecFingerprint(spec)
    return spec
  }

  async start(input, { signal } = {}) {
    this.assertSupported()

    if (this.closing) {
      throw serviceError(
        503,
        "SERVICE_MANAGER_CLOSING",
        "Workspace service manager is shutting down."
      )
    }

    if (signal?.aborted) {
      throw serviceError(
        499,
        "SERVICE_START_CANCELLED",
        "Service start was cancelled before a process was created."
      )
    }

    const spec = await this.normalizeSpec(input)
    const idempotencyScope = ownerScopedKey(
      spec.ownerSessionId,
      spec.idempotencyKey
    )
    const priorId = this.idempotency.get(idempotencyScope)

    if (priorId) {
      const prior = this.services.get(priorId)

      if (prior && !["failed", "stopped"].includes(prior.status)) {
        return publicService(prior)
      }

      if (prior) {
        this.releaseIdempotency(prior)
        await this.persist(prior)
      } else {
        this.idempotency.delete(idempotencyScope)
      }
    }

    const pending = this.pendingIdempotency.get(idempotencyScope)

    if (pending) {
      return pending
    }

    const operation = this.startSpec(spec, signal)
    this.pendingIdempotency.set(idempotencyScope, operation)
    this.activeStarts.add(operation)

    try {
      return await operation
    } finally {
      if (
        this.pendingIdempotency.get(idempotencyScope) === operation
      ) {
        this.pendingIdempotency.delete(idempotencyScope)
      }
      this.activeStarts.delete(operation)
    }
  }

  async startSpec(spec, signal) {
    const startLockKey = ownerScopedKey(spec.ownerSessionId, spec.name)
    const previousLock =
      this.startLocks.get(startLockKey) || Promise.resolve()
    let release
    const currentLock = new Promise((resolve) => {
      release = resolve
    })
    this.startLocks.set(startLockKey, currentLock)
    await previousLock

    try {
      if (this.closing) {
        throw serviceError(
          503,
          "SERVICE_MANAGER_CLOSING",
          "Workspace service manager is shutting down."
        )
      }

      if (signal?.aborted) {
        throw serviceError(
          499,
          "SERVICE_START_CANCELLED",
          "Service start was cancelled before a process was created."
        )
      }

      const sameSpec = [...this.services.values()].find(
        (service) =>
          service.ownerSessionId === spec.ownerSessionId &&
          service.name === spec.name &&
          service.specFingerprint === spec.specFingerprint &&
          service.status === "healthy" &&
          hasLiveChild(service)
      )

      if (sameSpec) {
        const identity = await verifyListenerOwnership(sameSpec).catch(
          () => null
        )

        if (identity?.owned && identity.publiclyBound) {
          this.idempotency.set(
            ownerScopedKey(spec.ownerSessionId, spec.idempotencyKey),
            sameSpec.serviceId
          )
          return publicService(sameSpec)
        }

        sameSpec.status = "failed"
        sameSpec.failure =
          "Managed service listener ownership could not be revalidated."
        sameSpec.failureCode = "SERVICE_PORT_OWNERSHIP_MISMATCH"
        await terminateAndReap(sameSpec, this.stopTimeoutMs)
        if (hasLiveOwnership(sameSpec)) {
          sameSpec.failure = "Managed process group could not be reaped."
          sameSpec.failureCode = "SERVICE_REAP_FAILED"
        }
        this.releaseIdempotency(sameSpec)
        await this.persist(sameSpec)
      }

      const existing = [...this.services.values()].find(
        (service) =>
          service.ownerSessionId === spec.ownerSessionId &&
          service.name === spec.name &&
          !["failed", "stopped"].includes(service.status)
      )

      if (
        existing &&
        (!spec.replaceServiceId ||
          spec.replaceServiceId !== existing.serviceId)
      ) {
        throw serviceError(
          409,
          "SERVICE_REPLACE_REQUIRED",
          `Service ${spec.name} already exists with a different specification; pass replaceServiceId.`
        )
      }

      const attempts = spec.requestedPort ? 1 : DEFAULT_PORT_ATTEMPTS
      const deadline = Date.now() + this.startTimeoutMs
      let service = null

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (signal?.aborted || this.closing) {
          break
        }

        const remainingTimeoutMs = deadline - Date.now()

        if (remainingTimeoutMs <= 0) {
          break
        }

        const port = spec.requestedPort || (await reserveCandidatePort())

        if (spec.requestedPort && (await probeTcp(port))) {
          throw serviceError(
            409,
            "SERVICE_PORT_IN_USE",
            `Requested service port ${port} is already in use.`
          )
        }

        service = await this.spawn(
          spec,
          port,
          signal,
          remainingTimeoutMs
        )

        if (service.status === "healthy") {
          break
        }

        await waitForExit(service, this.stopTimeoutMs)

        const portCollision =
          service.failureCode === "SERVICE_PORT_OWNERSHIP_MISMATCH" ||
          /\bEADDRINUSE\b/.test(`${service.failure || ""}\n${service.log}`)

        if (
          spec.requestedPort ||
          signal?.aborted ||
          this.closing ||
          !portCollision
        ) {
          break
        }
      }

      if (!service) {
        if (signal?.aborted) {
          throw serviceError(
            499,
            "SERVICE_START_CANCELLED",
            "Service start was cancelled before a healthy process was delivered."
          )
        }

        if (this.closing) {
          throw serviceError(
            503,
            "SERVICE_MANAGER_CLOSING",
            "Workspace service manager is shutting down."
          )
        }

        throw serviceError(
          500,
          "SERVICE_START_FAILED",
          "Service failed before a process was created."
        )
      }

      if (service.status === "healthy") {
        this.idempotency.set(
          ownerScopedKey(spec.ownerSessionId, spec.idempotencyKey),
          service.serviceId
        )
      } else {
        this.releaseIdempotency(service)
      }
      await this.persist(service)

      if (service.status === "healthy" && existing) {
        let previousStop = null
        let previousStopError = null

        try {
          previousStop = await this.stop(existing.serviceId, {
            ownerSessionId: spec.ownerSessionId,
          })
        } catch (error) {
          previousStopError = error
        }

        if (previousStop?.status !== "stopped") {
          let replacementRollback = null
          let replacementRollbackError = null

          try {
            replacementRollback = await this.stop(service.serviceId, {
              ownerSessionId: spec.ownerSessionId,
            })
          } catch (error) {
            replacementRollbackError = error
          }

          const previousFailure =
            previousStop?.failureCode ||
            (previousStopError instanceof Error
              ? previousStopError.message
              : previousStopError
                ? String(previousStopError)
                : "previous service did not report stopped")
          const replacementUnresolved =
            replacementRollback?.status !== "stopped"
          const rollbackFailure =
            replacementRollback?.failureCode ||
            (replacementRollbackError instanceof Error
              ? replacementRollbackError.message
              : replacementRollbackError
                ? String(replacementRollbackError)
                : "replacement service did not report stopped")

          throw serviceError(
            502,
            "SERVICE_REPLACE_FAILED",
            replacementUnresolved
              ? `Previous service could not be stopped (${previousFailure}); the replacement also remains unresolved (${rollbackFailure}).`
              : `Previous service could not be stopped (${previousFailure}); the healthy replacement was rolled back.`
          )
        }
      }

      return publicService(service)
    } finally {
      release()
      if (this.startLocks.get(startLockKey) === currentLock) {
        this.startLocks.delete(startLockKey)
      }
    }
  }

  async spawn(spec, port, signal, timeoutMs = this.startTimeoutMs) {
    const serviceId = randomUUID()
    const logPath = path.join(this.stateRoot, `${serviceId}.log`)
    const serviceHome = path.join(this.stateRoot, "home", serviceId)
    const serviceTmp = path.join(serviceHome, "tmp")
    await mkdir(serviceTmp, { recursive: true, mode: 0o700 })

    if (this.closing) {
      throw serviceError(
        503,
        "SERVICE_MANAGER_CLOSING",
        "Workspace service manager is shutting down."
      )
    }

    const shell =
      process.platform === "win32"
        ? process.env.ComSpec || "cmd.exe"
        : "/bin/sh"
    const shellArgs =
      process.platform === "win32"
        ? ["/d", "/s", "/c", spec.command]
        : ["-lc", spec.command]
    const child = spawn(shell, shellArgs, {
      cwd: spec.absoluteCwd,
      detached: process.platform !== "win32",
      env: {
        PATH: process.env.PATH || "",
        HOME: serviceHome,
        TMPDIR: serviceTmp,
        LANG: process.env.LANG || "C.UTF-8",
        ...spec.env,
        PORT: String(port),
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    const service = {
      serviceId,
      ownerSessionId: spec.ownerSessionId,
      name: spec.name,
      status: "starting",
      port,
      requestedPort: spec.requestedPort,
      cwd: spec.cwd,
      child,
      pid: child.pid ?? null,
      healthPath: spec.healthPath,
      logPath,
      entryPath: spec.entryPath,
      artifactKey: artifactKey(
        this.workspaceId,
        spec.ownerSessionId,
        spec.entryPath
      ),
      specFingerprint: spec.specFingerprint,
      specRevision: spec.specRevision,
      idempotencyKey: spec.idempotencyKey,
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      failure: null,
      failureCode: null,
      exit: null,
      log: "",
      maxLogBytes: this.maxLogBytes,
      lifecycle: { ...this.lifecycle },
      reconciledAt: null,
      stopRequested: false,
      startAbortController: new AbortController(),
      ownedByInstance: true,
    }

    this.services.set(serviceId, service)
    const abortStart = () => service.startAbortController?.abort()
    signal?.addEventListener("abort", abortStart, { once: true })
    child.stdout?.on("data", (chunk) => appendLog(service, chunk, "stdout"))
    child.stderr?.on("data", (chunk) => appendLog(service, chunk, "stderr"))
    child.once("error", (error) => {
      service.failure = error.message
      service.failureCode = "SERVICE_SPAWN_ERROR"
    })
    child.once("close", (code, childSignal) => {
      service.exit = { code, signal: childSignal }
      if (
        !service.stopRequested &&
        !["stopped", "failed"].includes(service.status)
      ) {
        // A shell that backgrounds the real server can exit while leaving the
        // process group alive. Reap that group even though the direct child has
        // already closed.
        terminateChild(service, "SIGKILL")
        service.status = "failed"
        service.failure ||= `Service exited (code ${code ?? "null"}, signal ${childSignal ?? "none"}).`
        service.failureCode ||= "SERVICE_ROOT_EXITED"
        this.releaseIdempotency(service)
      }
      void Promise.allSettled([
        writeFile(service.logPath, service.log, { mode: 0o600 }),
        this.persist(service),
      ])
    })
    await this.persist(service)
    const health = await waitUntilHealthy(
      service,
      timeoutMs,
      service.startAbortController.signal
    )

    if (service.stopRequested) {
      service.status = "stopped"
      service.failure = null
      service.failureCode = null
    } else if (health.healthy) {
      // Give immediate bind failures (for example EADDRINUSE after the
      // preflight race window) a chance to close the spawned process before
      // publishing a trusted healthy URL.
      await delay(100, undefined, {
        signal: service.startAbortController.signal,
      }).catch(() => undefined)

      let settledIdentity = null

      if (!service.startAbortController.signal.aborted) {
        settledIdentity = await verifyListenerOwnership(service).catch(
          () => null
        )
      }

      if (service.stopRequested) {
        service.status = "stopped"
        service.failure = null
        service.failureCode = null
      } else if (service.startAbortController.signal.aborted) {
        service.status = "failed"
        service.failure = "Service start was cancelled."
        service.failureCode = "SERVICE_START_CANCELLED"
      } else if (service.exit || !hasLiveChild(service)) {
        service.status = "failed"
        service.failure ||= "Service exited while completing its health check."
        service.failureCode ||= "SERVICE_ROOT_EXITED"
      } else if (
        !settledIdentity?.owned ||
        !settledIdentity.publiclyBound
      ) {
        service.status = "failed"
        service.failure =
          "Service listener ownership changed while completing its health check."
        service.failureCode = "SERVICE_PORT_OWNERSHIP_MISMATCH"
      } else {
        service.status = "healthy"
      }
    } else {
      service.status = "failed"
      service.failure = health.failure
      service.failureCode = health.failureCode
    }

    if (service.status === "failed") {
      await terminateAndReap(service, this.stopTimeoutMs)

      if (hasLiveOwnership(service)) {
        service.failure ||= "Managed process group could not be reaped."
        service.failureCode = "SERVICE_REAP_FAILED"
      }
    }

    if (["failed", "stopped"].includes(service.status)) {
      this.releaseIdempotency(service)
    }

    signal?.removeEventListener("abort", abortStart)
    service.startAbortController = null
    await writeFile(logPath, service.log, { mode: 0o600 }).catch(
      () => undefined
    )
    await this.persist(service)
    return service
  }

  async stop(
    serviceId,
    { ownerSessionId, removeManifest = false } = {}
  ) {
    const owner = normalizeOwnerSessionId(ownerSessionId)
    const service = this.services.get(serviceId)

    if (!service || service.ownerSessionId !== owner) {
      throw serviceError(404, "SERVICE_NOT_FOUND", "Service was not found.")
    }

    if (service.stopPromise) {
      return service.stopPromise
    }

    if (service.status === "stopped") {
      if (this.releaseIdempotency(service)) {
        await this.persist(service)
      }
      return publicService(service)
    }

    if (
      !service.ownedByInstance &&
      service.failureCode === "GATEWAY_RESTART_UNVERIFIED"
    ) {
      if (this.releaseIdempotency(service)) {
        await this.persist(service)
      }
      return publicService(service)
    }

    const operation = (async () => {
      service.stopRequested = true
      service.startAbortController?.abort()
      await terminateAndReap(service, this.stopTimeoutMs)

      if (hasLiveOwnership(service)) {
        service.status = "failed"
        service.failure = "Managed process group could not be reaped."
        service.failureCode = "SERVICE_REAP_FAILED"
      } else {
        service.status = "stopped"
        service.stoppedAt ||= new Date().toISOString()
      }
      this.releaseIdempotency(service)
      service.child = null
      await writeFile(service.logPath, service.log, { mode: 0o600 }).catch(
        () => undefined
      )

      if (removeManifest) {
        await service.persistPromise?.catch(() => undefined)
        await this.removeManifest(serviceId)
      } else {
        await this.persist(service)
      }

      return publicService(service)
    })()
    service.stopPromise = operation

    try {
      return await operation
    } finally {
      service.stopPromise = null
    }
  }

  async closeAll() {
    this.closing = true

    for (const service of this.services.values()) {
      service.startAbortController?.abort()
    }

    const stopManagedServices = () =>
      Promise.allSettled(
        [...this.services.values()]
          .filter(
            (service) =>
              hasLiveOwnership(service) ||
              !["stopped", "failed"].includes(service.status)
          )
          .map((service) =>
            this.stop(service.serviceId, {
              ownerSessionId: service.ownerSessionId,
            })
          )
      )

    await stopManagedServices()
    await Promise.allSettled([...this.activeStarts])
    await stopManagedServices()
  }

  createLogStream(serviceId, ownerSessionId) {
    const owner = normalizeOwnerSessionId(ownerSessionId)
    const service = this.services.get(serviceId)

    if (!service || service.ownerSessionId !== owner) {
      throw serviceError(404, "SERVICE_NOT_FOUND", "Service was not found.")
    }

    return createReadStream(service.logPath)
  }
}
