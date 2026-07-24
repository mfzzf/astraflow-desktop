import { spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import {
  closeSync,
  constants,
  existsSync,
  mkdtempSync,
  openSync,
  realpathSync,
  rmSync,
  writeSync,
} from "node:fs"
import { createServer } from "node:net"
import { isAbsolute, join, relative } from "node:path"

import {
  getWindowsSandboxUserStatus,
  resolveSrtWin,
  SandboxManager,
  SandboxRuntimeConfigSchema,
} from "@anthropic-ai/sandbox-runtime"

import { acquireWindowsSandboxAncestorMetadataAccess } from "./windows-sandbox-ancestor-access.mjs"
import {
  createWindowsSandboxProfileCommand,
  WINDOWS_SANDBOX_PROFILE_ID_PATTERN,
} from "./windows-sandbox-profile.mjs"
import { runWithTransientWindowsSrtRetry } from "./windows-sandbox-retry.mjs"

const MAX_REQUEST_BYTES = 2 * 1024 * 1024
const START_REQUEST_TIMEOUT_MS = 15_000
const WINDOWS_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const LONG_LIVED_STDIO_MODE = "long_lived_stdio"
const ASTRAFLOW_MODELVERSE_API_KEY_ENV = "ASTRAFLOW_MODELVERSE_API_KEY"
const PROVIDER_PROXY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const PROVIDER_FIFO_READY_TIMEOUT_MS = 15_000
const WINDOWS_PROVIDER_PIPE_PREFIX = "\\\\.\\pipe\\astraflow-provider-"
const WINDOWS_PROVIDER_PIPE_TIMEOUT_MS = 30_000
const WINDOWS_ACP_TRANSPORT_TIMEOUT_MS = 60_000

let sandboxChild = null
let pendingProviderTransport = null
let pendingWindowsAncestorAccess = null
let pendingWindowsAcpTransport = null
let completed = false
let terminating = false

function writeSandboxError(error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[AstraFlow sandbox] ${message}\n`)
}

function releaseWindowsAncestorAccess() {
  const access = pendingWindowsAncestorAccess
  pendingWindowsAncestorAccess = null

  if (!access) {
    return
  }

  try {
    access.release()
  } catch (error) {
    writeSandboxError(
      new Error(
        `Windows sandbox ancestor ACL cleanup failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    )
  }
}

async function prepareWindowsAcpTransport(request) {
  if (process.platform !== "win32" || !request.longLivedStdio) {
    return null
  }

  const token = randomBytes(32).toString("hex")
  let connected = false
  let closed = false
  let socket = null
  let timeout = null
  let timeoutStarted = false
  const server = createServer((candidate) => {
    if (connected || closed) {
      candidate.destroy()
      return
    }

    let authorization = Buffer.alloc(0)
    const failCandidate = () => candidate.destroy()
    candidate.once("error", failCandidate)
    candidate.on("data", function authenticate(chunk) {
      authorization = Buffer.concat([authorization, chunk])
      if (authorization.length > 256) {
        failCandidate()
        return
      }
      const end = authorization.indexOf(0x0a)
      if (end < 0) {
        return
      }
      candidate.off("data", authenticate)
      const line = authorization.subarray(0, end).toString("ascii").trimEnd()
      if (line !== `ASTRAFLOW_ACP/1 ${token}`) {
        failCandidate()
        return
      }

      connected = true
      socket = candidate
      clearTimeout(timeout)
      candidate.off("error", failCandidate)
      candidate.on("error", close)
      const remainder = authorization.subarray(end + 1)
      if (remainder.length > 0) {
        candidate.unshift(remainder)
      }
      process.stdin.pipe(candidate)
      candidate.pipe(process.stdout, { end: false })
      if (server.listening) {
        server.close()
      }
    })
  })
  const close = () => {
    if (closed) {
      return
    }

    closed = true
    clearTimeout(timeout)
    if (socket) {
      process.stdin.unpipe(socket)
      socket.destroy()
      socket = null
    }
    if (server.listening) {
      server.close()
    }
  }
  const startTimeout = () => {
    if (connected || closed || timeoutStarted) {
      return
    }

    timeoutStarted = true
    timeout = setTimeout(() => {
      writeSandboxError(
        new Error("Timed out waiting for the sandboxed ACP transport.")
      )
      close()
    }, WINDOWS_ACP_TRANSPORT_TIMEOUT_MS)
  }

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  server.removeAllListeners("error")
  server.on("error", close)
  const address = server.address()
  if (!address || typeof address === "string") {
    close()
    throw new Error("The Windows sandbox ACP transport did not bind to TCP.")
  }
  const endpoint = { host: "127.0.0.1", port: address.port }
  request.allowedNetworkEndpoints.push(endpoint)
  // A fully offline policy represents "deny everything" as deniedDomains
  // ["*"], which is evaluated before the exact endpoint callback. Remove
  // only that catch-all for this private transport and let the callback keep
  // denying every endpoint except the random loopback bridge.
  request.config.network.deniedDomains =
    request.config.network.deniedDomains.filter((domain) => domain !== "*")
  request.config.network.strictAllowlist = false

  return { close, endpoint: { ...endpoint, token }, startTimeout }
}

