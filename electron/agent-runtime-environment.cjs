/* eslint-disable @typescript-eslint/no-require-imports */

const { execFile } = require("node:child_process")
const { createHash } = require("node:crypto")
const {
  accessSync,
  chmodSync,
  constants,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
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

const CATALOG_FILE_NAME = "runtime-catalog.json"
const INSTALL_MARKER_FILE_NAME = ".astraflow-agent-runtime.json"
const RUNTIMES_DIRECTORY_NAME = "agent-runtimes"
const SHA256_PATTERN = /^[0-9a-f]{64}$/i
const RUNTIME_IDS = ["codex", "claude-code", "opencode"]
const CODE_SIGNATURE_TIMEOUT_MS = 30_000
const DOWNLOAD_EVENT_INTERVAL_MS = 100

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

function isInside(parent, candidate) {
  const candidateRelative = relative(parent, candidate)

  return (
    candidateRelative !== "" &&
    candidateRelative !== ".." &&
    !candidateRelative.startsWith(`..${sep}`) &&
    !isAbsolute(candidateRelative)
  )
}

function resolveInside(parent, relativePath, label) {
  if (
    typeof relativePath !== "string" ||
    !relativePath.trim() ||
    relativePath.includes("\0") ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Invalid ${label} path in the agent runtime metadata.`)
  }

  const candidate = resolve(parent, relativePath)

  if (!isInside(parent, candidate)) {
    throw new Error(`${label} escapes the agent runtime directory.`)
  }

  return candidate
}

function normalizeCatalog(value, runtimeTarget) {
  if (
    value?.schemaVersion !== 1 ||
    value?.target !== runtimeTarget ||
    typeof value?.downloadBaseUrl !== "string" ||
    !value.downloadBaseUrl.match(/^https:\/\//)
  ) {
    throw new Error(`Invalid agent runtime catalog for ${runtimeTarget}.`)
  }

  const runtimes = {}

  for (const runtimeId of RUNTIME_IDS) {
    const runtime = value.runtimes?.[runtimeId]

    if (
      runtime?.id !== runtimeId ||
      typeof runtime?.label !== "string" ||
      !runtime.label.trim() ||
      typeof runtime?.version !== "string" ||
      !runtime.version.match(/^[0-9A-Za-z][0-9A-Za-z.+-]*$/) ||
      typeof runtime?.executableRelativePath !== "string"
    ) {
      throw new Error(
        `Agent runtime catalog is missing a valid ${runtimeId} entry.`
      )
    }

    runtimes[runtimeId] = {
      id: runtimeId,
      label: runtime.label.trim(),
      version: runtime.version,
      executableRelativePath: runtime.executableRelativePath,
    }
  }

  return {
    schemaVersion: 1,
    target: runtimeTarget,
    downloadBaseUrl: value.downloadBaseUrl.replace(/\/+$/, ""),
    runtimes,
  }
}

function normalizeManifest(value, expectedRuntime, runtimeTarget) {
  if (
    value?.schemaVersion !== 1 ||
    value?.runtimeId !== expectedRuntime.id ||
    value?.version !== expectedRuntime.version ||
    value?.target !== runtimeTarget ||
    typeof value?.archive !== "string" ||
    value.archive !== basename(value.archive) ||
    !value.archive.endsWith(".tar.br") ||
    !SHA256_PATTERN.test(value?.archiveSha256 ?? "") ||
    !Number.isSafeInteger(value?.archiveSize) ||
    value.archiveSize <= 0 ||
    value?.executable?.relativePath !==
      expectedRuntime.executableRelativePath ||
    !SHA256_PATTERN.test(value?.executable?.sha256 ?? "")
  ) {
    throw new Error(
      `Invalid ${expectedRuntime.label} runtime manifest for ${runtimeTarget}.`
    )
  }

  return {
    schemaVersion: 1,
    runtimeId: expectedRuntime.id,
    label: expectedRuntime.label,
    version: expectedRuntime.version,
    target: runtimeTarget,
    archive: value.archive,
    archiveSha256: value.archiveSha256.toLowerCase(),
    archiveSize: value.archiveSize,
    verifyCodeSignature: value.verifyCodeSignature === true,
    executable: {
      relativePath: value.executable.relativePath,
      sha256: value.executable.sha256.toLowerCase(),
    },
  }
}

function normalizeDevelopmentRuntimes(value) {
  if (!value) {
    return null
  }

  const runtimes = {}

  for (const runtimeId of RUNTIME_IDS) {
    const runtime = value[runtimeId]

    if (
      runtime?.id !== runtimeId ||
      typeof runtime?.label !== "string" ||
      !runtime.label.trim() ||
      typeof runtime?.version !== "string" ||
      !runtime.version.match(/^[0-9A-Za-z][0-9A-Za-z.+-]*$/)
    ) {
      throw new Error(
        `Development agent runtime metadata is missing a valid ${runtimeId} entry.`
      )
    }

    runtimes[runtimeId] = {
      id: runtimeId,
      label: runtime.label.trim(),
      version: runtime.version,
    }
  }

  return runtimes
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

function verifyCodeSignature(executable) {
  return new Promise((resolveVerification, rejectVerification) => {
    execFile(
      "/usr/bin/codesign",
      ["--verify", "--strict", "--verbose=2", executable],
      {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        timeout: CODE_SIGNATURE_TIMEOUT_MS,
      },
      (error, stdout, stderr) => {
        if (error) {
          rejectVerification(
            new Error(
              `Invalid code signature for ${executable}: ${
                stderr?.trim() || stdout?.trim() || error.message
              }`
            )
          )
          return
        }

        resolveVerification()
      }
    )
  })
}

function ensureExecutableInside(root, relativePath, platform) {
  const executable = resolveInside(root, relativePath, "Executable")

  if (!existsSync(executable)) {
    throw new Error(`Installed agent runtime is missing ${executable}.`)
  }

  if (platform !== "win32") {
    chmodSync(executable, statSync(executable).mode | 0o111)
  }

  accessSync(executable, constants.X_OK)

  const canonicalExecutable = realpathSync.native(executable)
  const canonicalRoot = realpathSync.native(root)

  if (!isInside(canonicalRoot, canonicalExecutable)) {
    throw new Error(
      `Installed agent runtime executable escapes its directory: ${executable}`
    )
  }

  return executable
}

function safeDirectoryName(value) {
  return value.replace(/[^0-9A-Za-z._-]/g, "_")
}

function developmentReadyStatus(runtime) {
  return {
    runtimeId: runtime.id,
    label: runtime.label,
    version: runtime.version,
    phase: "ready",
    ready: true,
    needsInstall: false,
    percent: 100,
    transferred: 0,
    total: 0,
    bytesPerSecond: null,
    message: null,
  }
}

function createAgentRuntimeEnvironmentManager({
  appRoot,
  userDataPath,
  platform = process.platform,
  arch = process.arch,
  processEnv = process.env,
  fetchImpl = globalThis.fetch,
  developmentRuntimes,
  onStatusChanged,
}) {
  const runtimeTarget = `${platform}-${arch}`
  const catalogPath = join(
    appRoot,
    "runtime",
    RUNTIMES_DIRECTORY_NAME,
    CATALOG_FILE_NAME
  )
  const installRoot = join(userDataPath, RUNTIMES_DIRECTORY_NAME)
  const catalog = existsSync(catalogPath)
    ? normalizeCatalog(readJson(catalogPath), runtimeTarget)
    : null
  const localRuntimes = catalog
    ? null
    : normalizeDevelopmentRuntimes(developmentRuntimes)
  const installPromises = new Map()
  const statuses = new Map()

  function destinationFor(runtime) {
    return join(
      installRoot,
      runtime.id,
      `${runtimeTarget}-${safeDirectoryName(runtime.version)}`
    )
  }

  function markerFor(runtime) {
    return join(destinationFor(runtime), INSTALL_MARKER_FILE_NAME)
  }

  function isRuntimeReady(runtime) {
    const destination = destinationFor(runtime)
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
      ensureExecutableInside(
        destination,
        runtime.executableRelativePath,
        platform
      )
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

  if (catalog) {
    for (const runtime of Object.values(catalog.runtimes)) {
      statuses.set(runtime.id, initialStatus(runtime))
    }
  } else if (localRuntimes) {
    for (const runtime of Object.values(localRuntimes)) {
      statuses.set(runtime.id, developmentReadyStatus(runtime))
    }
  }

  function emitStatus(runtimeId, patch) {
    const current = statuses.get(runtimeId)

    if (!current) {
      throw new Error(`Unknown downloadable agent runtime: ${runtimeId}.`)
    }

    const next = { ...current, ...patch }
    statuses.set(runtimeId, next)

    try {
      onStatusChanged?.({ ...next })
    } catch {
      // UI status listeners must not interrupt installation.
    }

    return { ...next }
  }

  function getStatuses() {
    return Array.from(statuses.values(), (status) => ({ ...status }))
  }

  function createEnvironment() {
    if (!catalog) {
      return {}
    }

    const executablePaths = Object.fromEntries(
      Object.values(catalog.runtimes).map((runtime) => [
        runtime.id,
        resolveInside(
          destinationFor(runtime),
          runtime.executableRelativePath,
          "Executable"
        ),
      ])
    )
    const pathEntries = [
      ...Object.values(executablePaths).map((path) => dirname(path)),
      processEnv.PATH,
    ].filter(Boolean)

    return {
      ASTRAFLOW_AGENT_RUNTIME_ROOT: installRoot,
      ASTRAFLOW_CODEX_EXECUTABLE: executablePaths.codex,
      ASTRAFLOW_OPENCODE_EXECUTABLE: executablePaths.opencode,
      CLAUDE_CODE_EXECUTABLE: executablePaths["claude-code"],
      CODEX_PATH: executablePaths.codex,
      PATH: pathEntries.join(delimiter),
    }
  }

  async function fetchJson(url) {
    if (typeof fetchImpl !== "function") {
      throw new Error("Agent runtime downloads are unavailable in this build.")
    }

    const response = await fetchImpl(url, { cache: "no-store" })

    if (!response.ok) {
      throw new Error(
        `Agent runtime metadata request failed with HTTP ${response.status}.`
      )
    }

    return response.json()
  }

  async function downloadArchive(runtime, manifest, manifestUrl, downloadPath) {
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
          const seconds = Math.max((now - startedAt) / 1000, 0.001)

          emitStatus(runtime.id, {
            phase: "downloading",
            ready: false,
            needsInstall: true,
            percent: Math.min(100, (transferred / manifest.archiveSize) * 100),
            transferred,
            total: manifest.archiveSize,
            bytesPerSecond: transferred / seconds,
            message: null,
          })
        }

        callback(null, chunk)
      },
    })

    await pipeline(
      Readable.fromWeb(response.body),
      progress,
      createWriteStream(downloadPath, { mode: 0o600 })
    )

    if (transferred !== manifest.archiveSize) {
      throw new Error(
        `${runtime.label} download was incomplete (${transferred}/${manifest.archiveSize} bytes).`
      )
    }

    if (hash.digest("hex") !== manifest.archiveSha256) {
      throw new Error(`${runtime.label} download failed SHA-256 validation.`)
    }
  }

  async function validateStagingRuntime(staging, manifest) {
    const executable = ensureExecutableInside(
      staging,
      manifest.executable.relativePath,
      platform
    )

    if ((await sha256File(executable)) !== manifest.executable.sha256) {
      throw new Error(`${manifest.label} executable failed SHA-256 validation.`)
    }

    if (platform === "darwin" && manifest.verifyCodeSignature) {
      await verifyCodeSignature(executable)
    }

    return executable
  }

  function cleanOldInstalls(runtime, currentDestination) {
    const runtimeRoot = join(installRoot, runtime.id)

    if (!existsSync(runtimeRoot)) {
      return
    }

    for (const entry of readdirSync(runtimeRoot, { withFileTypes: true })) {
      const entryPath = join(runtimeRoot, entry.name)

      if (entry.isDirectory() && entryPath !== currentDestination) {
        try {
          rmSync(entryPath, { recursive: true, force: true })
        } catch {
          // Locked older runtimes are retried on the next successful install.
        }
      }
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
    emitStatus(runtime.id, {
      phase: "downloading",
      ready: false,
      needsInstall: true,
      percent: 0,
      transferred: 0,
      total: manifest.archiveSize,
      bytesPerSecond: 0,
      message: null,
    })

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
        extractTar({
          cwd: staging,
          preserveOwner: false,
          strict: true,
        })
      )
      await validateStagingRuntime(staging, manifest)
      writeFileSync(
        join(staging, INSTALL_MARKER_FILE_NAME),
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

  async function install(runtimeId) {
    if (!catalog) {
      const runtime = localRuntimes?.[runtimeId]

      if (!runtime) {
        throw new Error(`Unknown downloadable agent runtime: ${runtimeId}.`)
      }

      // Development launches use the exact runtime packages installed in this
      // repository. Treat an install request as an idempotent readiness check,
      // and repair the in-memory status if the renderer raced initial loading.
      const developmentStatus = developmentReadyStatus(runtime)
      statuses.set(runtime.id, developmentStatus)
      return { ...developmentStatus }
    }

    const runtime = catalog.runtimes[runtimeId]

    if (!runtime) {
      throw new Error(`Unknown downloadable agent runtime: ${runtimeId}.`)
    }

    const current = statuses.get(runtimeId)

    if (current?.ready) {
      return { ...current }
    }

    const existing = installPromises.get(runtimeId)

    if (existing) {
      return existing
    }

    const promise = performInstall(runtime)
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
      .finally(() => {
        installPromises.delete(runtimeId)
      })

    installPromises.set(runtimeId, promise)
    return promise
  }

  return {
    catalogPath,
    ensureReady: async () => createEnvironment(),
    getStatuses,
    install,
    installRoot,
  }
}

module.exports = {
  createAgentRuntimeEnvironmentManager,
}
