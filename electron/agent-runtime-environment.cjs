/* eslint-disable @typescript-eslint/no-require-imports */

const { execFile } = require("node:child_process")
const { createHash } = require("node:crypto")
const {
  accessSync,
  chmodSync,
  constants,
  createReadStream,
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
const { pipeline } = require("node:stream/promises")
const { createBrotliDecompress } = require("node:zlib")
const { x: extractTar } = require("tar")

const MANIFEST_FILE_NAME = "runtime-manifest.json"
const INSTALL_MARKER_FILE_NAME = ".astraflow-agent-runtimes.json"
const RUNTIMES_DIRECTORY_NAME = "agent-runtimes"
const SHA256_PATTERN = /^[0-9a-f]{64}$/i
const REQUIRED_EXECUTABLES = ["codex", "claude"]
const CODE_SIGNATURE_TIMEOUT_MS = 30_000

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
    throw new Error(`Invalid ${label} path in the agent runtime manifest.`)
  }

  const candidate = resolve(parent, relativePath)

  if (!isInside(parent, candidate)) {
    throw new Error(`${label} escapes the agent runtime directory.`)
  }

  return candidate
}

function normalizeManifest(value, runtimeTarget) {
  if (
    value?.schemaVersion !== 1 ||
    value?.target !== runtimeTarget ||
    typeof value?.archive !== "string" ||
    value.archive !== basename(value.archive) ||
    !value.archive.match(/\.tar\.(?:br|xz)$/) ||
    !SHA256_PATTERN.test(value?.archiveSha256 ?? "") ||
    !Number.isSafeInteger(value?.archiveSize) ||
    value.archiveSize <= 0
  ) {
    throw new Error(
      `Invalid packaged agent runtime manifest for ${runtimeTarget}.`
    )
  }

  const executables = {}

  for (const name of REQUIRED_EXECUTABLES) {
    const executable = value.executables?.[name]

    if (
      typeof executable?.relativePath !== "string" ||
      !SHA256_PATTERN.test(executable?.sha256 ?? "")
    ) {
      throw new Error(
        `Agent runtime manifest is missing a valid ${name} executable.`
      )
    }

    executables[name] = {
      relativePath: executable.relativePath,
      sha256: executable.sha256.toLowerCase(),
    }
  }

  return {
    schemaVersion: 1,
    target: runtimeTarget,
    archive: value.archive,
    archiveSha256: value.archiveSha256.toLowerCase(),
    archiveSize: value.archiveSize,
    verifyCodeSignatures: value.verifyCodeSignatures === true,
    executables,
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

function extractXzArchive(archivePath, destination, platform) {
  return new Promise((resolveExtraction, rejectExtraction) => {
    execFile(
      platform === "darwin" ? "/usr/bin/tar" : "tar",
      ["-xJf", archivePath, "-C", destination],
      {
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        timeout: 180_000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          rejectExtraction(
            new Error(
              `Failed to extract native agent runtimes: ${
                stderr?.trim() || stdout?.trim() || error.message
              }`
            )
          )
          return
        }

        resolveExtraction()
      }
    )
  })
}

function ensureExecutableInside(root, relativePath, platform) {
  const executable = resolveInside(root, relativePath, "Executable")

  if (!existsSync(executable)) {
    throw new Error(`Extracted agent runtime is missing ${executable}.`)
  }

  if (platform !== "win32") {
    chmodSync(executable, statSync(executable).mode | 0o111)
  }

  accessSync(executable, constants.X_OK)

  const canonicalExecutable = realpathSync.native(executable)
  const canonicalRoot = realpathSync.native(root)

  if (!isInside(canonicalRoot, canonicalExecutable)) {
    throw new Error(
      `Extracted agent runtime executable escapes its install directory: ${executable}`
    )
  }

  return executable
}

function createAgentRuntimeEnvironmentManager({
  appRoot,
  userDataPath,
  platform = process.platform,
  arch = process.arch,
  processEnv = process.env,
}) {
  const runtimeTarget = `${platform}-${arch}`
  const packagedRuntimeRoot = join(
    appRoot,
    "runtime",
    RUNTIMES_DIRECTORY_NAME
  )
  const manifestPath = join(packagedRuntimeRoot, MANIFEST_FILE_NAME)
  const installRoot = join(userDataPath, RUNTIMES_DIRECTORY_NAME)
  let readyPromise = null

  async function validateInstalledRuntime(
    destination,
    manifest,
    { verifyHashes }
  ) {
    const resolvedExecutables = {}

    for (const [name, entry] of Object.entries(manifest.executables)) {
      const executable = ensureExecutableInside(
        destination,
        entry.relativePath,
        platform
      )

      if (verifyHashes && (await sha256File(executable)) !== entry.sha256) {
        throw new Error(`Extracted ${name} executable failed SHA-256 validation.`)
      }

      if (platform === "darwin" && manifest.verifyCodeSignatures) {
        await verifyCodeSignature(executable)
      }

      resolvedExecutables[name] = executable
    }

    return resolvedExecutables
  }

  function readInstallMarker(destination) {
    return readJson(join(destination, INSTALL_MARKER_FILE_NAME))
  }

  async function reuseInstalledRuntime(destination, manifest) {
    const marker = readInstallMarker(destination)

    if (
      marker?.schemaVersion !== 1 ||
      marker?.target !== manifest.target ||
      marker?.archiveSha256 !== manifest.archiveSha256
    ) {
      return null
    }

    try {
      return await validateInstalledRuntime(destination, manifest, {
        verifyHashes: false,
      })
    } catch {
      return null
    }
  }

  function createEnvironment(destination, executables) {
    const pathEntries = [
      dirname(executables.codex),
      dirname(executables.claude),
      processEnv.PATH,
    ].filter(Boolean)

    return {
      ASTRAFLOW_AGENT_RUNTIME_ROOT: destination,
      ASTRAFLOW_CODEX_EXECUTABLE: executables.codex,
      CLAUDE_CODE_EXECUTABLE: executables.claude,
      CODEX_PATH: executables.codex,
      PATH: pathEntries.join(delimiter),
    }
  }

  function cleanOldInstalls(currentDestination) {
    for (const entry of readdirSync(installRoot, { withFileTypes: true })) {
      const entryPath = join(installRoot, entry.name)

      if (
        entry.isDirectory() &&
        entryPath !== currentDestination &&
        (entry.name.startsWith(`${runtimeTarget}-`) ||
          entry.name.startsWith(`.${runtimeTarget}-staging-`))
      ) {
        try {
          rmSync(entryPath, { recursive: true, force: true })
        } catch {
          // A stale runtime can be retried on the next launch if it is locked.
        }
      }
    }
  }

  async function prepareRuntime() {
    if (!existsSync(manifestPath)) {
      return {}
    }

    const manifest = normalizeManifest(readJson(manifestPath), runtimeTarget)
    const archivePath = resolveInside(
      packagedRuntimeRoot,
      manifest.archive,
      "Archive"
    )
    const destination = join(
      installRoot,
      `${runtimeTarget}-${manifest.archiveSha256.slice(0, 16)}`
    )

    mkdirSync(installRoot, { recursive: true })

    const installedExecutables = await reuseInstalledRuntime(
      destination,
      manifest
    )

    if (installedExecutables) {
      return createEnvironment(destination, installedExecutables)
    }

    if (
      !existsSync(archivePath) ||
      statSync(archivePath).size !== manifest.archiveSize
    ) {
      throw new Error(`Packaged agent runtime archive is missing or truncated.`)
    }

    if ((await sha256File(archivePath)) !== manifest.archiveSha256) {
      throw new Error(`Packaged agent runtime archive failed SHA-256 validation.`)
    }

    const staging = join(
      installRoot,
      `.${runtimeTarget}-staging-${process.pid}-${Date.now()}`
    )

    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })

    try {
      if (manifest.archive.endsWith(".tar.xz")) {
        await extractXzArchive(archivePath, staging, platform)
      } else {
        await pipeline(
          createReadStream(archivePath),
          createBrotliDecompress(),
          extractTar({
            cwd: staging,
            preserveOwner: false,
            strict: true,
          })
        )
      }

      const extractedExecutables = await validateInstalledRuntime(
        staging,
        manifest,
        { verifyHashes: true }
      )

      writeFileSync(
        join(staging, INSTALL_MARKER_FILE_NAME),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            target: manifest.target,
            archiveSha256: manifest.archiveSha256,
          },
          null,
          2
        )}\n`,
        { encoding: "utf8", mode: 0o600 }
      )

      rmSync(destination, { recursive: true, force: true })
      renameSync(staging, destination)
      cleanOldInstalls(destination)

      const destinationExecutables = Object.fromEntries(
        Object.keys(extractedExecutables).map((name) => [
          name,
          resolveInside(
            destination,
            manifest.executables[name].relativePath,
            "Executable"
          ),
        ])
      )

      return createEnvironment(destination, destinationExecutables)
    } catch (error) {
      rmSync(staging, { recursive: true, force: true })
      throw error
    }
  }

  function ensureReady() {
    if (!readyPromise) {
      readyPromise = prepareRuntime().catch((error) => {
        readyPromise = null
        throw error
      })
    }

    return readyPromise
  }

  return {
    ensureReady,
    installRoot,
    manifestPath,
  }
}

module.exports = {
  createAgentRuntimeEnvironmentManager,
}
