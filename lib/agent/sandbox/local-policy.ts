import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
} from "node:fs"
import { homedir } from "node:os"
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path"

import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime"

import { getAcpStateMasterKeyPath } from "@/lib/agent/sandbox/state-key"
import { safeFileName } from "@/lib/studio-file-storage"

const DEFAULT_SANDBOX_ROOT_DIRECTORY = ".data"
const DEFAULT_SANDBOX_ROOT_NAME = "sandbox-workspaces"
const BUNDLED_RUNTIME_ROOT_NAME = "runtime"
const SECRET_ENV_NAME_PATTERN =
  /(?:^|_)(?:API_?KEY|AUTH|COOKIE|CREDENTIAL|PASSWORD|PRIVATE_?KEY|SECRET|TOKEN)(?:_|$)/i
const SHELL_STARTUP_FILES = [
  ".bash_profile",
  ".bashrc",
  ".gitconfig",
  ".git-credentials",
  ".profile",
  ".zprofile",
  ".zshrc",
]
const PYTHON_PACKAGE_NETWORK_ENDPOINTS = [
  { host: "pypi.org", port: 443 },
  { host: "files.pythonhosted.org", port: 443 },
]
const NPM_PACKAGE_NETWORK_ENDPOINTS = [
  { host: "registry.npmjs.org", port: 443 },
]

export class LocalSandboxPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LocalSandboxPathError"
  }
}

export type LocalSandboxPolicy = {
  allowedNetworkEndpoints: LocalSandboxNetworkEndpoint[]
  commandEnv: Record<string, string>
  config: SandboxRuntimeConfig
  rootDir: string
  shell: string
  workspaceDir: string
}

export type LocalSandboxMaskedEnvironmentVariable = {
  injectHosts: string[]
  name: string
}

export type LocalSandboxNetworkEndpoint = {
  host: string
  port: number
}

export type CreateLocalSandboxPolicyOptions = {
  additionalAllowedDomains?: string[]
  additionalAllowedNetworkEndpoints?: LocalSandboxNetworkEndpoint[]
  additionalReadRoots?: string[]
  additionalWriteRoots?: string[]
  maskedEnvironmentVariables?: LocalSandboxMaskedEnvironmentVariable[]
  passthroughEnvironmentVariables?: string[]
  rootDir: string
  sessionId: string
}

function getSandboxWorkspaceRoot() {
  const configured = process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH?.trim()

  if (configured) {
    return resolve(configured)
  }

  const studioFilesRoot = process.env.ASTRAFLOW_STUDIO_FILES_PATH?.trim()

  if (studioFilesRoot) {
    return join(dirname(studioFilesRoot), DEFAULT_SANDBOX_ROOT_NAME)
  }

  return join(
    process.cwd(),
    DEFAULT_SANDBOX_ROOT_DIRECTORY,
    DEFAULT_SANDBOX_ROOT_NAME
  )
}

function canonicalizeExistingPath(path: string) {
  return realpathSync.native(resolve(path))
}

function getWindowsSrtWinPath() {
  const configured = process.env.ASTRAFLOW_SRT_WIN_PATH?.trim()

  if (!configured) {
    return null
  }

  if (!isAbsolute(configured) || !existsSync(configured)) {
    throw new Error(
      `ASTRAFLOW_SRT_WIN_PATH must point to an existing absolute path: ${configured}`
    )
  }

  return canonicalizeExistingPath(configured)
}

function canonicalizeWorkspaceRoot(path: string) {
  const absolutePath = resolve(path)
  let stats

  try {
    stats = lstatSync(absolutePath)
  } catch {
    throw new LocalSandboxPathError(
      `The selected workspace is unavailable: ${absolutePath}`
    )
  }

  if (stats.isSymbolicLink()) {
    throw new LocalSandboxPathError(
      `The selected workspace cannot be a symbolic link: ${absolutePath}`
    )
  }

  if (!stats.isDirectory()) {
    throw new LocalSandboxPathError(
      `The selected workspace is not a directory: ${absolutePath}`
    )
  }

  try {
    return canonicalizeExistingPath(absolutePath)
  } catch {
    throw new LocalSandboxPathError(
      `The selected workspace is unavailable: ${absolutePath}`
    )
  }
}

