import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
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

export class LocalSandboxPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LocalSandboxPathError"
  }
}

export type LocalSandboxPolicy = {
  commandEnv: Record<string, string>
  config: SandboxRuntimeConfig
  rootDir: string
  shell: string
  workspaceDir: string
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

function getAstraFlowPrivatePaths() {
  return uniquePaths([
    process.env.ASTRAFLOW_SQLITE_PATH,
    process.env.ASTRAFLOW_STUDIO_FILES_PATH,
    process.env.ASTRAFLOW_STUDIO_SKILLS_PATH,
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
      `AstraFlow's bundled Python runtime is unavailable at ${pythonRoot}. Command execution is blocked instead of falling back to a system Python.`
    )
  }

  if (!isSameOrDescendant(canonicalRoot, canonicalExecutable)) {
    throw new LocalSandboxPathError(
      `AstraFlow's bundled Python executable resolves outside its runtime: ${canonicalExecutable}`
    )
  }

  return {
    executable: canonicalExecutable,
    root: canonicalRoot,
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
  pythonExecutable,
  pythonRoot,
  sandboxBinaryRoot,
  workspaceDir,
}: {
  pythonExecutable: string
  pythonRoot: string
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
    getPythonBinDirectory(pythonRoot),
    existsSync(sandboxBinaryRoot) ? sandboxBinaryRoot : null,
    inheritedPath || null,
  ].filter((value): value is string => Boolean(value))
  const pathValue = pathParts.join(process.platform === "win32" ? ";" : ":")
  const nodeModulesRoot = getBundledNodeModulesRoot()
  const nodeExecutable =
    process.env.ASTRAFLOW_NODE_EXECUTABLE?.trim() || process.execPath

  return {
    ASTRAFLOW_NODE_EXECUTABLE: nodeExecutable,
    ASTRAFLOW_PYTHON_EXECUTABLE: pythonExecutable,
    ELECTRON_RUN_AS_NODE: "1",
    HOME: sandboxHome,
    LANG: process.env.LANG?.trim() || "C.UTF-8",
    ...(existsSync(nodeModulesRoot) ? { NODE_PATH: nodeModulesRoot } : {}),
    PATH: pathValue,
    ...(process.platform === "win32"
      ? { PATHEXT: process.env.PATHEXT?.trim() || ".COM;.EXE;.BAT;.CMD" }
      : {}),
    PYTHONHOME: pythonRoot,
    PYTHONNOUSERSITE: "1",
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
  rootDir,
  sessionId,
}: {
  rootDir: string
  sessionId: string
}): LocalSandboxPolicy {
  mkdirSync(/* turbopackIgnore: true */ rootDir, { recursive: true })

  const canonicalRoot = canonicalizeExistingPath(rootDir)
  const workspaceDir = ensureLocalSandboxWorkspace(sessionId)
  const userHome = canonicalizeExistingPath(homedir())
  const pythonRuntime = requireBundledPythonRuntime(getPythonRuntimeRoot())
  const pythonRoot = pythonRuntime.root
  const sandboxBinaryRoot = getSandboxBinaryRoot()
  const nodeModulesRoot = getBundledNodeModulesRoot()
  const nodeExecutable =
    process.env.ASTRAFLOW_NODE_EXECUTABLE?.trim() || process.execPath
  const sensitivePaths = uniquePaths([
    ...getHomeSensitivePaths(userHome),
    ...getAstraFlowPrivatePaths(),
    join(canonicalRoot, ".env"),
    join(canonicalRoot, ".env.*"),
    join(canonicalRoot, "**", ".env"),
    join(canonicalRoot, "**", ".env.*"),
  ])
  const allowRead = uniquePaths([
    canonicalRoot,
    workspaceDir,
    existsSync(pythonRoot) ? pythonRoot : null,
    existsSync(nodeModulesRoot) ? nodeModulesRoot : null,
    existsSync(nodeExecutable) ? nodeExecutable : null,
    process.platform === "win32" ? userHome : null,
    process.platform === "win32" ? process.cwd() : null,
  ])
  const allowWrite = uniquePaths([canonicalRoot, workspaceDir])
  const denyWrite = getProtectedWritePaths({
    rootDir: canonicalRoot,
    sensitivePaths,
    userHome,
    workspaceDir,
  })
  const bwrapPath =
    resolveSystemBinary("bwrap") ??
    resolveBundledBinary(sandboxBinaryRoot, "bwrap") ??
    resolvePythonSupportBinary(pythonRoot, "bwrap")
  const socatPath = resolveBundledBinary(sandboxBinaryRoot, "socat")
  const ripgrepPath =
    resolveBundledBinary(sandboxBinaryRoot, "rg") ??
    resolvePythonSupportBinary(pythonRoot, "rg")
  const commandEnv = getRunnerEnvironment({
    pythonExecutable: pythonRuntime.executable,
    pythonRoot,
    sandboxBinaryRoot,
    workspaceDir,
  })

  const config: SandboxRuntimeConfig = {
    network: {
      allowedDomains: [],
      deniedDomains: ["*"],
      strictAllowlist: true,
      allowUnixSockets: [],
      allowAllUnixSockets: false,
      allowLocalBinding: false,
      allowMachLookup: [],
    },
    filesystem: {
      denyRead: sensitivePaths,
      allowRead,
      allowWrite,
      denyWrite,
      allowGitConfig: false,
    },
    credentials: {
      envVars: getSensitiveEnvironmentNames().map((name) => ({
        mode: "deny" as const,
        name,
      })),
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
  }

  return {
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

  return isAbsolute(inputPath) ? resolve(inputPath) : resolve(rootDir, inputPath)
}

function assertNotSensitive(path: string) {
  const userHome = canonicalizeExistingPath(homedir())
  const sensitivePaths = [
    ...getHomeSensitivePaths(userHome),
    ...getAstraFlowPrivatePaths(),
  ]

  if (sensitivePaths.some((deniedPath) => isSameOrDescendant(deniedPath, path))) {
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

  const workspaceRelative = relative(getSandboxWorkspaceRoot(), path)
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

export function resolveLocalSandboxReadPath(rootDir: string, inputPath: string) {
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
