/* eslint-disable @typescript-eslint/no-require-imports */

const { createHash } = require("node:crypto")
const { spawn } = require("node:child_process")
const {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("node:fs")
const {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} = require("node:path")
const { Readable, Transform } = require("node:stream")
const { pipeline } = require("node:stream/promises")
const { createBrotliDecompress } = require("node:zlib")
const { x: extractTar } = require("tar")

const CATALOG_FILE = "runtime-catalog.json"
const INSTALL_MARKER = ".astraflow-developer-runtime.json"
const RUNTIME_IDS = ["python", "node"]
const SHA256_PATTERN = /^[0-9a-f]{64}$/i
const DOWNLOAD_EVENT_INTERVAL_MS = 100
const INSTALL_LOCK_STALE_MS = 30 * 60 * 1000
const HEALTH_CHECK_TIMEOUT_MS = 15_000
const HEALTH_CHECK_OUTPUT_LIMIT = 64 * 1024

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

function isInside(parent, candidate) {
  const value = relative(parent, candidate)

  return (
    value !== "" &&
    value !== ".." &&
    !value.startsWith(`..${sep}`) &&
    !isAbsolute(value)
  )
}

function resolveInside(parent, relativePath, label) {
  if (
    typeof relativePath !== "string" ||
    !relativePath.trim() ||
    relativePath.includes("\0") ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Invalid ${label} path in developer runtime metadata.`)
  }

  const candidate = resolve(parent, relativePath)

  if (!isInside(parent, candidate)) {
    throw new Error(`${label} escapes the developer runtime directory.`)
  }

  return candidate
}

function normalizeCommands(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} does not declare runtime commands.`)
  }

  const commands = {}

  for (const [name, relativePath] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      throw new Error(`${label} declares an invalid command name.`)
    }

    if (
      typeof relativePath !== "string" ||
      !relativePath.trim() ||
      isAbsolute(relativePath) ||
      relativePath.includes("\0")
    ) {
      throw new Error(`${label} declares an invalid ${name} command path.`)
    }

    commands[name] = relativePath
  }

  if (!Object.keys(commands).length) {
    throw new Error(`${label} does not declare runtime commands.`)
  }

  return commands
}

function normalizeCatalog(value, runtimeTarget) {
  if (
    value?.schemaVersion !== 1 ||
    value?.target !== runtimeTarget ||
    typeof value?.downloadBaseUrl !== "string" ||
    !value.downloadBaseUrl.startsWith("https://")
  ) {
    throw new Error(`Invalid developer runtime catalog for ${runtimeTarget}.`)
  }

  const runtimes = {}

  for (const runtimeId of RUNTIME_IDS) {
    const runtime = value.runtimes?.[runtimeId]

    if (
      runtime?.id !== runtimeId ||
      typeof runtime?.label !== "string" ||
      !runtime.label.trim() ||
      typeof runtime?.version !== "string" ||
      !runtime.version.match(/^[0-9A-Za-z][0-9A-Za-z.+-]*$/)
    ) {
      throw new Error(`Developer runtime catalog is missing ${runtimeId}.`)
    }

    runtimes[runtimeId] = {
      id: runtimeId,
      label: runtime.label.trim(),
      version: runtime.version,
      packageManagerVersion:
        typeof runtime.packageManagerVersion === "string"
          ? runtime.packageManagerVersion
          : null,
      commands: normalizeCommands(runtime.commands, runtime.label),
    }
  }

  return {
    target: runtimeTarget,
    downloadBaseUrl: value.downloadBaseUrl.replace(/\/+$/, ""),
    runtimes,
  }
}

function normalizeManifest(value, runtime, runtimeTarget) {
  if (
    value?.schemaVersion !== 1 ||
    value?.runtimeId !== runtime.id ||
    value?.version !== runtime.version ||
    value?.target !== runtimeTarget ||
    typeof value?.archive !== "string" ||
    value.archive !== basename(value.archive) ||
    !value.archive.endsWith(".tar.br") ||
    !SHA256_PATTERN.test(value?.archiveSha256 ?? "") ||
    !Number.isSafeInteger(value?.archiveSize) ||
    value.archiveSize <= 0
  ) {
    throw new Error(`Invalid ${runtime.label} manifest for ${runtimeTarget}.`)
  }

  const commands = {}

  for (const [name, relativePath] of Object.entries(runtime.commands)) {
    const command = value.commands?.[name]

    if (
      command?.relativePath !== relativePath ||
      !SHA256_PATTERN.test(command?.sha256 ?? "")
    ) {
      throw new Error(`Invalid ${runtime.label} ${name} command metadata.`)
    }

    commands[name] = {
      relativePath,
      sha256: command.sha256.toLowerCase(),
    }
  }

  return {
    archive: value.archive,
    archiveSha256: value.archiveSha256.toLowerCase(),
    archiveSize: value.archiveSize,
    commands,
  }
}