function canonicalizePathWithMissingLeaf(path: string) {
  const absolutePath = resolve(path)
  const suffix: string[] = []
  let cursor = absolutePath

  while (!existsSync(cursor)) {
    const parent = dirname(cursor)

    if (parent === cursor) {
      throw new LocalSandboxPathError(`Path is not reachable: ${absolutePath}`)
    }

    suffix.unshift(basename(cursor))
    cursor = parent
  }

  const existingRoot = canonicalizeExistingPath(cursor)

  return resolve(existingRoot, ...suffix)
}

function normalizeForComparison(path: string) {
  const normalized = resolve(path).replace(/[\\/]+$/, "")

  return process.platform === "win32" || process.platform === "darwin"
    ? normalized.toLocaleLowerCase("en-US")
    : normalized
}

function isSameOrDescendant(parent: string, candidate: string) {
  const normalizedParent = normalizeForComparison(parent)
  const normalizedCandidate = normalizeForComparison(candidate)
  const pathRelative = relative(normalizedParent, normalizedCandidate)

  return (
    pathRelative === "" ||
    (!pathRelative.startsWith(`..${sep}`) &&
      pathRelative !== ".." &&
      !isAbsolute(pathRelative))
  )
}

function uniquePaths(paths: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const rawPath of paths) {
    const trimmed = rawPath?.trim()

    if (!trimmed) {
      continue
    }

    const absolutePath = resolve(trimmed)
    const key = normalizeForComparison(absolutePath)

    if (!seen.has(key)) {
      seen.add(key)
      result.push(absolutePath)
    }
  }

  return result
}

function canonicalizeAdditionalRoots(paths: string[] | undefined) {
  return uniquePaths(
    (paths ?? []).map((path) => canonicalizeExistingPath(path))
  )
}

function normalizeNetworkDomains(domains: string[] | undefined) {
  const result: string[] = []
  const seen = new Set<string>()

  for (const value of domains ?? []) {
    const domain = value.trim().toLocaleLowerCase("en-US")

    if (
      !domain ||
      domain.includes("/") ||
      domain.includes("\\") ||
      domain.includes("@") ||
      /\s/.test(domain)
    ) {
      throw new LocalSandboxPathError(
        `Invalid AstraFlow sandbox network domain: ${value}`
      )
    }

    if (!seen.has(domain)) {
      seen.add(domain)
      result.push(domain)
    }
  }

  return result
}

function normalizeNetworkEndpoints(
  endpoints: LocalSandboxNetworkEndpoint[] | undefined
) {
  const result: LocalSandboxNetworkEndpoint[] = []
  const seen = new Set<string>()

  for (const endpoint of endpoints ?? []) {
    const [host] = normalizeNetworkDomains([endpoint.host])

    if (
      !host ||
      host.includes("*") ||
      !Number.isInteger(endpoint.port) ||
      endpoint.port < 1 ||
      endpoint.port > 65_535
    ) {
      throw new LocalSandboxPathError(
        `Invalid AstraFlow sandbox network endpoint: ${endpoint.host}:${endpoint.port}`
      )
    }

    const key = JSON.stringify([host, endpoint.port])

    if (!seen.has(key)) {
      seen.add(key)
      result.push({ host, port: endpoint.port })
    }
  }

  return result
}

function getHomeSensitivePaths(userHome: string) {
  return uniquePaths([
    join(userHome, ".aws"),
    join(userHome, ".azure"),
    join(userHome, ".config", "gcloud"),
    join(userHome, ".config", "google-chrome"),
    join(userHome, ".config", "chromium"),
    join(userHome, ".docker", "config.json"),
    join(userHome, ".git-credentials"),
    join(userHome, ".gnupg"),
    join(userHome, ".kube"),
    join(userHome, ".local", "share", "keyrings"),
    join(userHome, ".mozilla"),
    join(userHome, ".netrc"),
    join(userHome, ".npmrc"),
    join(userHome, ".pypirc"),
    join(userHome, ".ssh"),
    join(userHome, "Library", "Application Support", "Google", "Chrome"),
    join(userHome, "Library", "Application Support", "Firefox"),
    join(userHome, "Library", "Keychains"),
    join(userHome, "Library", "Safari"),
  ])
}

function getAstraFlowDatabasePaths() {
  const sqlitePath = process.env.ASTRAFLOW_SQLITE_PATH?.trim()

  return uniquePaths([
    sqlitePath,
    sqlitePath ? `${resolve(sqlitePath)}-journal` : null,
    sqlitePath ? `${resolve(sqlitePath)}-shm` : null,
    sqlitePath ? `${resolve(sqlitePath)}-wal` : null,
  ])
}

