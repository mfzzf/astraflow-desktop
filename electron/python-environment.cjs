/* eslint-disable @typescript-eslint/no-require-imports */

const { execFile, spawn } = require("node:child_process")
const { createHash } = require("node:crypto")
const {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} = require("node:fs")
const { delimiter, dirname, join, resolve } = require("node:path")

const CONFIG_FILE_NAME = "python-environment.json"
const STATE_FILE_NAME = "python-environment-state.json"
const USER_PACKAGES_FILE_NAME = "python-user-packages.json"
const MANAGED_ENVIRONMENTS_DIRECTORY = "python-environments"
const MANAGED_MARKER_FILE = ".astraflow-python-environment.json"
const MAX_CAPTURED_OUTPUT_BYTES = 12 * 1024
const INSPECTION_TIMEOUT_MS = 30_000
const PACKAGE_SEARCH_TIMEOUT_MS = 60_000
const MAX_PACKAGE_SEARCH_VERSIONS = 200
const PYTHON_PACKAGE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const PYTHON_PACKAGE_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.!+_-]{0,199}$/
const CORE_PYTHON_PACKAGES = new Set(["pip", "setuptools", "wheel"])

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function executableForRoot(root, platform) {
  return platform === "win32"
    ? join(root, "python.exe")
    : join(root, "bin", "python3")
}

function executableForVirtualEnvironment(root, platform) {
  return platform === "win32"
    ? join(root, "Scripts", "python.exe")
    : join(root, "bin", "python3")
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

function writePrivateJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function uniqueExistingPaths(values) {
  const result = []
  const seen = new Set()

  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) {
      continue
    }

    const absolute = resolve(value.trim())
    let canonical = absolute

    try {
      canonical = realpathSync.native(absolute)
    } catch {
      if (!existsSync(absolute)) {
        continue
      }
    }

    for (const path of [absolute, canonical]) {
      if (!seen.has(path)) {
        seen.add(path)
        result.push(path)
      }
    }
  }

  return result
}

function appendCaptured(current, chunk) {
  return `${current}${String(chunk)}`.slice(-MAX_CAPTURED_OUTPUT_BYTES)
}

function runFile(command, args, { env, timeout = INSPECTION_TIMEOUT_MS } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        env,
        maxBuffer: 16 * 1024 * 1024,
        timeout,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          rejectRun(
            new Error(
              stderr?.trim() || stdout?.trim() || error.message || String(error)
            )
          )
          return
        }

        resolveRun({ stdout: stdout.trim(), stderr: stderr.trim() })
      }
    )
  })
}

function runStreaming(command, args, { env, onOutput, onSpawn } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    let output = ""

    onSpawn?.(child)

    const remember = (chunk) => {
      output = appendCaptured(output, chunk)
      onOutput?.(output)
    }

    child.stdout.on("data", remember)
    child.stderr.on("data", remember)
    child.once("error", rejectRun)
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun(output)
        return
      }

      rejectRun(
        new Error(
          output.trim() ||
            `Python environment command exited with code ${code ?? "null"} and signal ${signal ?? "null"}.`
        )
      )
    })
  })
}

function normalizeConfig(value) {
  if (value?.mode === "custom" && typeof value.customExecutable === "string") {
    const customExecutable = value.customExecutable.trim()

    if (customExecutable) {
      return {
        schemaVersion: 1,
        mode: "custom",
        customExecutable: resolve(customExecutable),
      }
    }
  }

  return {
    schemaVersion: 1,
    mode: "managed",
    customExecutable: null,
  }
}

function normalizePackageKey(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[-_.]+/g, "-")
}

function normalizePackageRequest(value) {
  const name = typeof value?.name === "string" ? value.name.trim() : ""
  const version =
    typeof value?.version === "string" && value.version.trim()
      ? value.version.trim()
      : null

  if (!PYTHON_PACKAGE_NAME_PATTERN.test(name)) {
    throw new Error(
      "Enter one Python package name using letters, numbers, dots, hyphens, or underscores."
    )
  }

  if (version && !PYTHON_PACKAGE_VERSION_PATTERN.test(version)) {
    throw new Error("The selected Python package version is invalid.")
  }

  return { name, version }
}

