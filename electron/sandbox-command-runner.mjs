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
import { isAbsolute, join, relative } from "node:path"

import {
  SandboxManager,
  SandboxRuntimeConfigSchema,
} from "@anthropic-ai/sandbox-runtime"

const MAX_REQUEST_BYTES = 2 * 1024 * 1024
const START_REQUEST_TIMEOUT_MS = 15_000
const WINDOWS_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const LONG_LIVED_STDIO_MODE = "long_lived_stdio"
const ASTRAFLOW_MODELVERSE_API_KEY_ENV = "ASTRAFLOW_MODELVERSE_API_KEY"
const PROVIDER_PROXY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const PROVIDER_FIFO_READY_TIMEOUT_MS = 15_000

let sandboxChild = null
let pendingProviderTransport = null
let completed = false
let terminating = false

function writeSandboxError(error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[AstraFlow sandbox] ${message}\n`)
}

function validateRequest(request) {
  const longLivedStdio = request?.mode === LONG_LIVED_STDIO_MODE
  const allowedNetworkEndpoints = request?.allowedNetworkEndpoints

  if (
    !request ||
    typeof request.command !== "string" ||
    !request.command.trim() ||
    typeof request.cwd !== "string" ||
    typeof request.shell !== "string" ||
    typeof request.commandEnv !== "object" ||
    request.commandEnv === null ||
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
        process.platform === "win32" ||
        typeof request.providerCredential !== "string" ||
        !PROVIDER_PROXY_TOKEN_PATTERN.test(request.providerCredential)))
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
  }
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
  await SandboxManager.initialize(
    request.config,
    createNetworkPermissionCallback(request),
    true
  )
  // Keep Sandbox Runtime's own bridge sockets under the host's short system
  // temp path. Session HOME/TMP overrides are applied only to the command;
  // long Application Support paths can exceed AF_UNIX's path-length limit.
  Object.assign(process.env, request.commandEnv)
  const linuxProviderTransport = prepareLinuxProviderCredential(request)
  pendingProviderTransport = linuxProviderTransport
  const wrapped = await SandboxManager.wrapWithSandboxArgv(
    request.command,
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
  const resultPromise = new Promise((resolve, reject) => {
    sandboxChild.once("error", reject)
    sandboxChild.once("close", (code, signal) => resolve({ code, signal }))
  })
  void resultPromise.then(
    () => {
      childResultState.settled = true
    },
    (error) => {
      childResultState.error = error
      childResultState.settled = true
    }
  )

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

  if (request.longLivedStdio) {
    process.stdin.pipe(sandboxChild.stdin)
  }
  sandboxChild.stdout.pipe(process.stdout)
  sandboxChild.stderr.pipe(process.stderr)

  const result = await resultPromise

  const annotation = SandboxManager.annotateStderrWithSandboxFailures(
    request.command,
    ""
  ).trim()

  if (annotation) {
    process.stderr.write(`${annotation}\n`)
  }

  SandboxManager.cleanupAfterCommand()
  await SandboxManager.reset()
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

  try {
    killSandboxTree("SIGKILL")
    SandboxManager.cleanupAfterCommand()
    await SandboxManager.reset()
  } catch {
    // Preserve the original fail-closed error.
  }

  completed = true
  process.exitCode = 126
  process.disconnect?.()
}