function getAstraFlowProtectedWritePaths() {
  return uniquePaths([
    getAcpStateMasterKeyPath(),
    ...getAstraFlowDatabasePaths(),
    process.env.ASTRAFLOW_STUDIO_FILES_PATH,
    process.env.ASTRAFLOW_STUDIO_SKILLS_PATH,
  ])
}

function getAstraFlowPrivatePaths() {
  const userDataRoot = process.env.ASTRAFLOW_USER_DATA_PATH?.trim()
  const sqlitePath = process.env.ASTRAFLOW_SQLITE_PATH?.trim()
  const configuredAttachmentRoot =
    process.env.ASTRAFLOW_ACP_ATTACHMENTS_PATH?.trim()
  const attachmentRoot = configuredAttachmentRoot
    ? resolve(configuredAttachmentRoot)
    : userDataRoot
      ? join(resolve(userDataRoot), "acp-attachments")
      : sqlitePath
        ? join(dirname(resolve(sqlitePath)), "..", "acp-attachments")
        : join(process.cwd(), ".data", "acp-attachments")

  return uniquePaths([
    userDataRoot,
    attachmentRoot,
    ...getAstraFlowProtectedWritePaths(),
  ])
}

function getBundledRuntimeRoot() {
  return resolve(
    /* turbopackIgnore: true */ process.cwd(),
    BUNDLED_RUNTIME_ROOT_NAME
  )
}

function getBundledSkillsRoot() {
  const configured = process.env.ASTRAFLOW_BUNDLED_SKILLS_PATH?.trim()

  return configured
    ? resolve(configured)
    : join(/* turbopackIgnore: true */ process.cwd(), "bundled-skills")
}

function getPythonRuntimeRoot() {
  const configured = process.env.ASTRAFLOW_BUNDLED_PYTHON_ROOT?.trim()

  if (configured) {
    return resolve(configured)
  }

  const packagedRoot = join(
    /* turbopackIgnore: true */
    getBundledRuntimeRoot(),
    "python",
    `${process.platform}-${process.arch}`
  )
  const developmentRoot = join(
    /* turbopackIgnore: true */
    getBundledRuntimeRoot(),
    "python",
    "distributions",
    `${process.platform}-${process.arch}`
  )

  return existsSync(packagedRoot) ? packagedRoot : developmentRoot
}

function getBundledNodeModulesRoot() {
  const configured = process.env.ASTRAFLOW_BUNDLED_NODE_MODULES?.trim()

  return configured
    ? resolve(configured)
    : join(/* turbopackIgnore: true */ process.cwd(), "node_modules")
}

function getSandboxBinaryRoot() {
  const configured = process.env.ASTRAFLOW_SANDBOX_BIN_PATH?.trim()

  if (configured) {
    return resolve(configured)
  }

  return join(
    /* turbopackIgnore: true */
    getBundledRuntimeRoot(),
    "sandbox",
    `${process.platform}-${process.arch}`,
    "bin"
  )
}

function getPythonBinDirectory(pythonRoot: string) {
  return process.platform === "win32" ? pythonRoot : join(pythonRoot, "bin")
}

function getPythonExecutablePath(pythonRoot: string) {
  return process.platform === "win32"
    ? join(pythonRoot, "python.exe")
    : join(pythonRoot, "bin", "python3")
}

function requireBundledPythonRuntime(pythonRoot: string) {
  let canonicalRoot: string
  let canonicalExecutable: string

  try {
    canonicalRoot = canonicalizeExistingPath(pythonRoot)
    const executable = getPythonExecutablePath(canonicalRoot)
    accessSync(executable, constants.X_OK)
    canonicalExecutable = canonicalizeExistingPath(executable)
  } catch {
    throw new LocalSandboxPathError(
      `AstraFlow's managed Python runtime is unavailable at ${pythonRoot}. Use the astraflow_environment installer; command execution is blocked instead of falling back to a system Python.`
    )
  }

  if (!isSameOrDescendant(canonicalRoot, canonicalExecutable)) {
    throw new LocalSandboxPathError(
      `AstraFlow's managed Python executable resolves outside its runtime: ${canonicalExecutable}`
    )
  }

  return {
    executable: canonicalExecutable,
    isolated: true,
    packageWriteRoots: [],
    pythonHome: canonicalRoot,
    pythonUserBase: null,
    readRoots: [canonicalRoot],
    root: canonicalRoot,
  }
}