function parsePipIndexText(output, requestedName) {
  const lines = String(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const heading = lines
    .map((line) => line.match(/^(.+?)\s+\(([^)]+)\)$/))
    .find(Boolean)
  const availableVersions = lines
    .find((line) => /^Available versions:/i.test(line))
    ?.replace(/^Available versions:\s*/i, "")
  const installedVersion = lines
    .find((line) => /^INSTALLED:/i.test(line))
    ?.replace(/^INSTALLED:\s*/i, "")
  const latestVersion = lines
    .find((line) => /^LATEST:/i.test(line))
    ?.replace(/^LATEST:\s*/i, "")

  return {
    name: heading?.[1]?.trim() || requestedName,
    versions: availableVersions
      ? availableVersions.split(",").map((version) => version.trim())
      : [],
    latest: latestVersion || heading?.[2]?.trim() || null,
    installed_version: installedVersion || null,
  }
}

function normalizeUserPackages(value) {
  const entries = Array.isArray(value?.packages) ? value.packages : []
  const packages = new Map()

  for (const entry of entries) {
    try {
      const normalized = normalizePackageRequest(entry)

      if (normalized.version) {
        packages.set(normalizePackageKey(normalized.name), normalized)
      }
    } catch {
      // Ignore malformed or stale entries instead of blocking Python startup.
    }
  }

  return [...packages.values()].sort((left, right) =>
    left.name.localeCompare(right.name)
  )
}