function validateRequest(request) {
  const longLivedStdio = request?.mode === LONG_LIVED_STDIO_MODE
  const allowedNetworkEndpoints = request?.allowedNetworkEndpoints
  const providerCredentialPath = request?.providerCredentialPath
  const windowsCommand = request?.windowsCommand
  const windowsProfileId = request?.windowsProfileId
  const hasValidWindowsProviderPipe =
    typeof providerCredentialPath === "string" &&
    providerCredentialPath.startsWith(WINDOWS_PROVIDER_PIPE_PREFIX) &&
    /^[A-Za-z0-9._\\-]+$/.test(providerCredentialPath)

  if (
    !request ||
    typeof request.command !== "string" ||
    !request.command.trim() ||
    typeof request.cwd !== "string" ||
    typeof request.shell !== "string" ||
    typeof request.commandEnv !== "object" ||
    request.commandEnv === null ||
    (process.platform === "win32"
      ? typeof windowsProfileId !== "string" ||
        !WINDOWS_SANDBOX_PROFILE_ID_PATTERN.test(windowsProfileId) ||
        (longLivedStdio
          ? !windowsCommand ||
            typeof windowsCommand !== "object" ||
            typeof windowsCommand.executable !== "string" ||
            !isAbsolute(windowsCommand.executable) ||
            windowsCommand.executable.includes("\0") ||
            !Array.isArray(windowsCommand.args) ||
            !windowsCommand.args.every(
              (argument) =>
                typeof argument === "string" && !argument.includes("\0")
            )
          : windowsCommand !== undefined)
      : windowsProfileId !== undefined || windowsCommand !== undefined) ||
    (request.mode !== undefined && !longLivedStdio) ||
    (allowedNetworkEndpoints !== undefined &&
      (!Array.isArray(allowedNetworkEndpoints) ||
        !allowedNetworkEndpoints.every(
          (endpoint) =>
            endpoint &&
            typeof endpoint === "object" &&
            typeof endpoint.host === "string" &&
            endpoint.host.length > 0 &&
            !endpoint.host.includes("*") &&
            !/[\\/@\s\u0000-\u001f\u007f]/.test(endpoint.host) &&
            Number.isInteger(endpoint.port) &&
            endpoint.port > 0 &&
            endpoint.port <= 65_535
        ))) ||
    (request.sensitiveEnvNames !== undefined &&
      (!Array.isArray(request.sensitiveEnvNames) ||
        !request.sensitiveEnvNames.every(
          (name) =>
            typeof name === "string" && WINDOWS_ENV_NAME_PATTERN.test(name)
        ))) ||
    (request.providerCredential !== undefined &&
      (!longLivedStdio ||
        typeof request.providerCredential !== "string" ||
        !PROVIDER_PROXY_TOKEN_PATTERN.test(request.providerCredential) ||
        (process.platform === "win32"
          ? !hasValidWindowsProviderPipe
          : providerCredentialPath !== undefined))) ||
    (request.providerCredential === undefined &&
      providerCredentialPath !== undefined)
  ) {
    throw new Error("Sandbox command request is invalid.")
  }

  return {
    command: request.command,
    allowedNetworkEndpoints: [
      ...new Map(
        (allowedNetworkEndpoints || []).map((endpoint) => {
          const normalized = {
            host: endpoint.host
              .trim()
              .replace(/\.$/, "")
              .toLocaleLowerCase("en-US"),
            port: endpoint.port,
          }

          return [
            JSON.stringify([normalized.host, normalized.port]),
            normalized,
          ]
        })
      ).values(),
    ],
    commandEnv: Object.fromEntries(
      Object.entries(request.commandEnv).filter(
        ([key, value]) =>
          WINDOWS_ENV_NAME_PATTERN.test(key) && typeof value === "string"
      )
    ),
    config: SandboxRuntimeConfigSchema.parse(request.config),
    cwd: request.cwd,
    longLivedStdio,
    providerCredential: request.providerCredential,
    sensitiveEnvNames: [...new Set(request.sensitiveEnvNames || [])],
    shell: request.shell,
    windowsCommand:
      windowsCommand === undefined
        ? undefined
        : {
            args: [...windowsCommand.args],
            executable: windowsCommand.executable,
          },
    windowsProfileId,
  }
}