function resolveConfiguredPythonRuntime(pythonRoot: string) {
  const fallback = requireBundledPythonRuntime(pythonRoot)
  const statePath = process.env.ASTRAFLOW_PYTHON_STATE_PATH?.trim()

  if (!statePath || !existsSync(statePath)) {
    return fallback
  }

  try {
    const state = JSON.parse(readFileSync(statePath, "utf8")) as {
      source?: string
      ready?: boolean
      executable?: string
      roots?: string[]
      packageWriteRoots?: string[]
      isolated?: boolean
      pythonUserBase?: string | null
    }

    if (
      !state.ready ||
      state.source === "bootstrap" ||
      typeof state.executable !== "string" ||
      !state.executable.trim()
    ) {
      return fallback
    }

    const executable = resolve(state.executable.trim())
    accessSync(executable, constants.X_OK)
    const canonicalExecutable = canonicalizeExistingPath(executable)
    const readRoots = uniquePaths([
      canonicalExecutable,
      dirname(canonicalExecutable),
      ...(Array.isArray(state.roots)
        ? state.roots.map((root) => {
            try {
              return canonicalizeExistingPath(root)
            } catch {
              return null
            }
          })
        : []),
    ])
    const root =
      readRoots.find((candidate) =>
        isSameOrDescendant(candidate, canonicalExecutable)
      ) ?? dirname(canonicalExecutable)
    const packageWriteRoots =
      state.source === "managed" && Array.isArray(state.packageWriteRoots)
        ? uniquePaths(
            state.packageWriteRoots.map((candidate) => {
              try {
                const canonical = canonicalizeExistingPath(candidate)

                return basename(canonical).startsWith("managed-") &&
                  basename(dirname(canonical)) === "python-environments" &&
                  isSameOrDescendant(canonical, canonicalExecutable)
                  ? canonical
                  : null
              } catch {
                return null
              }
            })
          )
        : []

    return {
      executable: canonicalExecutable,
      isolated: Boolean(state.isolated),
      packageWriteRoots,
      pythonHome: null,
      pythonUserBase:
        typeof state.pythonUserBase === "string" ? state.pythonUserBase : null,
      readRoots,
      root,
    }
  } catch {
    return fallback
  }
}

function resolveBundledBinary(binaryRoot: string, name: string) {
  const fileName = process.platform === "win32" ? `${name}.exe` : name
  const path = join(binaryRoot, fileName)

  return existsSync(path) ? path : null
}

function resolveSystemBinary(name: string) {
  if (process.platform !== "linux") {
    return null
  }

  for (const directory of ["/usr/bin", "/bin", "/usr/local/bin"]) {
    const path = join(/* turbopackIgnore: true */ directory, name)

    try {
      accessSync(path, constants.X_OK)
      return path
    } catch {
      // Try the next trusted system binary directory.
    }
  }

  return null
}

function resolvePythonSupportBinary(pythonRoot: string, name: "bwrap" | "rg") {
  const path =
    name === "bwrap"
      ? join(
          pythonRoot,
          "lib",
          "python3.12",
          "site-packages",
          "bubblewrap_bin",
          "_bin",
          "bwrap"
        )
      : join(getPythonBinDirectory(pythonRoot), "rg")

  return existsSync(path) ? path : null
}

function getShell() {
  if (process.platform === "win32") {
    return process.env.ComSpec?.trim() || "cmd.exe"
  }

  return existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh"
}