function createPythonEnvironmentManager({
  appRoot,
  userDataPath,
  platform = process.platform,
  arch = process.arch,
  processEnv = process.env,
  bootstrapRoot: configuredBootstrapRoot,
}) {
  const runtimeTarget = `${platform}-${arch}`
  const packagedBootstrapRoot = join(
    appRoot,
    "runtime",
    "python",
    runtimeTarget
  )
  const developmentBootstrapRoot = join(
    appRoot,
    "runtime",
    "python",
    "distributions",
    runtimeTarget
  )
  const bootstrapRoot = configuredBootstrapRoot
    ? resolve(configuredBootstrapRoot)
    : existsSync(packagedBootstrapRoot)
      ? packagedBootstrapRoot
      : developmentBootstrapRoot
  const bootstrapExecutable = executableForRoot(bootstrapRoot, platform)
  const requirementsPath = join(
    appRoot,
    "runtime",
    "python",
    "requirements.lock"
  )
  const runtimeManifestPath = join(
    appRoot,
    "runtime",
    "python",
    "runtime-manifest.json"
  )
  const configPath = join(userDataPath, CONFIG_FILE_NAME)
  const statePath = join(userDataPath, STATE_FILE_NAME)
  const userPackagesPath = join(userDataPath, USER_PACKAGES_FILE_NAME)
  const managedEnvironmentsRoot = join(
    userDataPath,
    MANAGED_ENVIRONMENTS_DIRECTORY
  )
  let activeInstallChild = null
  let installPromise = null
  let status = null

  mkdirSync(userDataPath, { recursive: true })
  mkdirSync(managedEnvironmentsRoot, { recursive: true })

  function readConfig() {
    const stored = readJson(configPath)
    const config = normalizeConfig(stored)

    if (!stored || JSON.stringify(stored) !== JSON.stringify(config)) {
      writePrivateJson(configPath, config)
    }

    return config
  }

  function writeConfig(config) {
    const normalized = normalizeConfig(config)
    writePrivateJson(configPath, normalized)
    return normalized
  }

  function requirementsHash() {
    return sha256(readFileSync(requirementsPath))
  }

  function requiredPackageNames() {
    const names = new Set()

    if (!existsSync(requirementsPath)) {
      return names
    }

    for (const line of readFileSync(requirementsPath, "utf8").split(/\r?\n/)) {
      const match = line.match(
        /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]+\])?\s*==/
      )

      if (match?.[1]) {
        names.add(normalizePackageKey(match[1]))
      }
    }

    return names
  }

  function readUserPackages() {
    return normalizeUserPackages(readJson(userPackagesPath))
  }

  function writeUserPackages(packages) {
    const normalized = normalizeUserPackages({ packages })
    writePrivateJson(userPackagesPath, {
      schemaVersion: 1,
      packages: normalized,
      updatedAt: new Date().toISOString(),
    })
    return normalized
  }

  function bootstrapHash() {
    const manifest = existsSync(runtimeManifestPath)
      ? readFileSync(runtimeManifestPath)
      : Buffer.from(runtimeTarget)

    return sha256(
      Buffer.concat([
        manifest,
        Buffer.from(`\0${runtimeTarget}\0${bootstrapExecutable}`),
      ])
    )
  }

  function managedEnvironmentKey() {
    return sha256(`${requirementsHash()}:${bootstrapHash()}`).slice(0, 16)
  }

  function managedRoot() {
    return join(managedEnvironmentsRoot, `managed-${managedEnvironmentKey()}`)
  }

  function managedExecutable() {
    return executableForVirtualEnvironment(managedRoot(), platform)
  }

  function bootstrapEnvironment() {
    const binDirectory =
      platform === "win32" ? bootstrapRoot : join(bootstrapRoot, "bin")

    return {
      ...processEnv,
      PATH: `${binDirectory}${delimiter}${processEnv.PATH ?? ""}`,
      PIP_DISABLE_PIP_VERSION_CHECK: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONHOME: bootstrapRoot,
      PYTHONNOUSERSITE: "1",
    }
  }

  function environmentFor(executable, { bootstrap = false } = {}) {
    return {
      ...processEnv,
      PATH: `${dirname(executable)}${delimiter}${processEnv.PATH ?? ""}`,
      PIP_DISABLE_PIP_VERSION_CHECK: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      ...(bootstrap
        ? {
            PYTHONHOME: bootstrapRoot,
            PYTHONNOUSERSITE: "1",
          }
        : {}),
    }
  }

  async function inspectPython(executable, { bootstrap = false } = {}) {
    if (!isExecutable(executable)) {
      throw new Error(`Python interpreter is unavailable: ${executable}`)
    }

    const inspectionCode = [
      "import json, os, site, sys, sysconfig",
      "paths = sysconfig.get_paths()",
      "roots = [sys.prefix, sys.base_prefix, paths.get('purelib'), paths.get('platlib'), os.path.dirname(sys.executable)]",
      "print(json.dumps({'executable': sys.executable, 'version': sys.version.split()[0], 'prefix': sys.prefix, 'basePrefix': sys.base_prefix, 'userBase': site.getuserbase(), 'userSite': site.getusersitepackages(), 'roots': [p for p in roots if p]}))",
    ].join("; ")
    const env = environmentFor(executable, { bootstrap })
    const inspection = await runFile(executable, ["-c", inspectionCode], {
      env,
    })
    const inspectionLine = inspection.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .at(-1)
    let metadata

    try {
      metadata = JSON.parse(inspectionLine)
    } catch {
      throw new Error(
        `Python interpreter returned an invalid inspection response: ${inspection.stdout}`
      )
    }

    let packages = []
    let topLevelPackages = null
    let pipVersion = null

    try {
      const pipList = await runFile(
        executable,
        ["-m", "pip", "list", "--format=json", "--disable-pip-version-check"],
        { env }
      )
      packages = JSON.parse(pipList.stdout)
        .filter(
          (entry) =>
            entry &&
            typeof entry.name === "string" &&
            typeof entry.version === "string"
        )
        .map((entry) => ({ name: entry.name, version: entry.version }))
        .sort((left, right) => left.name.localeCompare(right.name))
      const pipInfo = packages.find(
        (entry) => entry.name.toLowerCase() === "pip"
      )
      pipVersion = pipInfo?.version ?? null

      try {
        const topLevelList = await runFile(
          executable,
          [
            "-m",
            "pip",
            "list",
            "--not-required",
            "--format=json",
            "--disable-pip-version-check",
          ],
          { env }
        )
        topLevelPackages = JSON.parse(topLevelList.stdout)
          .filter(
            (entry) =>
              entry &&
              typeof entry.name === "string" &&
              typeof entry.version === "string"
          )
          .map((entry) => ({ name: entry.name, version: entry.version }))
      } catch {
        topLevelPackages = null
      }
    } catch {
      packages = []
      topLevelPackages = null
      pipVersion = null
    }

    const executablePath = resolve(executable)
    const roots = uniqueExistingPaths([
      ...(Array.isArray(metadata.roots) ? metadata.roots : []),
      metadata.prefix,
      metadata.basePrefix,
      dirname(executablePath),
      dirname(realpathSync.native(executablePath)),
    ])

    return {
      executable: executablePath,
      resolvedExecutable: realpathSync.native(executablePath),
      version: String(metadata.version || ""),
      prefix: String(metadata.prefix || dirname(executablePath)),
      basePrefix: String(metadata.basePrefix || metadata.prefix || ""),
      userBase:
        typeof metadata.userBase === "string" ? metadata.userBase : null,
      userSite:
        typeof metadata.userSite === "string" ? metadata.userSite : null,
      roots,
      packages,
      topLevelPackages,
      pipVersion,
      pipAvailable: pipVersion != null,
    }
  }

  function writeRuntimeState({ config, inspection, ready, source }) {
    const roots = inspection
      ? uniqueExistingPaths([
          ...inspection.roots,
          source === "custom" ? inspection.userSite : null,
        ])
      : uniqueExistingPaths([bootstrapRoot, bootstrapExecutable])
    const state = {
      schemaVersion: 1,
      mode: config.mode,
      source,
      ready: Boolean(ready),
      executable: inspection?.executable ?? bootstrapExecutable,
      resolvedExecutable:
        inspection?.resolvedExecutable ??
        (isExecutable(bootstrapExecutable)
          ? realpathSync.native(bootstrapExecutable)
          : bootstrapExecutable),
      roots,
      packageWriteRoots:
        source === "managed" && inspection
          ? uniqueExistingPaths([inspection.prefix])
          : [],
      pythonUserBase:
        source === "custom" ? (inspection?.userBase ?? null) : null,
      isolated: source !== "custom",
      updatedAt: new Date().toISOString(),
    }

    writePrivateJson(statePath, state)
    return state
  }

  function createStatus({
    config,
    inspection = null,
    ready = false,
    needsInstall = false,
    installing = false,
    stage = "idle",
    message = null,
    error = null,
  }) {
    const requiredNames =
      config.mode === "managed" ? requiredPackageNames() : new Set()

    return {
      mode: config.mode,
      customExecutable: config.customExecutable,
      bootstrapExecutable,
      executable: inspection?.executable ?? null,
      pythonVersion: inspection?.version ?? null,
      pipVersion: inspection?.pipVersion ?? null,
      pipAvailable: inspection?.pipAvailable ?? false,
      packages: (inspection?.packages ?? []).map((entry) => {
        const key = normalizePackageKey(entry.name)
        const required = requiredNames.has(key)

        return {
          ...entry,
          required,
          userInstalled: !required && !CORE_PYTHON_PACKAGES.has(key),
        }
      }),
      ready,
      needsInstall,
      installing,
      stage,
      message,
      error,
    }
  }

  function syncManagedUserPackages(inspection) {
    if (!Array.isArray(inspection?.topLevelPackages)) {
      return readUserPackages()
    }

    const requiredNames = requiredPackageNames()
    const installedPackages = new Map(
      inspection.packages.map((entry) => [
        normalizePackageKey(entry.name),
        entry,
      ])
    )
    const packages = new Map()

    for (const entry of [
      ...readUserPackages(),
      ...inspection.topLevelPackages,
    ]) {
      const key = normalizePackageKey(entry.name)
      const installed = installedPackages.get(key)

      if (
        installed &&
        !requiredNames.has(key) &&
        !CORE_PYTHON_PACKAGES.has(key)
      ) {
        packages.set(key, installed)
      }
    }

    return writeUserPackages([...packages.values()])
  }

  function readManagedMarker() {
    const marker = readJson(join(managedRoot(), MANAGED_MARKER_FILE))

    if (
      marker?.schemaVersion !== 1 ||
      marker.requirementsHash !== requirementsHash() ||
      marker.bootstrapHash !== bootstrapHash()
    ) {
      return null
    }

    return marker
  }

  async function refreshStatus({
    ignoreInstall = false,
    syncUserPackages = true,
  } = {}) {
    if (!ignoreInstall && installPromise && status) {
      return status
    }

    const config = readConfig()

    if (config.mode === "custom") {
      try {
        const inspection = await inspectPython(config.customExecutable)
        writeRuntimeState({
          config,
          inspection,
          ready: true,
          source: "custom",
        })
        status = createStatus({
          config,
          inspection,
          ready: true,
          stage: "ready",
          message: inspection.pipAvailable
            ? "Custom Python is ready."
            : "Custom Python is available, but pip is not installed.",
        })
      } catch (error) {
        writeRuntimeState({ config, ready: false, source: "bootstrap" })
        status = createStatus({
          config,
          needsInstall: false,
          stage: "error",
          error: error instanceof Error ? error.message : String(error),
        })
      }

      return status
    }

    if (!readManagedMarker() || !isExecutable(managedExecutable())) {
      const bootstrapInspection = isExecutable(bootstrapExecutable)
        ? await inspectPython(bootstrapExecutable, { bootstrap: true }).catch(
            () => null
          )
        : null
      writeRuntimeState({
        config,
        inspection: bootstrapInspection,
        ready: Boolean(bootstrapInspection),
        source: "bootstrap",
      })
      status = createStatus({
        config,
        inspection: bootstrapInspection,
        ready: Boolean(bootstrapInspection),
        needsInstall: true,
        stage: "pending",
        message: bootstrapInspection
          ? "The Python interpreter is ready. AstraFlow packages are waiting to be installed."
          : "The managed Python runtime is waiting to be downloaded.",
      })
      return status
    }

    try {
      const inspection = await inspectPython(managedExecutable())

      if (syncUserPackages) {
        syncManagedUserPackages(inspection)
      }

      writeRuntimeState({
        config,
        inspection,
        ready: true,
        source: "managed",
      })
      status = createStatus({
        config,
        inspection,
        ready: true,
        stage: "ready",
        message: "AstraFlow's managed Python environment is ready.",
      })
    } catch (error) {
      writeRuntimeState({ config, ready: false, source: "bootstrap" })
      status = createStatus({
        config,
        needsInstall: true,
        stage: "error",
        error: error instanceof Error ? error.message : String(error),
      })
    }

    return status
  }

  function updateInstallingStatus(
    config,
    stage,
    message,
    { needsInstall = true } = {}
  ) {
    const current = status?.mode === config.mode ? status : null

    status = {
      ...(current ??
        createStatus({
          config,
          ready: false,
          needsInstall,
        })),
      ready: needsInstall ? false : Boolean(current?.ready),
      needsInstall,
      installing: true,
      stage,
      message,
      error: null,
    }
  }

  function trackInstallChild(child) {
    activeInstallChild = child
    child.once("close", () => {
      if (activeInstallChild === child) {
        activeInstallChild = null
      }
    })
  }

  async function setInstallationError(config, error) {
    const message = error instanceof Error ? error.message : String(error)

    if (config.mode === "custom") {
      const inspection = await inspectPython(config.customExecutable).catch(
        () => null
      )

      writeRuntimeState({
        config,
        inspection,
        ready: Boolean(inspection),
        source: inspection ? "custom" : "bootstrap",
      })
      status = createStatus({
        config,
        inspection,
        ready: Boolean(inspection),
        stage: "error",
        error: message,
      })
      return status
    }

    const bootstrapInspection = isExecutable(bootstrapExecutable)
      ? await inspectPython(bootstrapExecutable, { bootstrap: true }).catch(
          () => null
        )
      : null
    writeRuntimeState({
      config,
      inspection: bootstrapInspection,
      ready: Boolean(bootstrapInspection),
      source: "bootstrap",
    })
    status = createStatus({
      config,
      inspection: bootstrapInspection,
      ready: Boolean(bootstrapInspection),
      needsInstall: true,
      stage: "error",
      error: message,
    })
    return status
  }

  async function installManagedEnvironment({ force = false } = {}) {
    const config = readConfig()
    const targetRoot = managedRoot()
    const targetExecutable = managedExecutable()

    if (!isExecutable(bootstrapExecutable)) {
      throw new Error(
        `AstraFlow's bootstrap Python is unavailable: ${bootstrapExecutable}`
      )
    }

    if (!existsSync(requirementsPath)) {
      throw new Error(
        `Python requirements are unavailable: ${requirementsPath}`
      )
    }

    if (!force && readManagedMarker() && isExecutable(targetExecutable)) {
      return refreshStatus({ ignoreInstall: true })
    }

    writeRuntimeState({
      config,
      ready: true,
      source: "bootstrap",
    })

    updateInstallingStatus(
      config,
      "creating",
      "Creating AstraFlow's managed Python environment…"
    )
    rmSync(targetRoot, { recursive: true, force: true })
    mkdirSync(dirname(targetRoot), { recursive: true })

    await runStreaming(
      bootstrapExecutable,
      ["-m", "venv", "--copies", targetRoot],
      {
        env: bootstrapEnvironment(),
        onSpawn: trackInstallChild,
      }
    )

    updateInstallingStatus(
      config,
      "installing",
      "Installing AstraFlow's Python packages…"
    )
    await runStreaming(
      targetExecutable,
      [
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-cache-dir",
        "--only-binary=:all:",
        "--requirement",
        requirementsPath,
      ],
      {
        env: environmentFor(targetExecutable),
        onSpawn: trackInstallChild,
        onOutput: (output) => {
          const detail = output.trim().split(/\r?\n/).at(-1)
          updateInstallingStatus(
            config,
            "installing",
            detail || "Installing AstraFlow's Python packages…"
          )
        },
      }
    )
    await runFile(targetExecutable, ["-m", "pip", "check"], {
      env: environmentFor(targetExecutable),
      timeout: 120_000,
    })

    const userPackages = readUserPackages()
    let restoreError = null

    if (userPackages.length) {
      updateInstallingStatus(
        config,
        "installing",
        "Restoring custom Python packages…"
      )

      try {
        await runStreaming(
          targetExecutable,
          [
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--no-cache-dir",
            "--prefer-binary",
            "--constraint",
            requirementsPath,
            ...userPackages.map((entry) => `${entry.name}==${entry.version}`),
          ],
          {
            env: environmentFor(targetExecutable),
            onSpawn: trackInstallChild,
            onOutput: (output) => {
              const detail = output.trim().split(/\r?\n/).at(-1)
              updateInstallingStatus(
                config,
                "installing",
                detail || "Restoring custom Python packages…"
              )
            },
          }
        )
        await runFile(targetExecutable, ["-m", "pip", "check"], {
          env: environmentFor(targetExecutable),
          timeout: 120_000,
        })
      } catch (error) {
        restoreError = error instanceof Error ? error.message : String(error)
      }
    }

    writePrivateJson(join(targetRoot, MANAGED_MARKER_FILE), {
      schemaVersion: 1,
      requirementsHash: requirementsHash(),
      bootstrapHash: bootstrapHash(),
      createdAt: new Date().toISOString(),
    })

    for (const entry of readdirSync(managedEnvironmentsRoot, {
      withFileTypes: true,
    })) {
      const entryPath = join(managedEnvironmentsRoot, entry.name)

      if (
        entry.isDirectory() &&
        entry.name.startsWith("managed-") &&
        entryPath !== targetRoot
      ) {
        rmSync(entryPath, { recursive: true, force: true })
      }
    }

    const nextStatus = await refreshStatus({
      ignoreInstall: true,
      syncUserPackages: restoreError == null,
    })

    if (restoreError) {
      status = {
        ...nextStatus,
        message: `AstraFlow Python is ready, but some custom packages could not be restored: ${restoreError}`,
      }
    }

    return status
  }

  async function installCustomEnvironment() {
    const config = readConfig()

    if (config.mode !== "custom") {
      throw new Error("A custom Python interpreter is not selected.")
    }

    if (!existsSync(requirementsPath)) {
      throw new Error(
        `Python requirements are unavailable: ${requirementsPath}`
      )
    }

    const inspection = await inspectPython(config.customExecutable)

    if (!inspection.pipAvailable) {
      throw new Error(
        "The selected Python interpreter does not provide pip. Install pip before adding AstraFlow packages."
      )
    }

    updateInstallingStatus(
      config,
      "installing",
      "Installing AstraFlow packages into the custom Python interpreter…"
    )
    await runStreaming(
      inspection.executable,
      [
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-cache-dir",
        "--only-binary=:all:",
        "--requirement",
        requirementsPath,
      ],
      {
        env: environmentFor(inspection.executable),
        onSpawn: trackInstallChild,
        onOutput: (output) => {
          const detail = output.trim().split(/\r?\n/).at(-1)
          updateInstallingStatus(
            config,
            "installing",
            detail || "Installing AstraFlow packages…"
          )
        },
      }
    )
    await runFile(inspection.executable, ["-m", "pip", "check"], {
      env: environmentFor(inspection.executable),
      timeout: 120_000,
    })

    return refreshStatus({ ignoreInstall: true })
  }

  function install(options = {}) {
    if (installPromise) {
      return installPromise
    }

    const config = readConfig()
    installPromise = (
      config.mode === "custom"
        ? installCustomEnvironment()
        : installManagedEnvironment(options)
    )
      .catch((error) => setInstallationError(config, error))
      .finally(() => {
        installPromise = null
      })

    return installPromise
  }

  async function searchPackage(value) {
    if (installPromise) {
      throw new Error(
        "Wait for the current Python package installation to finish before searching packages."
      )
    }

    const request = normalizePackageRequest({ name: value?.query })
    const config = readConfig()
    let inspection

    if (config.mode === "custom") {
      inspection = await inspectPython(config.customExecutable)
    } else {
      const executable =
        readManagedMarker() && isExecutable(managedExecutable())
          ? managedExecutable()
          : bootstrapExecutable
      inspection = await inspectPython(executable, {
        bootstrap: executable === bootstrapExecutable,
      })
    }

    if (!inspection.pipAvailable) {
      throw new Error(
        "The active Python interpreter does not provide pip, so package versions cannot be searched."
      )
    }

    const searchArgs = [
      "-m",
      "pip",
      "index",
      "versions",
      request.name,
      "--disable-pip-version-check",
      "--no-input",
    ]
    const runOptions = {
      env: environmentFor(inspection.executable),
      timeout: PACKAGE_SEARCH_TIMEOUT_MS,
    }
    let result
    let payload

    try {
      result = await runFile(
        inspection.executable,
        [...searchArgs, "--json"],
        runOptions
      )
      payload = JSON.parse(result.stdout)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      if (
        !/no such option:\s*--json|unknown option[^\n]*--json/i.test(message)
      ) {
        if (result) {
          throw new Error(
            `pip returned an invalid package search response: ${result.stdout}`
          )
        }

        throw error
      }

      result = await runFile(inspection.executable, searchArgs, runOptions)
      payload = parsePipIndexText(result.stdout, request.name)
    }

    const versions = Array.isArray(payload?.versions)
      ? payload.versions
          .filter(
            (version) =>
              typeof version === "string" &&
              PYTHON_PACKAGE_VERSION_PATTERN.test(version)
          )
          .slice(0, MAX_PACKAGE_SEARCH_VERSIONS)
      : []
    const name =
      typeof payload?.name === "string" && payload.name.trim()
        ? payload.name.trim()
        : request.name
    const installed = inspection.packages.find(
      (entry) => normalizePackageKey(entry.name) === normalizePackageKey(name)
    )

    if (!versions.length) {
      throw new Error(`No compatible versions were found for ${request.name}.`)
    }

    return {
      name,
      versions,
      latest:
        typeof payload?.latest === "string" && payload.latest.trim()
          ? payload.latest.trim()
          : versions[0],
      installedVersion:
        typeof payload?.installed_version === "string"
          ? payload.installed_version
          : (installed?.version ?? null),
      managedByAstraFlow:
        config.mode === "managed" &&
        requiredPackageNames().has(normalizePackageKey(name)),
    }
  }

  async function rethrowPackageInstallationError(error) {
    const message = error instanceof Error ? error.message : String(error)
    await refreshStatus({
      ignoreInstall: true,
      syncUserPackages: false,
    }).catch(() => null)
    throw new Error(message)
  }

  function installPackage(value) {
    if (installPromise) {
      return installPromise
    }

    const request = normalizePackageRequest(value)
    const config = readConfig()

    installPromise = (async () => {
      let inspection

      if (config.mode === "managed") {
        const key = normalizePackageKey(request.name)

        if (requiredPackageNames().has(key)) {
          throw new Error(
            `${request.name} is managed by AstraFlow and cannot be replaced with a custom version.`
          )
        }

        if (!readManagedMarker() || !isExecutable(managedExecutable())) {
          await installManagedEnvironment()
        }

        inspection = await inspectPython(managedExecutable())
      } else {
        inspection = await inspectPython(config.customExecutable)
      }

      if (!inspection.pipAvailable) {
        throw new Error(
          "The active Python interpreter does not provide pip. Install pip before adding packages."
        )
      }

      const packageSpecifier = request.version
        ? `${request.name}==${request.version}`
        : request.name
      const pipArgs = [
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-cache-dir",
        "--no-input",
        "--prefer-binary",
        ...(config.mode === "managed"
          ? ["--constraint", requirementsPath]
          : []),
        packageSpecifier,
      ]

      updateInstallingStatus(
        config,
        "installing-package",
        `Installing ${packageSpecifier}…`,
        { needsInstall: false }
      )
      await runStreaming(inspection.executable, pipArgs, {
        env: environmentFor(inspection.executable),
        onSpawn: trackInstallChild,
        onOutput: (output) => {
          const detail = output.trim().split(/\r?\n/).at(-1)
          updateInstallingStatus(
            config,
            "installing-package",
            detail || `Installing ${packageSpecifier}…`,
            { needsInstall: false }
          )
        },
      })
      await runFile(inspection.executable, ["-m", "pip", "check"], {
        env: environmentFor(inspection.executable),
        timeout: 120_000,
      })

      if (config.mode === "managed") {
        const nextInspection = await inspectPython(inspection.executable)
        const installed = nextInspection.packages.find(
          (entry) =>
            normalizePackageKey(entry.name) ===
            normalizePackageKey(request.name)
        )

        if (!installed) {
          throw new Error(
            `${request.name} finished installing but was not reported by pip.`
          )
        }

        writeUserPackages([
          ...readUserPackages().filter(
            (entry) =>
              normalizePackageKey(entry.name) !==
              normalizePackageKey(installed.name)
          ),
          installed,
        ])
      }

      return refreshStatus({ ignoreInstall: true })
    })()
      .catch(rethrowPackageInstallationError)
      .finally(() => {
        installPromise = null
      })

    return installPromise
  }

  async function configure(value) {
    if (installPromise) {
      throw new Error(
        "Wait for the current Python package installation to finish before changing interpreters."
      )
    }

    const next = normalizeConfig(value)

    if (next.mode === "custom") {
      const inspection = await inspectPython(next.customExecutable)
      writeConfig(next)
      writeRuntimeState({
        config: next,
        inspection,
        ready: true,
        source: "custom",
      })
      status = createStatus({
        config: next,
        inspection,
        ready: true,
        stage: "ready",
        message: inspection.pipAvailable
          ? "Custom Python is ready."
          : "Custom Python is available, but pip is not installed.",
      })
      return status
    }

    writeConfig(next)
    const nextStatus = await refreshStatus()

    if (nextStatus.needsInstall) {
      void install()
    }

    return nextStatus
  }

  async function ensureManagedEnvironment() {
    const config = readConfig()

    if (config.mode !== "managed") {
      return refreshStatus()
    }

    const current = await refreshStatus()

    if (current.needsInstall && !current.installing) {
      void install()
    }

    return current
  }

  function getActiveProcessEnvironment() {
    const state = readJson(statePath)
    const useConfiguredEnvironment =
      state?.ready && isExecutable(state.executable)
    const executable = useConfiguredEnvironment
      ? state.executable
      : bootstrapExecutable
    const source = useConfiguredEnvironment ? state.source : "bootstrap"

    if (!isExecutable(executable)) {
      return {}
    }

    return {
      ASTRAFLOW_PYTHON_EXECUTABLE: executable,
      ASTRAFLOW_PYTHON_REQUIREMENTS: requirementsPath,
      PATH: `${dirname(executable)}${delimiter}${processEnv.PATH ?? ""}`,
      ...(source === "bootstrap"
        ? {
            PYTHONHOME: bootstrapRoot,
            PYTHONNOUSERSITE: "1",
          }
        : {}),
    }
  }

  function dispose() {
    if (activeInstallChild && !activeInstallChild.killed) {
      activeInstallChild.kill()
    }
  }

  readConfig()
  if (!existsSync(statePath)) {
    writeRuntimeState({
      config: readConfig(),
      ready: isExecutable(bootstrapExecutable),
      source: "bootstrap",
    })
  }

  return {
    bootstrapExecutable,
    bootstrapRoot,
    configPath,
    statePath,
    userPackagesPath,
    configure,
    dispose,
    ensureManagedEnvironment,
    getActiveProcessEnvironment,
    getStatus: refreshStatus,
    install,
    installPackage,
    searchPackage,
  }
}

module.exports = {
  createPythonEnvironmentManager,
}