async function prepareWindowsProviderCredential(request) {
  if (process.platform !== "win32" || !request.providerCredential) {
    return null
  }

  const pipePath = request.providerCredentialPath
  const credential = request.providerCredential
  let consumed = false
  let closed = false
  let timeout
  const server = createServer((socket) => {
    socket.on("error", close)
    if (consumed) {
      socket.destroy()
      return
    }

    // OpenCode consumes the scoped proxy token once during configuration.
    // Closing the random endpoint prevents its later tool subprocesses from
    // reopening the credential transport.
    consumed = true
    socket.end(credential)
    close()
  })
  const close = () => {
    if (closed) {
      return
    }

    closed = true
    clearTimeout(timeout)
    if (server.listening) {
      server.close()
    }
  }

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(pipePath, resolve)
  })
  server.removeAllListeners("error")
  server.on("error", close)
  server.unref()
  timeout = setTimeout(close, WINDOWS_PROVIDER_PIPE_TIMEOUT_MS)
  request.providerCredential = undefined
  request.providerCredentialPath = undefined

  return { close }
}

async function readRequestFromStdin() {
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
  return validateRequest(JSON.parse(raw))
}

function readRequestFromIpc() {
  if (!process.connected) {
    throw new Error(
      "Long-lived sandbox runner requires a trusted parent IPC channel."
    )
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error("Timed out waiting for sandbox process bootstrap."))
    }, START_REQUEST_TIMEOUT_MS)
    const onDisconnect = () => {
      cleanup()
      reject(new Error("Sandbox parent disconnected before bootstrap."))
    }
    const onMessage = (message) => {
      if (message?.type !== "start") {
        return
      }

      cleanup()

      try {
        const bytes = Buffer.byteLength(JSON.stringify(message.request))

        if (bytes > MAX_REQUEST_BYTES) {
          throw new Error("Sandbox command request is too large.")
        }

        resolve(validateRequest(message.request))
      } catch (error) {
        reject(error)
      }
    }
    const cleanup = () => {
      clearTimeout(timeout)
      process.off("disconnect", onDisconnect)
      process.off("message", onMessage)
    }

    process.once("disconnect", onDisconnect)
    process.on("message", onMessage)
  })
}

function createNetworkPermissionCallback(request) {
  if (request.allowedNetworkEndpoints.length === 0) {
    return undefined
  }

  const allowedEndpoints = new Set(
    request.allowedNetworkEndpoints.map(({ host, port }) =>
      JSON.stringify([host, port])
    )
  )

  return ({ host, port }) => {
    const normalizedHost = host
      .trim()
      .replace(/\.$/, "")
      .toLocaleLowerCase("en-US")

    return Promise.resolve(
      allowedEndpoints.has(JSON.stringify([normalizedHost, port]))
    )
  }
}

function addWindowsCommandEnvironment(
  argv,
  commandEnv,
  maskedEnvironmentNames = new Set()
) {
  if (process.platform !== "win32") {
    return argv
  }

  const commandSeparator = argv.indexOf("--")

  if (commandSeparator < 0) {
    throw new Error("Windows sandbox wrapper returned an invalid argv array.")
  }

  const overlay = Object.entries(commandEnv)
    .filter(([key]) => !maskedEnvironmentNames.has(key))
    .flatMap(([key, value]) => ["--env", `${key}=${value}`])

  return [
    ...argv.slice(0, commandSeparator),
    ...overlay,
    ...argv.slice(commandSeparator),
  ]
}