function getRunnerEnvironment({
  developerNodeExecutable,
  npmCache,
  npmPrefix,
  pythonExecutable,
  pythonHome,
  pythonIsolated,
  pythonUserBase,
  sandboxBinaryRoot,
  workspaceDir,
}: {
  developerNodeExecutable: string | null
  npmCache: string | null
  npmPrefix: string | null
  pythonExecutable: string
  pythonHome: string | null
  pythonIsolated: boolean
  pythonUserBase: string | null
  sandboxBinaryRoot: string
  workspaceDir: string
}) {
  const sandboxHome = join(workspaceDir, "home")
  const cacheDir = join(workspaceDir, "cache")
  const tempDir = join(workspaceDir, "tmp")

  for (const directory of [sandboxHome, cacheDir, tempDir]) {
    mkdirSync(/* turbopackIgnore: true */ directory, { recursive: true })
  }

  const inheritedPath = process.env.PATH?.trim() || ""
  const pathParts = [
    dirname(pythonExecutable),
    existsSync(sandboxBinaryRoot) ? sandboxBinaryRoot : null,
    developerNodeExecutable ? dirname(developerNodeExecutable) : null,
    npmPrefix
      ? process.platform === "win32"
        ? npmPrefix
        : join(npmPrefix, "bin")
      : null,
    inheritedPath || null,
  ].filter((value): value is string => Boolean(value))
  const pathValue = pathParts.join(process.platform === "win32" ? ";" : ":")
  const nodeModulesRoot = getBundledNodeModulesRoot()
  const nodeExecutable =
    process.env.ASTRAFLOW_NODE_EXECUTABLE?.trim() || process.execPath

  return {
    ASTRAFLOW_NODE_EXECUTABLE: nodeExecutable,
    ...(developerNodeExecutable
      ? { ASTRAFLOW_DEVELOPER_NODE_EXECUTABLE: developerNodeExecutable }
      : {}),
    ASTRAFLOW_PYTHON_EXECUTABLE: pythonExecutable,
    ELECTRON_RUN_AS_NODE: "1",
    HOME: sandboxHome,
    LANG: process.env.LANG?.trim() || "C.UTF-8",
    ...(existsSync(nodeModulesRoot) ? { NODE_PATH: nodeModulesRoot } : {}),
    PATH: pathValue,
    ...(process.platform === "win32"
      ? { PATHEXT: process.env.PATHEXT?.trim() || ".COM;.EXE;.BAT;.CMD" }
      : {}),
    ...(pythonHome ? { PYTHONHOME: pythonHome } : {}),
    ...(pythonIsolated ? { PYTHONNOUSERSITE: "1" } : {}),
    ...(pythonUserBase ? { PYTHONUSERBASE: pythonUserBase } : {}),
    ...(npmCache
      ? {
          ASTRAFLOW_NPM_CACHE: npmCache,
          NPM_CONFIG_CACHE: npmCache,
        }
      : {}),
    ...(npmPrefix
      ? {
          ASTRAFLOW_NPM_PREFIX: npmPrefix,
          NPM_CONFIG_PREFIX: npmPrefix,
          NPM_CONFIG_UPDATE_NOTIFIER: "false",
          NPM_CONFIG_USERCONFIG: join(sandboxHome, ".npmrc"),
        }
      : {}),
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    PIP_NO_INPUT: "1",
    PYTHONPYCACHEPREFIX: join(cacheDir, "python"),
    TEMP: tempDir,
    TMP: tempDir,
    TMPDIR: tempDir,
    USERPROFILE: sandboxHome,
    XDG_CACHE_HOME: cacheDir,
    XDG_CONFIG_HOME: join(sandboxHome, ".config"),
  }
}

function getSensitiveEnvironmentNames() {
  return Object.keys(process.env)
    .filter((name) => SECRET_ENV_NAME_PATTERN.test(name))
    .sort()
}

function getProtectedWritePaths({
  rootDir,
  sensitivePaths,
  userHome,
  workspaceDir,
}: {
  rootDir: string
  sensitivePaths: string[]
  userHome: string
  workspaceDir: string
}) {
  return uniquePaths([
    ...sensitivePaths,
    ...SHELL_STARTUP_FILES.map((name) =>
      join(/* turbopackIgnore: true */ userHome, name)
    ),
    join(userHome, ".config", "fish", "config.fish"),
    join(rootDir, ".git", "config"),
    join(rootDir, ".git", "hooks"),
    join(rootDir, ".env"),
    join(rootDir, ".env.*"),
    join(workspaceDir, "skills"),
    getBundledSkillsRoot(),
    getBundledNodeModulesRoot(),
    process.env.ASTRAFLOW_STUDIO_SKILLS_PATH,
    process.env.ASTRAFLOW_DEVELOPER_RUNTIME_ROOT,
    getBundledRuntimeRoot(),
  ])
}

export function ensureLocalSandboxWorkspace(sessionId: string) {
  const workspaceDir = join(
    /* turbopackIgnore: true */ getSandboxWorkspaceRoot(),
    safeFileName(sessionId)
  )

  mkdirSync(/* turbopackIgnore: true */ workspaceDir, { recursive: true })

  return canonicalizeExistingPath(workspaceDir)
}