function sha256File(path) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256")
    const stream = createReadStream(path)

    stream.on("data", (chunk) => hash.update(chunk))
    stream.once("error", rejectHash)
    stream.once("end", () => resolveHash(hash.digest("hex")))
  })
}

function safeDirectoryName(value) {
  return value.replace(/[^0-9A-Za-z._-]/g, "_")
}

function createDeveloperRuntimeEnvironmentManager({
  appRoot,
  userDataPath,
  platform = process.platform,
  arch = process.arch,
  processEnv = process.env,
  fetchImpl = globalThis.fetch,
  developmentRuntimes = null,
  onStatusChanged,
}) {
  const runtimeTarget = `${platform}-${arch}`
  const catalogPath = join(
    appRoot,
    "runtime",
    "developer-runtimes",
    CATALOG_FILE
  )
  const installRoot = join(userDataPath, "developer-runtimes")
  const npmPrefix = join(userDataPath, "npm-global")
  const npmCache = join(userDataPath, "npm-cache")
  const npmUserConfig = join(userDataPath, "npmrc")
  const catalog = existsSync(catalogPath)
    ? normalizeCatalog(readJson(catalogPath), runtimeTarget)
    : null
  const installPromises = new Map()
  const statuses = new Map()

  if (!catalog && !developmentRuntimes) {
    throw new Error(`Developer runtime catalog is unavailable: ${catalogPath}`)
  }

  mkdirSync(installRoot, { recursive: true })
  mkdirSync(npmPrefix, { recursive: true })
  mkdirSync(npmCache, { recursive: true })
  if (!existsSync(npmUserConfig)) {
    writeFileSync(npmUserConfig, "", { encoding: "utf8", mode: 0o600 })
  }

  function runtimeDefinition(runtimeId) {
    return catalog?.runtimes[runtimeId] ?? developmentRuntimes?.[runtimeId]
  }

  function destinationFor(runtime) {
    if (!catalog) {
      return runtime.root
    }

    return join(
      installRoot,
      runtime.id,
      `${runtimeTarget}-${safeDirectoryName(runtime.version)}`
    )
  }

  function commandPaths(runtime) {
    const root = destinationFor(runtime)

    return Object.fromEntries(
      Object.entries(runtime.commands).map(([name, relativePath]) => [
        name,
        resolveInside(root, relativePath, `${runtime.label} ${name}`),
      ])
    )
  }

  function markerFor(runtime) {
    return join(destinationFor(runtime), INSTALL_MARKER)
  }

  function ensureCommand(root, relativePath, label) {
    const path = resolveInside(root, relativePath, label)

    if (!existsSync(path)) {
      throw new Error(`Installed ${label} is missing: ${path}`)
    }

    if (platform !== "win32") {
      chmodSync(path, statSync(path).mode | 0o111)
      accessSync(path, constants.X_OK)
    }

    const canonicalRoot = realpathSync.native(root)
    const canonicalPath = realpathSync.native(path)

    if (!isInside(canonicalRoot, canonicalPath)) {
      throw new Error(`Installed ${label} escapes its runtime directory.`)
    }

    return path
  }

  function isRuntimeReady(runtime) {
    if (!catalog) {
      return Object.values(commandPaths(runtime)).every((path) =>
        existsSync(path)
      )
    }

    const marker = readJson(markerFor(runtime))

    if (
      marker?.schemaVersion !== 1 ||
      marker?.runtimeId !== runtime.id ||
      marker?.target !== runtimeTarget ||
      marker?.version !== runtime.version
    ) {
      return false
    }

    try {
      for (const [name, relativePath] of Object.entries(runtime.commands)) {
        ensureCommand(
          destinationFor(runtime),
          relativePath,
          `${runtime.label} ${name}`
        )
      }
      return true
    } catch {
      return false
    }
  }

  function initialStatus(runtime) {
    const ready = isRuntimeReady(runtime)

    return {
      runtimeId: runtime.id,
      label: runtime.label,
      version: runtime.version,
      packageManagerVersion: runtime.packageManagerVersion ?? null,
      commands: Object.keys(runtime.commands),
      phase: ready ? "ready" : "idle",
      ready,
      needsInstall: !ready,
      percent: ready ? 100 : null,
      transferred: ready ? 0 : null,
      total: ready ? 0 : null,
      bytesPerSecond: null,
      message: null,
    }
  }

  for (const runtimeId of RUNTIME_IDS) {
    const runtime = runtimeDefinition(runtimeId)

    if (!runtime) {
      throw new Error(`Developer runtime ${runtimeId} is not configured.`)
    }

    statuses.set(runtimeId, initialStatus(runtime))
  }

  function emitStatus(runtimeId, patch) {
    const current = statuses.get(runtimeId)

    if (!current) {
      throw new Error(`Unknown developer runtime: ${runtimeId}.`)
    }

    const next = { ...current, ...patch }
    statuses.set(runtimeId, next)

    try {
      onStatusChanged?.({ ...next })
    } catch {
      // A renderer listener must not interrupt an installation.
    }

    return { ...next }
  }

  function synchronizeRuntimeStatus(runtimeId) {
    const runtime = runtimeDefinition(runtimeId)
    const current = statuses.get(runtimeId)

    if (
      !runtime ||
      !current ||
      installPromises.has(runtimeId) ||
      current.phase === "downloading" ||
      current.phase === "installing"
    ) {
      return current
    }

    const ready = isRuntimeReady(runtime)

    if (ready && (!current.ready || current.phase !== "ready")) {
      return emitStatus(runtimeId, {
        phase: "ready",
        ready: true,
        needsInstall: false,
        percent: 100,
        transferred: 0,
        total: 0,
        bytesPerSecond: null,
        message: null,
      })
    }

    if (!ready && current.ready) {
      return emitStatus(runtimeId, {
        phase: "idle",
        ready: false,
        needsInstall: true,
        percent: null,
        transferred: null,
        total: null,
        bytesPerSecond: null,
        message: null,
      })
    }

    return current
  }

  function getStatuses() {
    return RUNTIME_IDS.map((runtimeId) => ({
      ...synchronizeRuntimeStatus(runtimeId),
    }))
  }

  function getRuntimePaths() {
    const python = runtimeDefinition("python")
    const node = runtimeDefinition("node")
    const pythonCommands = commandPaths(python)
    const nodeCommands = commandPaths(node)
    const npmBin = platform === "win32" ? npmPrefix : join(npmPrefix, "bin")

    return {
      python: {
        root: destinationFor(python),
        ...pythonCommands,
      },
      node: {
        root: destinationFor(node),
        ...nodeCommands,
      },
      npmCache,
      npmPrefix,
      npmBin,
    }
  }

  function getProcessEnvironment() {
    const paths = getRuntimePaths()

    return {
      ASTRAFLOW_BUNDLED_PYTHON_ROOT: paths.python.root,
      ASTRAFLOW_DEVELOPER_RUNTIME_CATALOG_PATH: catalogPath,
      ASTRAFLOW_DEVELOPER_RUNTIME_ROOT: installRoot,
      ASTRAFLOW_DEVELOPER_NODE_ROOT: paths.node.root,
      ASTRAFLOW_DEVELOPER_NODE_EXECUTABLE: paths.node.node,
      ASTRAFLOW_NPM_EXECUTABLE: paths.node.npm,
      ASTRAFLOW_NPM_PREFIX: npmPrefix,
      ASTRAFLOW_NPM_CACHE: npmCache,
      NPM_CONFIG_CACHE: npmCache,
      NPM_CONFIG_PREFIX: npmPrefix,
      NPM_CONFIG_UPDATE_NOTIFIER: "false",
      NPM_CONFIG_USERCONFIG: npmUserConfig,
      PATH: [
        paths.python.python ? dirname(paths.python.python) : null,
        paths.python.pip ? dirname(paths.python.pip) : null,
        paths.node.node ? dirname(paths.node.node) : null,
        paths.npmBin,
        processEnv.PATH,
      ]
        .filter(Boolean)
        .join(delimiter),
    }
  }

  function healthCheckDefinitions(runtime) {
    if (runtime.id === "python") {
      return [
        {
          command: "python",
          args: [
            "-c",
            "import pip, venv, platform; print(platform.python_version())",
          ],
          expectedVersion: runtime.version,
        },
        {
          command: "pip",
          args: ["--version"],
          expectedVersion: null,
        },
      ]
    }

    return [
      {
        command: "node",
        args: ["--version"],
        expectedVersion: runtime.version,
      },
      {
        command: "npm",
        args: ["--version"],
        expectedVersion: runtime.packageManagerVersion ?? null,
      },
      {
        command: "npx",
        args: ["--version"],
        expectedVersion: runtime.packageManagerVersion ?? null,
      },
    ]
  }

  function runHealthCheckCommand(command, args) {
    return new Promise((resolveCheck) => {
      const useShell = platform === "win32" && /\.(?:cmd|bat)$/i.test(command)
      const child = spawn(command, args, {
        env: {
          ...processEnv,
          ...getProcessEnvironment(),
        },
        shell: useShell,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      })
      let stdout = ""
      let stderr = ""
      let settled = false
      const append = (current, chunk) =>
        `${current}${chunk}`.slice(0, HEALTH_CHECK_OUTPUT_LIMIT)
      const finish = (result) => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(timer)
        resolveCheck(result)
      }
      const timer = setTimeout(() => {
        child.kill()
        finish({
          healthy: false,
          output: stdout.trim(),
          message: `Health check timed out after ${HEALTH_CHECK_TIMEOUT_MS / 1000} seconds.`,
        })
      }, HEALTH_CHECK_TIMEOUT_MS)

      timer.unref?.()
      child.stdout?.on("data", (chunk) => {
        stdout = append(stdout, chunk.toString("utf8"))
      })
      child.stderr?.on("data", (chunk) => {
        stderr = append(stderr, chunk.toString("utf8"))
      })
      child.once("error", (error) => {
        finish({
          healthy: false,
          output: stdout.trim(),
          message: error instanceof Error ? error.message : String(error),
        })
      })
      child.once("close", (code, signal) => {
        finish({
          healthy: code === 0,
          output: stdout.trim(),
          message:
            code === 0
              ? null
              : stderr.trim() ||
                `Command exited with code ${code ?? "null"} and signal ${signal ?? "null"}.`,
        })
      })
    })
  }

  async function checkHealth(runtimeId) {
    const runtimeIds = runtimeId ? [runtimeId] : RUNTIME_IDS
    const results = []

    for (const candidateId of runtimeIds) {
      const runtime = runtimeDefinition(candidateId)

      if (!runtime) {
        throw new Error(`Unknown developer runtime: ${candidateId}.`)
      }

      const status = synchronizeRuntimeStatus(candidateId)
      const checkedAt = new Date().toISOString()

      if (!status?.ready) {
        results.push({
          runtimeId: candidateId,
          label: runtime.label,
          installed: false,
          healthy: false,
          checkedAt,
          checks: [],
          message: `${runtime.label} is not installed.`,
        })
        continue
      }

      const paths = commandPaths(runtime)
      const checks = []

      for (const definition of healthCheckDefinitions(runtime)) {
        const result = await runHealthCheckCommand(
          paths[definition.command],
          definition.args
        )
        const expectedVersion =
          definition.expectedVersion === "development"
            ? null
            : definition.expectedVersion
        const versionMatches =
          !expectedVersion || result.output.includes(expectedVersion)
        const healthy = result.healthy && versionMatches

        checks.push({
          command: definition.command,
          healthy,
          output: result.output,
          message: healthy
            ? null
            : result.message ||
              `${definition.command} reported an unexpected version; expected ${expectedVersion}.`,
        })
      }

      const healthy = checks.every((check) => check.healthy)
      const message = healthy
        ? null
        : checks.find((check) => !check.healthy)?.message ||
          `${runtime.label} health check failed.`

      if (!healthy) {
        emitStatus(candidateId, {
          phase: "error",
          ready: false,
          needsInstall: true,
          message,
        })
      }

      results.push({
        runtimeId: candidateId,
        label: runtime.label,
        installed: true,
        healthy,
        checkedAt,
        checks,
        message,
      })
    }

    return runtimeId ? results[0] : results
  }

  async function fetchJson(url) {
    if (typeof fetchImpl !== "function") {
      throw new Error("Developer runtime downloads are unavailable.")
    }

    const response = await fetchImpl(url, { cache: "no-store" })

    if (!response.ok) {
      throw new Error(
        `Developer runtime metadata request failed with HTTP ${response.status}.`
      )
    }

    return response.json()
  }

  async function downloadArchive(runtime, manifest, manifestUrl, path) {
    const archiveUrl = new URL(manifest.archive, manifestUrl).toString()
    const response = await fetchImpl(archiveUrl, { cache: "no-store" })

    if (!response.ok || !response.body) {
      throw new Error(
        `${runtime.label} download failed with HTTP ${response.status}.`
      )
    }

    const startedAt = Date.now()
    const hash = createHash("sha256")
    let transferred = 0
    let lastEventAt = 0
    const progress = new Transform({
      transform(chunk, _encoding, callback) {
        transferred += chunk.length
        hash.update(chunk)
        const now = Date.now()

        if (
          now - lastEventAt >= DOWNLOAD_EVENT_INTERVAL_MS ||
          transferred >= manifest.archiveSize
        ) {
          lastEventAt = now
          emitStatus(runtime.id, {
            phase: "downloading",
            percent: Math.min(100, (transferred / manifest.archiveSize) * 100),
            transferred,
            total: manifest.archiveSize,
            bytesPerSecond:
              transferred / Math.max((now - startedAt) / 1000, 0.001),
            message: null,
          })
        }

        callback(null, chunk)
      },
    })

    await pipeline(
      Readable.fromWeb(response.body),
      progress,
      createWriteStream(path, { mode: 0o600 })
    )

    if (transferred !== manifest.archiveSize) {
      throw new Error(`${runtime.label} download was incomplete.`)
    }

    if (hash.digest("hex") !== manifest.archiveSha256) {
      throw new Error(`${runtime.label} download failed SHA-256 validation.`)
    }
  }

  async function validateStaging(staging, runtime, manifest) {
    for (const [name, command] of Object.entries(manifest.commands)) {
      const path = ensureCommand(
        staging,
        command.relativePath,
        `${runtime.label} ${name}`
      )

      if ((await sha256File(path)) !== command.sha256) {
        throw new Error(`${runtime.label} ${name} failed SHA-256 validation.`)
      }
    }
  }

  function cleanOldInstalls(runtime, currentDestination) {
    const root = join(installRoot, runtime.id)

    if (!existsSync(root)) {
      return
    }

    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const path = join(root, entry.name)

      if (entry.isDirectory() && path !== currentDestination) {
        try {
          rmSync(path, { recursive: true, force: true })
        } catch {
          // Retry locked older runtimes after a future successful install.
        }
      }
    }
  }

  function wait(delayMs) {
    return new Promise((resolveWait) => setTimeout(resolveWait, delayMs))
  }

  function installLockOwnerIsAlive(lockPath) {
    try {
      const ownerPid = Number.parseInt(readFileSync(lockPath, "utf8"), 10)

      if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
        return false
      }

      process.kill(ownerPid, 0)
      return true
    } catch (error) {
      return error?.code === "EPERM"
    }
  }

  async function acquireInstallLock(runtime, { force = false } = {}) {
    const lockRoot = join(installRoot, ".locks")
    const lockPath = join(lockRoot, `${runtime.id}.lock`)
    const token = `${process.pid}:${Date.now()}:${Math.random()}`

    mkdirSync(lockRoot, { recursive: true })

    while (true) {
      try {
        const descriptor = openSync(
          lockPath,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
          0o600
        )
        try {
          writeFileSync(descriptor, token)
        } finally {
          closeSync(descriptor)
        }

        return () => {
          try {
            if (readFileSync(lockPath, "utf8") === token) {
              rmSync(lockPath, { force: true })
            }
          } catch {
            // Another process already released or recovered the lock.
          }
        }
      } catch (error) {
        if (error?.code !== "EEXIST") {
          throw error
        }
      }

      if (!force && isRuntimeReady(runtime)) {
        return null
      }

      try {
        const lockAge = Date.now() - statSync(lockPath).mtimeMs
        if (
          (!installLockOwnerIsAlive(lockPath) && lockAge > 2_000) ||
          lockAge > INSTALL_LOCK_STALE_MS
        ) {
          rmSync(lockPath, { force: true })
          continue
        }
      } catch {
        continue
      }

      emitStatus(runtime.id, {
        phase: "downloading",
        message: `Waiting for another CompShare process to finish installing ${runtime.label}.`,
      })
      await wait(250)
    }
  }

  async function performLockedInstall(runtime, { force = false } = {}) {
    const release = await acquireInstallLock(runtime, { force })

    if (!release || (!force && isRuntimeReady(runtime))) {
      release?.()
      return emitStatus(runtime.id, {
        phase: "ready",
        ready: true,
        needsInstall: false,
        percent: 100,
        transferred: 0,
        total: 0,
        bytesPerSecond: null,
        message: null,
      })
    }

    try {
      return await performInstall(runtime)
    } finally {
      release()
    }
  }

  async function performInstall(runtime) {
    emitStatus(runtime.id, {
      phase: "downloading",
      ready: false,
      needsInstall: true,
      percent: 0,
      transferred: 0,
      total: null,
      bytesPerSecond: 0,
      message: null,
    })

    const encodedPath = [runtime.id, runtime.version, runtimeTarget]
      .map(encodeURIComponent)
      .join("/")
    const manifestUrl = `${catalog.downloadBaseUrl}/${encodedPath}/runtime-manifest.json`
    const manifest = normalizeManifest(
      await fetchJson(manifestUrl),
      runtime,
      runtimeTarget
    )
    const downloadRoot = join(installRoot, ".downloads")
    const downloadPath = join(
      downloadRoot,
      `${runtime.id}-${process.pid}-${Date.now()}.tar.br`
    )
    const staging = join(
      installRoot,
      runtime.id,
      `.${runtimeTarget}-staging-${process.pid}-${Date.now()}`
    )
    const destination = destinationFor(runtime)

    mkdirSync(downloadRoot, { recursive: true })
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })

    try {
      await downloadArchive(runtime, manifest, manifestUrl, downloadPath)
      emitStatus(runtime.id, {
        phase: "installing",
        percent: 100,
        transferred: manifest.archiveSize,
        total: manifest.archiveSize,
        bytesPerSecond: null,
      })
      await pipeline(
        createReadStream(downloadPath),
        createBrotliDecompress(),
        extractTar({ cwd: staging, preserveOwner: false, strict: true })
      )
      await validateStaging(staging, runtime, manifest)
      writeFileSync(
        join(staging, INSTALL_MARKER),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            runtimeId: runtime.id,
            target: runtimeTarget,
            version: runtime.version,
            archiveSha256: manifest.archiveSha256,
          },
          null,
          2
        )}\n`,
        { encoding: "utf8", mode: 0o600 }
      )

      rmSync(destination, { recursive: true, force: true })
      mkdirSync(dirname(destination), { recursive: true })
      renameSync(staging, destination)
      cleanOldInstalls(runtime, destination)

      return emitStatus(runtime.id, {
        phase: "ready",
        ready: true,
        needsInstall: false,
        percent: 100,
        transferred: manifest.archiveSize,
        total: manifest.archiveSize,
        bytesPerSecond: null,
        message: null,
      })
    } finally {
      rmSync(downloadPath, { force: true })
      rmSync(staging, { recursive: true, force: true })
    }
  }

  async function install(runtimeId, { force = false } = {}) {
    const runtime = runtimeDefinition(runtimeId)

    if (!runtime) {
      throw new Error(`Unknown developer runtime: ${runtimeId}.`)
    }

    if (!catalog) {
      return { ...statuses.get(runtimeId) }
    }

    const current = synchronizeRuntimeStatus(runtimeId)

    if (current?.ready && !force) {
      return { ...current }
    }

    const existing = installPromises.get(runtimeId)

    if (existing) {
      return existing
    }

    const promise = performLockedInstall(runtime, { force })
      .catch((error) => {
        emitStatus(runtime.id, {
          phase: "error",
          ready: false,
          needsInstall: true,
          bytesPerSecond: null,
          message: error instanceof Error ? error.message : String(error),
        })
        throw error
      })
      .finally(() => installPromises.delete(runtimeId))

    installPromises.set(runtimeId, promise)
    return promise
  }

  async function ensureInstalled() {
    const results = await Promise.allSettled(
      RUNTIME_IDS.map((runtimeId) => install(runtimeId))
    )
    const failure = results.find((result) => result.status === "rejected")

    if (failure) {
      throw failure.reason
    }

    return results.map((result) => result.value)
  }

  return {
    catalogPath,
    checkHealth,
    ensureInstalled,
    getProcessEnvironment,
    getRuntimePaths,
    getStatuses,
    install,
    installRoot,
  }
}

module.exports = {
  createDeveloperRuntimeEnvironmentManager,
}