function quotePosixArgument(value) {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`
}

function isSameOrDescendant(parent, child) {
  const pathFromParent = relative(parent, child)

  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent))
  )
}

function isInsideConfiguredRoot(path, roots) {
  return roots.some((root) => {
    if (typeof root !== "string" || !isAbsolute(root)) {
      return false
    }

    try {
      return isSameOrDescendant(realpathSync(root), path)
    } catch {
      return false
    }
  })
}

function prepareLinuxProviderCredential(request) {
  if (process.platform !== "linux" || !request.providerCredential) {
    return null
  }

  // Bubblewrap closes inherited descriptors. Stage the short-lived proxy
  // token through a FIFO in the session-private sandbox TMPDIR instead. The
  // trusted bootstrap shell opens it as fd 3 and unlinks it before exec, so
  // neither the user workspace nor a later model-controlled child can reopen
  // the credential path.
  const mkfifoPath = ["/usr/bin/mkfifo", "/bin/mkfifo"].find(existsSync)

  if (!mkfifoPath) {
    throw new Error(
      "Anonymous provider credential transport requires mkfifo on Linux."
    )
  }

  const configuredTempRoot = request.commandEnv.TMPDIR

  if (
    typeof configuredTempRoot !== "string" ||
    !isAbsolute(configuredTempRoot)
  ) {
    throw new Error(
      "Anonymous provider credential transport requires an absolute session TMPDIR."
    )
  }

  const tempRoot = realpathSync(configuredTempRoot)

  if (
    !isInsideConfiguredRoot(
      tempRoot,
      request.config.filesystem.allowRead ?? []
    ) ||
    !isInsideConfiguredRoot(tempRoot, request.config.filesystem.allowWrite)
  ) {
    throw new Error(
      "Anonymous provider credential transport requires a sandbox-readable and writable session TMPDIR."
    )
  }

  const transportDirectory = mkdtempSync(
    join(tempRoot, `.astraflow-provider-${randomBytes(8).toString("hex")}-`)
  )
  const canonicalTransportDirectory = realpathSync(transportDirectory)

  if (!isSameOrDescendant(tempRoot, canonicalTransportDirectory)) {
    rmSync(transportDirectory, { force: true, recursive: true })
    throw new Error(
      "Anonymous provider credential transport escaped the session TMPDIR."
    )
  }

  const fifoPath = join(canonicalTransportDirectory, "credential.fifo")
  const createResult = spawnSync(mkfifoPath, ["-m", "600", fifoPath], {
    cwd: canonicalTransportDirectory,
    env: { PATH: "/usr/bin:/bin" },
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  })

  if (createResult.status !== 0) {
    rmSync(canonicalTransportDirectory, { force: true, recursive: true })
    throw new Error("Anonymous provider credential FIFO creation failed.")
  }

  let descriptor

  try {
    descriptor = openSync(
      fifoPath,
      constants.O_RDWR | constants.O_NONBLOCK
    )
    writeSync(descriptor, request.providerCredential)
  } catch (error) {
    if (descriptor !== undefined) {
      closeSync(descriptor)
    }
    rmSync(canonicalTransportDirectory, { force: true, recursive: true })
    throw error
  }

  const quotedPath = quotePosixArgument(fifoPath)
  request.command = [
    `exec 3<${quotedPath} || exit 126`,
    `/bin/rm -f -- ${quotedPath} || exit 126`,
    `exec ${request.command}`,
  ].join("\n")
  request.providerCredential = undefined

  return {
    close() {
      if (descriptor !== undefined) {
        closeSync(descriptor)
        descriptor = undefined
      }
      rmSync(canonicalTransportDirectory, {
        force: true,
        recursive: true,
      })
    },
    fifoPath,
  }
}

async function waitForLinuxProviderCredentialReady(
  transport,
  childResultState
) {
  const startedAt = Date.now()

  while (existsSync(transport.fifoPath)) {
    if (childResultState.settled) {
      throw (
        childResultState.error ??
        new Error(
          "Sandboxed Agent exited before consuming its provider credential."
        )
      )
    }

    if (Date.now() - startedAt >= PROVIDER_FIFO_READY_TIMEOUT_MS) {
      throw new Error(
        "Timed out waiting for the sandboxed Agent to consume its provider credential."
      )
    }

    await new Promise((resolve) => setTimeout(resolve, 10))
  }
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
  pendingProviderTransport?.close()
  pendingProviderTransport = null
  pendingWindowsAcpTransport?.close()
  pendingWindowsAcpTransport = null
  killSandboxTree(signal)

  try {
    SandboxManager.cleanupAfterCommand()
    try {
      await SandboxManager.reset()
    } finally {
      releaseWindowsAncestorAccess()
    }
  } catch {
    // The caller is already terminating the command; teardown is best-effort.
  }

  process.exit(signal === "SIGTERM" ? 143 : 130)
}

process.once("SIGTERM", () => void terminate("SIGTERM"))
process.once("SIGINT", () => void terminate("SIGINT"))
process.once("disconnect", () => {
  if (!completed) {
    void terminate("SIGTERM")
  }
})
process.on("message", (message) => {
  if (message?.type === "terminate") {
    void terminate(message.signal === "SIGINT" ? "SIGINT" : "SIGTERM")
  }
})

async function run() {
  const request = process.argv.includes("--long-lived-stdio")
    ? await readRequestFromIpc()
    : await readRequestFromStdin()

  if (process.argv.includes("--long-lived-stdio") !== request.longLivedStdio) {
    throw new Error("Sandbox runner mode does not match its bootstrap request.")
  }

  const maskedEnvironmentNames = new Set(
    (request.config.credentials?.envVars || [])
      .filter((entry) => entry.mode === "mask")
      .map((entry) => entry.name)
  )

  const providerCredential =
    request.commandEnv[ASTRAFLOW_MODELVERSE_API_KEY_ENV]

  if (
    request.longLivedStdio &&
    providerCredential !== undefined &&
    !maskedEnvironmentNames.has(ASTRAFLOW_MODELVERSE_API_KEY_ENV) &&
    !PROVIDER_PROXY_TOKEN_PATTERN.test(providerCredential)
  ) {
    throw new Error(
      "Long-lived sandbox startup requires a Desktop-scoped provider credential."
    )
  }

  // Credential masking must see the real host values while it initializes.
  // Do not apply HOME/TMP yet: Sandbox Runtime's bridge sockets need the
  // host's short system temp path.
  for (const name of maskedEnvironmentNames) {
    const value = request.commandEnv[name]

    if (value !== undefined) {
      process.env[name] = value
    }
  }
  const windowsAcpTransport = await prepareWindowsAcpTransport(request)
  pendingWindowsAcpTransport = windowsAcpTransport
  let windowsSandboxUser = null
  if (process.platform === "win32") {
    windowsSandboxUser = await runWithTransientWindowsSrtRetry(() =>
      getWindowsSandboxUserStatus({
        srtWin: resolveSrtWin(request.config.windows?.srtWin),
      })
    )
    if (!windowsSandboxUser.provisioned || !windowsSandboxUser.sid) {
      throw new Error(
        "The dedicated Windows sandbox user is unavailable before initialization."
      )
    }
  }
  await runWithTransientWindowsSrtRetry(
    () =>
      SandboxManager.initialize(
        request.config,
        createNetworkPermissionCallback(request),
        true
      ),
    {
      beforeRetry: () => SandboxManager.reset(),
    }
  )
  if (windowsSandboxUser) {
    pendingWindowsAncestorAccess =
      acquireWindowsSandboxAncestorMetadataAccess({
        paths: [
          request.cwd,
          ...(request.config.filesystem?.allowRead || []),
          ...(request.config.filesystem?.allowWrite || []),
        ],
        sandboxUserSid: windowsSandboxUser.sid,
      })
    if (pendingWindowsAncestorAccess && process.env.SRT_DEBUG === "1") {
      process.stderr.write(
        `[AstraFlow sandbox] Granted metadata-only access to ${pendingWindowsAncestorAccess.paths.length} protected workspace ancestor(s).\n`
      )
    }
  }
  // Keep Sandbox Runtime's own bridge sockets and Windows state database on
  // the real user's host profile. On Windows, commandEnv is injected later
  // through srt-win's explicit --env overlay; applying APPDATA/LOCALAPPDATA
  // to the broker would make it look for provisioning state inside the
  // isolated Agent profile. POSIX still needs the command environment on the
  // process before Sandbox Runtime builds its wrapped spawn environment.
  if (process.platform !== "win32") {
    Object.assign(process.env, request.commandEnv)
  }
  const windowsProviderTransport =
    await prepareWindowsProviderCredential(request)
  const linuxProviderTransport = prepareLinuxProviderCredential(request)
  pendingProviderTransport =
    windowsProviderTransport ?? linuxProviderTransport
  const sandboxCommand =
    process.platform === "win32"
      ? createWindowsSandboxProfileCommand(
          request.command,
          request.windowsProfileId,
          process.execPath,
          windowsAcpTransport?.endpoint,
          request.windowsCommand
        )
      : request.command
  const wrapped = await SandboxManager.wrapWithSandboxArgv(
    sandboxCommand,
    request.shell,
    undefined,
    undefined,
    request.cwd
  )
  const argv = addWindowsCommandEnvironment(
    wrapped.argv,
    request.commandEnv,
    maskedEnvironmentNames
  )

  sandboxChild = spawn(argv[0], argv.slice(1), {
    cwd: request.cwd,
    detached: process.platform !== "win32",
    env: wrapped.env,
    shell: false,
    stdio: [
      request.longLivedStdio ? "pipe" : "ignore",
      "pipe",
      "pipe",
      ...(request.providerCredential ? ["pipe"] : []),
    ],
    windowsHide: true,
  })

  const childResultState = {
    error: null,
    settled: false,
  }
  sandboxChild.once("exit", (code, signal) => {
    if (
      signal ||
      (code ?? 1) !== 0 ||
      process.env.SRT_DEBUG === "1"
    ) {
      process.stderr.write(
        `[AstraFlow sandbox] Command exit observed: code=${code ?? "null"} signal=${signal ?? "null"}\n`
      )
    }
  })
  const resultPromise = new Promise((resolve, reject) => {
    sandboxChild.once("error", reject)
    sandboxChild.once("close", (code, signal) => resolve({ code, signal }))
  })
  void resultPromise.then(
    () => {
      childResultState.settled = true
      windowsProviderTransport?.close()
      pendingWindowsAcpTransport?.close()
      pendingWindowsAcpTransport = null
    },
    (error) => {
      childResultState.error = error
      childResultState.settled = true
      windowsProviderTransport?.close()
      pendingWindowsAcpTransport?.close()
      pendingWindowsAcpTransport = null
    }
  )
  windowsAcpTransport?.startTimeout()

  if (request.providerCredential) {
    const credentialPipe = sandboxChild.stdio[3]

    if (!credentialPipe) {
      throw new Error(
        "Anonymous provider credential transport was not initialized."
      )
    }

    credentialPipe.end(request.providerCredential)
    request.providerCredential = undefined
  }

  if (linuxProviderTransport) {
    try {
      await waitForLinuxProviderCredentialReady(
        linuxProviderTransport,
        childResultState
      )
    } finally {
      linuxProviderTransport.close()
      pendingProviderTransport = null
    }
  }

  for (const name of request.sensitiveEnvNames) {
    delete process.env[name]
    delete request.commandEnv[name]
  }

  if (request.longLivedStdio && !windowsAcpTransport) {
    process.stdin.pipe(sandboxChild.stdin)
  }
  // Keep the runner's protocol and diagnostic streams open until the child
  // result has been observed and sandbox cleanup has completed. Letting
  // pipe() end these destinations races ACP's "connection closed" error
  // against the child's exit diagnostic and hides the actual startup cause.
  sandboxChild.stdout.pipe(process.stdout, { end: false })
  sandboxChild.stderr.pipe(process.stderr, { end: false })

  const result = await resultPromise

  const annotation = SandboxManager.annotateStderrWithSandboxFailures(
    request.command,
    ""
  ).trim()

  if (annotation) {
    process.stderr.write(`${annotation}\n`)
  }

  SandboxManager.cleanupAfterCommand()
  try {
    await SandboxManager.reset()
  } finally {
    releaseWindowsAncestorAccess()
  }
  completed = true

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
  pendingProviderTransport?.close()
  pendingProviderTransport = null
  pendingWindowsAcpTransport?.close()
  pendingWindowsAcpTransport = null

  try {
    killSandboxTree("SIGKILL")
    SandboxManager.cleanupAfterCommand()
    try {
      await SandboxManager.reset()
    } finally {
      releaseWindowsAncestorAccess()
    }
  } catch {
    // Preserve the original fail-closed error.
  }

  completed = true
  process.exitCode = 126
  process.disconnect?.()
}