export function createLocalSandboxPolicy({
  additionalAllowedDomains,
  additionalAllowedNetworkEndpoints,
  additionalReadRoots,
  additionalWriteRoots,
  maskedEnvironmentVariables = [],
  passthroughEnvironmentVariables = [],
  rootDir,
  sessionId,
}: CreateLocalSandboxPolicyOptions): LocalSandboxPolicy {
  const canonicalRoot = canonicalizeWorkspaceRoot(rootDir)
  const workspaceDir = ensureLocalSandboxWorkspace(sessionId)
  const trustedReadRoots = canonicalizeAdditionalRoots(additionalReadRoots)
  const trustedWriteRoots = canonicalizeAdditionalRoots(additionalWriteRoots)
  const userHome = canonicalizeExistingPath(homedir())
  const bundledPythonRoot = getPythonRuntimeRoot()
  const pythonRuntime = resolveConfiguredPythonRuntime(bundledPythonRoot)
  const sandboxBinaryRoot = getSandboxBinaryRoot()
  const nodeModulesRoot = getBundledNodeModulesRoot()
  const hostNodeExecutable =
    process.env.ASTRAFLOW_NODE_EXECUTABLE?.trim() || process.execPath
  const configuredDeveloperNodeExecutable =
    process.env.ASTRAFLOW_DEVELOPER_NODE_EXECUTABLE?.trim() || null
  const developerNodeExecutable =
    configuredDeveloperNodeExecutable &&
    existsSync(/* turbopackIgnore: true */ configuredDeveloperNodeExecutable)
      ? canonicalizeExistingPath(configuredDeveloperNodeExecutable)
      : null
  const developerNodeRoot =
    developerNodeExecutable && process.env.ASTRAFLOW_DEVELOPER_NODE_ROOT?.trim()
      ? canonicalizeExistingPath(process.env.ASTRAFLOW_DEVELOPER_NODE_ROOT)
      : null
  const npmPrefix = process.env.ASTRAFLOW_NPM_PREFIX?.trim() || null
  const npmCache = process.env.ASTRAFLOW_NPM_CACHE?.trim() || null

  for (const directory of [npmPrefix, npmCache]) {
    if (directory) {
      mkdirSync(/* turbopackIgnore: true */ directory, { recursive: true })
    }
  }
  const pythonRequirementsPath =
    process.env.ASTRAFLOW_PYTHON_REQUIREMENTS?.trim() ||
    join(getBundledRuntimeRoot(), "python", "requirements.lock")
  const protectedWritePaths = uniquePaths([
    ...getHomeSensitivePaths(userHome),
    ...getAstraFlowProtectedWritePaths(),
    join(canonicalRoot, ".env"),
    join(canonicalRoot, ".env.*"),
    join(canonicalRoot, "**", ".env"),
    join(canonicalRoot, "**", ".env.*"),
  ])
  const deniedReadPaths = uniquePaths([
    userHome,
    getSandboxWorkspaceRoot(),
    process.env.ASTRAFLOW_MANAGED_WORKSPACES_PATH?.trim() ||
      join(userHome, "AstraFlow"),
    ...protectedWritePaths,
    ...getAstraFlowPrivatePaths(),
  ])
  const pythonPackageInstallEnabled = pythonRuntime.packageWriteRoots.length > 0
  const npmPackageInstallEnabled = Boolean(
    developerNodeExecutable && npmPrefix && npmCache
  )
  const packageEndpoints = pythonPackageInstallEnabled
    ? [
        ...PYTHON_PACKAGE_NETWORK_ENDPOINTS,
        ...(npmPackageInstallEnabled ? NPM_PACKAGE_NETWORK_ENDPOINTS : []),
      ]
    : npmPackageInstallEnabled
      ? NPM_PACKAGE_NETWORK_ENDPOINTS
      : []
  const allowedDomains = normalizeNetworkDomains(additionalAllowedDomains)
  const allowedNetworkEndpoints = normalizeNetworkEndpoints([
    ...packageEndpoints,
    ...(additionalAllowedNetworkEndpoints ?? []),
  ])
  const allowRead = uniquePaths([
    canonicalRoot,
    workspaceDir,
    ...trustedReadRoots,
    ...trustedWriteRoots,
    ...pythonRuntime.readRoots,
    existsSync(/* turbopackIgnore: true */ pythonRequirementsPath)
      ? pythonRequirementsPath
      : null,
    existsSync(/* turbopackIgnore: true */ bundledPythonRoot)
      ? bundledPythonRoot
      : null,
    existsSync(/* turbopackIgnore: true */ nodeModulesRoot)
      ? nodeModulesRoot
      : null,
    developerNodeRoot,
    developerNodeExecutable,
    npmPrefix,
    npmCache,
    existsSync(/* turbopackIgnore: true */ hostNodeExecutable)
      ? hostNodeExecutable
      : null,
  ])
  const allowWrite = uniquePaths([
    canonicalRoot,
    workspaceDir,
    ...trustedWriteRoots,
    ...pythonRuntime.packageWriteRoots,
    npmPackageInstallEnabled ? npmPrefix : null,
    npmPackageInstallEnabled ? npmCache : null,
  ])
  const readOnlyPythonRoots = pythonRuntime.readRoots.filter(
    (readRoot) =>
      !pythonRuntime.packageWriteRoots.some((writeRoot) =>
        isSameOrDescendant(writeRoot, readRoot)
      )
  )
  const denyWrite = uniquePaths([
    ...getProtectedWritePaths({
      rootDir: canonicalRoot,
      sensitivePaths: protectedWritePaths,
      userHome,
      workspaceDir,
    }),
    ...readOnlyPythonRoots,
  ])
  const bwrapPath =
    resolveSystemBinary("bwrap") ??
    resolveBundledBinary(sandboxBinaryRoot, "bwrap") ??
    resolvePythonSupportBinary(bundledPythonRoot, "bwrap")
  const socatPath = resolveBundledBinary(sandboxBinaryRoot, "socat")
  const ripgrepPath =
    resolveBundledBinary(sandboxBinaryRoot, "rg") ??
    resolvePythonSupportBinary(bundledPythonRoot, "rg")
  const srtWinPath = getWindowsSrtWinPath()
  const commandEnv: Record<string, string> = getRunnerEnvironment({
    developerNodeExecutable,
    npmCache: npmPackageInstallEnabled ? npmCache : null,
    npmPrefix: npmPackageInstallEnabled ? npmPrefix : null,
    pythonExecutable: pythonRuntime.executable,
    pythonHome: pythonRuntime.pythonHome,
    pythonIsolated: pythonRuntime.isolated,
    pythonUserBase: pythonRuntime.pythonUserBase,
    sandboxBinaryRoot,
    workspaceDir,
  })
  if (existsSync(/* turbopackIgnore: true */ pythonRequirementsPath)) {
    commandEnv.ASTRAFLOW_PYTHON_REQUIREMENTS = pythonRequirementsPath
  }

  const passthroughNames = new Set(passthroughEnvironmentVariables)
  const maskedNames = new Set(
    maskedEnvironmentVariables.map(({ name }) => name)
  )
  const credentialEnvironmentVariables = [
    ...getSensitiveEnvironmentNames()
      .filter((name) => !passthroughNames.has(name) && !maskedNames.has(name))
      .map((name) => ({
        mode: "deny" as const,
        name,
      })),
    ...maskedEnvironmentVariables.map(({ injectHosts, name }) => ({
      injectHosts: normalizeNetworkDomains(injectHosts),
      mode: "mask" as const,
      name,
    })),
  ]
  const config: SandboxRuntimeConfig = {
    network: {
      allowedDomains,
      deniedDomains:
        allowedDomains.length > 0 || allowedNetworkEndpoints.length > 0
          ? []
          : ["*"],
      strictAllowlist: allowedNetworkEndpoints.length === 0,
      allowUnixSockets: [],
      allowAllUnixSockets: false,
      allowLocalBinding: false,
      allowMachLookup: [],
      ...(maskedEnvironmentVariables.length > 0 ? { tlsTerminate: {} } : {}),
    },
    filesystem: {
      denyRead: deniedReadPaths,
      allowRead,
      allowWrite,
      denyWrite,
      allowGitConfig: false,
    },
    credentials: {
      envVars: credentialEnvironmentVariables,
    },
    allowAppleEvents: false,
    allowPty: false,
    enableWeakerNestedSandbox: false,
    enableWeakerNetworkIsolation: false,
    mandatoryDenySearchDepth: 5,
    ripgrep: {
      command: ripgrepPath ?? "rg",
    },
    ...(bwrapPath ? { bwrapPath } : {}),
    ...(socatPath ? { socatPath } : {}),
    ...(srtWinPath
      ? {
          windows: {
            srtWin: {
              path: srtWinPath,
            },
          },
        }
      : {}),
  }

  return {
    allowedNetworkEndpoints,
    commandEnv,
    config,
    rootDir: canonicalRoot,
    shell: getShell(),
    workspaceDir,
  }
}

function resolveInputPath(rootDir: string, inputPath: string) {
  if (!inputPath || inputPath.includes("\0")) {
    throw new LocalSandboxPathError("Path is empty or invalid.")
  }

  return isAbsolute(inputPath)
    ? resolve(inputPath)
    : resolve(rootDir, inputPath)
}

function assertNotSensitive(path: string) {
  const userHome = canonicalizeExistingPath(homedir())
  const sensitivePaths = [
    ...getHomeSensitivePaths(userHome),
    ...getAstraFlowPrivatePaths(),
  ]

  if (
    sensitivePaths.some((deniedPath) => isSameOrDescendant(deniedPath, path))
  ) {
    throw new LocalSandboxPathError(
      `Access denied by the AstraFlow sensitive-file policy: ${path}`
    )
  }

  const fileName = basename(path).toLocaleLowerCase("en-US")

  if (fileName === ".env" || fileName.startsWith(".env.")) {
    throw new LocalSandboxPathError(
      `Access to environment secret files requires an explicit permission flow: ${path}`
    )
  }
}

function assertNotProtectedWrite(path: string, allowedWriteRoots: string[]) {
  assertNotSensitive(path)

  const normalizedSegments = relative(parse(path).root, path)
    .split(sep)
    .map((segment) => segment.toLocaleLowerCase("en-US"))
  const fileName = normalizedSegments.at(-1) ?? ""
  const gitIndex = normalizedSegments.lastIndexOf(".git")

  if (
    fileName === ".env" ||
    fileName.startsWith(".env.") ||
    (gitIndex >= 0 &&
      ["config", "hooks"].includes(normalizedSegments[gitIndex + 1] ?? ""))
  ) {
    throw new LocalSandboxPathError(
      `Write denied for protected project configuration: ${path}`
    )
  }

  const userHome = canonicalizeExistingPath(homedir())

  if (
    isSameOrDescendant(userHome, path) &&
    SHELL_STARTUP_FILES.includes(fileName)
  ) {
    throw new LocalSandboxPathError(
      `Write denied for protected shell or Git configuration: ${path}`
    )
  }

  const protectedRoots = uniquePaths([
    getBundledSkillsRoot(),
    getBundledNodeModulesRoot(),
    process.env.ASTRAFLOW_STUDIO_SKILLS_PATH,
    getBundledRuntimeRoot(),
  ])

  const workspaceRelative = relative(
    canonicalizePathWithMissingLeaf(getSandboxWorkspaceRoot()),
    path
  )
    .split(sep)
    .map((segment) => segment.toLocaleLowerCase("en-US"))
  const isSessionSkillPath =
    workspaceRelative.length >= 2 && workspaceRelative[1] === "skills"

  if (
    isSessionSkillPath ||
    protectedRoots.some((item) => isSameOrDescendant(item, path))
  ) {
    throw new LocalSandboxPathError(
      `Write denied for an AstraFlow-managed read-only path: ${path}`
    )
  }

  if (!allowedWriteRoots.some((root) => isSameOrDescendant(root, path))) {
    throw new LocalSandboxPathError(
      `Write denied outside the selected project or session workspace: ${path}`
    )
  }
}

export function resolveLocalSandboxReadPath(
  rootDir: string,
  inputPath: string
) {
  const absolutePath = resolveInputPath(rootDir, inputPath)
  const canonicalPath = canonicalizeExistingPath(absolutePath)

  assertNotSensitive(canonicalPath)

  return canonicalPath
}

export function resolveLocalSandboxWritePath(
  rootDir: string,
  inputPath: string,
  additionalWriteRoots: string[] = []
) {
  const canonicalRoot = canonicalizeExistingPath(rootDir)
  const absolutePath = resolveInputPath(canonicalRoot, inputPath)
  const canonicalPath = canonicalizePathWithMissingLeaf(absolutePath)
  const allowedWriteRoots = [canonicalRoot, ...additionalWriteRoots].map(
    canonicalizeExistingPath
  )

  assertNotProtectedWrite(canonicalPath, allowedWriteRoots)

  return canonicalPath
}
