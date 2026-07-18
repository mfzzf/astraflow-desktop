import { createHash } from "node:crypto"
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { spawnSync } from "node:child_process"
import { delimiter, dirname, isAbsolute, join, relative, sep } from "node:path"
import { pipeline } from "node:stream/promises"
import { c as createTar } from "tar"

const root = process.cwd()
const appDir = join(root, "dist", "electron-app")
const standaloneDir = join(root, ".next", "standalone")
const runtimeTarget = `${process.platform}-${process.arch}`
const nativeRuntimeMacCompressionLevel = 1
const forcedRuntimeDependencies = [
  "@agentclientprotocol/claude-agent-acp",
  "@agentclientprotocol/codex-acp",
  "@anthropic-ai/sandbox-runtime",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@hypabolic/pi-hypa",
  "@modelcontextprotocol/sdk",
  "context-mode",
  "docx",
  "electron-updater",
  "node-pty",
  "opencode-ai",
  "pdf-lib",
  "pdfjs-dist",
  "pi-mcp-adapter",
  "pi-subagents",
  "pi-web-access",
  "pi-workspace-history",
  "pptxgenjs",
  "react",
  "react-dom",
  "react-icons",
  "sharp",
  "tar",
]
const runtimeDependenciesWithRequiredOptionals = new Set([
  "@napi-rs/canvas",
  "@anthropic-ai/claude-agent-sdk",
  "@hypabolic/hypa",
  "@openai/codex",
  "pdfjs-dist",
  "sharp",
])
const packagedReactIconSets = new Set(["bi", "fa", "hi", "lib", "md"])
const bundledAcpScripts = [
  "astraflow-mcp-stdio-wrapper.mjs",
  "astraflow-skills-mcp-server.mjs",
]
const nativeAgentRuntimeLayouts = {
  "darwin-arm64": {
    codexPackage: "@openai/codex-darwin-arm64",
    codexExecutable: "vendor/aarch64-apple-darwin/bin/codex",
    claudePackage: "@anthropic-ai/claude-agent-sdk-darwin-arm64",
    claudeExecutable: "claude",
  },
  "darwin-x64": {
    codexPackage: "@openai/codex-darwin-x64",
    codexExecutable: "vendor/x86_64-apple-darwin/bin/codex",
    claudePackage: "@anthropic-ai/claude-agent-sdk-darwin-x64",
    claudeExecutable: "claude",
  },
  "linux-arm64": {
    codexPackage: "@openai/codex-linux-arm64",
    codexExecutable: "vendor/aarch64-unknown-linux-musl/bin/codex",
    claudePackage: "@anthropic-ai/claude-agent-sdk-linux-arm64",
    claudeExecutable: "claude",
  },
  "linux-x64": {
    codexPackage: "@openai/codex-linux-x64",
    codexExecutable: "vendor/x86_64-unknown-linux-musl/bin/codex",
    claudePackage: "@anthropic-ai/claude-agent-sdk-linux-x64",
    claudeExecutable: "claude",
  },
  "win32-arm64": {
    codexPackage: "@openai/codex-win32-arm64",
    codexExecutable: "vendor/aarch64-pc-windows-msvc/bin/codex.exe",
    claudePackage: "@anthropic-ai/claude-agent-sdk-win32-arm64",
    claudeExecutable: "claude.exe",
  },
  "win32-x64": {
    codexPackage: "@openai/codex-win32-x64",
    codexExecutable: "vendor/x86_64-pc-windows-msvc/bin/codex.exe",
    claudePackage: "@anthropic-ai/claude-agent-sdk-win32-x64",
    claudeExecutable: "claude.exe",
  },
}
const standaloneExcludedTopLevel = new Set([
  ".cache",
  ".data",
  ".git",
  "agents",
  "backend",
  "bundled-skills",
  "dist",
  "docs",
  "examples",
  "runtime",
  "tests",
])
const rootPackageJson = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8")
)
const removeOptions = {
  recursive: true,
  force: true,
  maxRetries: process.platform === "win32" ? 5 : 0,
  retryDelay: 100,
}
const semverPattern =
  /^(?:v)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/

function readTagVersion() {
  const tagName =
    process.env.ASTRAFLOW_RELEASE_VERSION ||
    (process.env.GITHUB_REF_TYPE === "tag"
      ? process.env.GITHUB_REF_NAME
      : "") ||
    (process.env.GITHUB_REF?.startsWith("refs/tags/")
      ? process.env.GITHUB_REF.slice("refs/tags/".length)
      : "")

  if (!tagName) {
    return null
  }

  const match = tagName.trim().match(semverPattern)

  if (!match) {
    throw new Error(
      `Release tag/version must be semver with an optional leading "v"; received "${tagName}".`
    )
  }

  return match[1]
}

const appVersion = readTagVersion() ?? rootPackageJson.version ?? "0.0.1"

function remove(path) {
  rmSync(path, removeOptions)
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function copy(from, to, { verbatimSymlinks = false } = {}) {
  remove(to)
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, {
    recursive: true,
    force: true,
    verbatimSymlinks,
    filter: (source) => !source.endsWith(".map"),
  })
}

function isSameOrDescendant(parent, candidate) {
  const pathRelative = relative(parent, candidate)

  return (
    pathRelative === "" ||
    (!pathRelative.startsWith(`..${sep}`) &&
      pathRelative !== ".." &&
      !isAbsolute(pathRelative))
  )
}

function validateBundledPython(runtimeRoot) {
  const executable =
    process.platform === "win32"
      ? join(runtimeRoot, "python.exe")
      : join(runtimeRoot, "bin", "python3")

  if (!existsSync(executable)) {
    throw new Error(`Packaged Python executable is missing: ${executable}`)
  }

  const resolvedExecutable = realpathSync.native(executable)

  if (!isSameOrDescendant(runtimeRoot, resolvedExecutable)) {
    throw new Error(
      `Packaged Python executable escapes its runtime: ${resolvedExecutable}`
    )
  }

  const binDirectory =
    process.platform === "win32" ? runtimeRoot : join(runtimeRoot, "bin")
  const result = spawnSync(
    executable,
    ["-c", "import pip, venv; print('packaged-python-bootstrap-ok')"],
    {
      cwd: runtimeRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ""}`,
        PYTHONHOME: runtimeRoot,
        PYTHONNOUSERSITE: "1",
      },
    }
  )

  if (result.error || result.status !== 0) {
    throw new Error(
      `Packaged Python validation failed: ${
        result.error?.message ||
        result.stderr?.trim() ||
        result.stdout?.trim() ||
        `exit ${result.status}`
      }`
    )
  }
}

function copyStandalone(from, to) {
  remove(to)
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, {
    recursive: true,
    force: true,
    filter: (source) => {
      if (source.endsWith(".map") || source.endsWith(".nft.json")) {
        return false
      }

      const sourceRelative = relative(from, source)

      if (!sourceRelative) {
        return true
      }

      return !standaloneExcludedTopLevel.has(sourceRelative.split(sep)[0])
    },
  })
}

function readDependencyVersion(nodeModulesDir, name) {
  const packagePath = join(nodeModulesDir, name, "package.json")
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"))

  return packageJson.version || "*"
}

function getNodeModulePath(nodeModulesDir, packageName) {
  return join(nodeModulesDir, ...packageName.split("/"))
}

function readPackageJson(packageDir) {
  return JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"))
}

function copyRuntimeDependency(
  packageName,
  seen = new Set(),
  optional = false
) {
  if (seen.has(packageName)) {
    return
  }

  seen.add(packageName)

  const sourcePackage = getNodeModulePath(
    join(root, "node_modules"),
    packageName
  )
  const targetPackage = getNodeModulePath(
    join(appDir, "node_modules"),
    packageName
  )

  if (!existsSync(sourcePackage)) {
    if (optional) {
      return
    }

    throw new Error(`Missing runtime dependency ${packageName}`)
  }

  const packageJson = readPackageJson(sourcePackage)

  copy(sourcePackage, targetPackage)

  for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
    copyRuntimeDependency(dependencyName, seen)
  }

  if (runtimeDependenciesWithRequiredOptionals.has(packageName)) {
    for (const dependencyName of Object.keys(
      packageJson.optionalDependencies ?? {}
    )) {
      copyRuntimeDependency(dependencyName, seen, true)
    }
  }
}

function removeNestedRuntimeDependency(
  ownerPackageName,
  dependencyPackageName
) {
  remove(
    join(
      getNodeModulePath(join(appDir, "node_modules"), ownerPackageName),
      "node_modules",
      ...dependencyPackageName.split("/")
    )
  )
}

function validateSharedRuntimeDependency(packageName) {
  const packagedVersion = readDependencyVersion(
    join(appDir, "node_modules"),
    packageName
  )
  const expectedVersion = rootPackageJson.dependencies?.[packageName]

  if (packagedVersion !== expectedVersion) {
    throw new Error(
      `Packaged ${packageName} ${packagedVersion} does not match the direct runtime ${expectedVersion ?? "missing"}.`
    )
  }
}

function prepareAstraflowAcpRuntime() {
  const sourceRoot = join(root, "runtime", "astraflow-acp")
  const targetRoot = join(appDir, "runtime", "astraflow-acp")

  for (const [sourceEntry, targetEntry = sourceEntry] of [
    ["package.json"],
    // electron-builder excludes package-lock.json by basename. Preserve the
    // exact runtime lock under a package-specific name for release parity.
    ["package-lock.json", "package-lock.runtime.json"],
    ["host-tools-manifest.json"],
    ["src"],
  ]) {
    copy(join(sourceRoot, sourceEntry), join(targetRoot, targetEntry))
  }

  if (!existsSync(join(targetRoot, "src", "index.mjs"))) {
    throw new Error("Packaged AstraFlow ACP entrypoint is missing.")
  }
}

function prunePackagedReactIcons() {
  const packageDir = getNodeModulePath(
    join(appDir, "node_modules"),
    "react-icons"
  )

  for (const entry of readdirSync(packageDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !packagedReactIconSets.has(entry.name)) {
      remove(join(packageDir, entry.name))
    }
  }
}

function prunePackagedDocumentRuntime() {
  const nodeModulesDir = join(appDir, "node_modules")

  // Keep the Node CJS and ESM entrypoints used by the bundled document skills,
  // but omit browser bundles, source trees, and compatibility builds that are
  // not reachable through each package's packaged Node exports.
  for (const entry of ["dist", "src"]) {
    remove(join(getNodeModulePath(nodeModulesDir, "pdf-lib"), entry))
  }

  const pdfJsDir = getNodeModulePath(nodeModulesDir, "pdfjs-dist")

  for (const buildDirectory of ["build", join("legacy", "build")]) {
    const directory = join(pdfJsDir, buildDirectory)

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".min.mjs")) {
        remove(join(directory, entry.name))
      }
    }
  }

  for (const fileName of ["index.iife.js", "index.umd.cjs"]) {
    remove(join(getNodeModulePath(nodeModulesDir, "docx"), "dist", fileName))
  }

  for (const fileName of ["pptxgen.bundle.js", "pptxgen.min.js"]) {
    remove(
      join(getNodeModulePath(nodeModulesDir, "pptxgenjs"), "dist", fileName)
    )
  }
}

function prunePackagedDebugArtifacts() {
  const nodeModulesDir = join(appDir, "node_modules")

  function visit(directory) {
    if (!existsSync(directory)) {
      return
    }

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name)

      if (entry.isDirectory()) {
        if (entry.name.endsWith(".dSYM")) {
          remove(entryPath)
          continue
        }

        visit(entryPath)
        continue
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdb")) {
        remove(entryPath)
      }
    }
  }

  visit(nodeModulesDir)

  // This is a package demonstration recording, not runtime input.
  remove(
    join(
      getNodeModulePath(nodeModulesDir, "pi-web-access"),
      "pi-web-fetch-demo.mp4"
    )
  )

  const recheckPlatformPackages = {
    "darwin-arm64": "recheck-macos-arm64",
    "darwin-x64": "recheck-macos-x64",
    "linux-x64": "recheck-linux-x64",
    "win32-x64": "recheck-windows-x64",
  }
  const recheckPlatformPackage = recheckPlatformPackages[runtimeTarget]

  if (
    recheckPlatformPackage &&
    existsSync(getNodeModulePath(nodeModulesDir, recheckPlatformPackage))
  ) {
    // The native backend is preferred by recheck. Its Java archive is only a
    // fallback and otherwise adds another large runtime to every installer.
    remove(getNodeModulePath(nodeModulesDir, "recheck-jar"))
  }

  const koffiDir = getNodeModulePath(nodeModulesDir, "koffi")
  const koffiTriplets = {
    "darwin-arm64": "darwin_arm64",
    "darwin-x64": "darwin_x64",
    "linux-arm64": "linux_arm64",
    "linux-x64": "linux_x64",
    "win32-arm64": "win32_arm64",
    "win32-x64": "win32_x64",
  }
  const koffiTriplet = koffiTriplets[runtimeTarget]

  const koffiBuildDir = join(koffiDir, "build", "koffi")

  if (koffiTriplet && existsSync(koffiBuildDir)) {
    for (const entry of readdirSync(koffiBuildDir, {
      withFileTypes: true,
    })) {
      if (entry.isDirectory() && entry.name !== koffiTriplet) {
        remove(join(koffiBuildDir, entry.name))
      }
    }

    for (const entry of ["doc", "src", "vendor"]) {
      remove(join(koffiDir, entry))
    }
  }
}

async function prepareNativeAgentRuntimeArchive() {
  const layout = nativeAgentRuntimeLayouts[runtimeTarget]

  if (!layout) {
    throw new Error(
      `No native agent runtime layout is defined for ${runtimeTarget}.`
    )
  }

  const nodeModulesDir = join(appDir, "node_modules")
  const codexPackageDir = getNodeModulePath(nodeModulesDir, layout.codexPackage)
  const claudePackageDir = getNodeModulePath(
    nodeModulesDir,
    layout.claudePackage
  )
  const executables = {
    codex: join(codexPackageDir, layout.codexExecutable),
    claude: join(claudePackageDir, layout.claudeExecutable),
  }

  for (const [name, executable] of Object.entries(executables)) {
    if (!existsSync(executable)) {
      throw new Error(`Missing packaged ${name} executable: ${executable}`)
    }
  }

  const runtimeDirectory = join(appDir, "runtime", "agent-runtimes")
  const archiveName = `${runtimeTarget}.tar${
    process.platform === "darwin" ? ".xz" : ""
  }`
  const archivePath = join(runtimeDirectory, archiveName)
  const archiveEntries = [
    relative(appDir, codexPackageDir),
    relative(appDir, claudePackageDir),
  ].map((entry) => entry.split(sep).join("/"))

  remove(runtimeDirectory)
  mkdirSync(runtimeDirectory, { recursive: true })

  if (process.platform === "darwin") {
    console.log(
      `Compressing native agent runtimes for ${runtimeTarget} with XZ level ${nativeRuntimeMacCompressionLevel}...`
    )
    runChecked(
      "/usr/bin/tar",
      [
        "--options",
        `xz:compression-level=${nativeRuntimeMacCompressionLevel},threads=0`,
        "-cJf",
        archivePath,
        ...archiveEntries,
      ],
      {
        cwd: appDir,
        env: {
          ...process.env,
          COPYFILE_DISABLE: "1",
          XZ_OPT: `-${nativeRuntimeMacCompressionLevel} -T0`,
        },
      }
    )
  } else {
    console.log(`Archiving native agent runtimes for ${runtimeTarget}...`)
    await pipeline(
      createTar(
        {
          cwd: appDir,
          noMtime: true,
          portable: true,
        },
        archiveEntries
      ),
      createWriteStream(archivePath)
    )
  }

  const executableEntries = {}

  for (const [name, executable] of Object.entries(executables)) {
    executableEntries[name] = {
      relativePath: relative(appDir, executable).split(sep).join("/"),
      sha256: sha256File(executable),
    }
  }

  const manifest = {
    schemaVersion: 1,
    target: runtimeTarget,
    archive: archiveName,
    archiveSha256: sha256File(archivePath),
    archiveSize: statSync(archivePath).size,
    verifyCodeSignatures: process.platform === "darwin",
    packages: {
      codex: readDependencyVersion(nodeModulesDir, layout.codexPackage),
      claude: readDependencyVersion(nodeModulesDir, layout.claudePackage),
    },
    executables: executableEntries,
  }

  writeFileSync(
    join(runtimeDirectory, "runtime-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  )

  remove(codexPackageDir)
  remove(claudePackageDir)

  console.log(
    `Archived native agent runtimes for ${runtimeTarget} to ${Math.ceil(
      manifest.archiveSize / (1024 * 1024)
    )} MiB.`
  )
}

remove(appDir)

copyStandalone(standaloneDir, appDir)
copy(join(root, ".next", "static"), join(appDir, ".next", "static"))
copy(join(root, "public"), join(appDir, "public"))
copy(join(root, "electron"), join(appDir, "electron"))
copy(join(root, "bundled-skills"), join(appDir, "bundled-skills"))

for (const fileName of bundledAcpScripts) {
  copy(join(root, "scripts", fileName), join(appDir, "scripts", fileName))
}

prepareAstraflowAcpRuntime()

const bundledPythonSource = join(
  root,
  "runtime",
  "python",
  "distributions",
  runtimeTarget
)

if (!existsSync(bundledPythonSource)) {
  throw new Error(
    `Missing bundled Python runtime for ${runtimeTarget}. Run bun run runtime:python first.`
  )
}

const bundledPythonTarget = join(appDir, "runtime", "python", runtimeTarget)

copy(bundledPythonSource, bundledPythonTarget, { verbatimSymlinks: true })
validateBundledPython(bundledPythonTarget)

for (const fileName of [
  "bootstrap-requirements.txt",
  "README.md",
  "requirements.in",
  "requirements.lock",
  "runtime-manifest.json",
]) {
  copy(
    join(root, "runtime", "python", fileName),
    join(appDir, "runtime", "python", fileName)
  )
}

const bundledSandboxSource = join(root, "runtime", "sandbox", runtimeTarget)

if (existsSync(bundledSandboxSource)) {
  copy(bundledSandboxSource, join(appDir, "runtime", "sandbox", runtimeTarget))
}

for (const dependencyName of forcedRuntimeDependencies) {
  copyRuntimeDependency(dependencyName)
}

for (const [ownerPackageName, dependencyPackageName] of [
  ["@agentclientprotocol/claude-agent-acp", "@anthropic-ai/claude-agent-sdk"],
  ["@agentclientprotocol/codex-acp", "@openai/codex"],
]) {
  validateSharedRuntimeDependency(dependencyPackageName)
  removeNestedRuntimeDependency(ownerPackageName, dependencyPackageName)
}

for (const dependencyName of [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@hypabolic/pi-hypa",
  "context-mode",
  "pi-mcp-adapter",
  "pi-subagents",
  "pi-web-access",
  "pi-workspace-history",
]) {
  validateSharedRuntimeDependency(dependencyName)
}

prunePackagedReactIcons()
prunePackagedDocumentRuntime()
prunePackagedDebugArtifacts()
await prepareNativeAgentRuntimeArchive()

const packageJson = {
  name: "astraflow-desktop",
  version: appVersion,
  description: "AstraFlow desktop frontend",
  author: {
    name: "UCloud",
    email: "support@ucloud.cn",
  },
  desktopName: "AstraFlow",
  main: "electron/main.cjs",
  type: "module",
  private: true,
  dependencies: {
    "@anthropic-ai/sandbox-runtime": readDependencyVersion(
      join(appDir, "node_modules"),
      "@anthropic-ai/sandbox-runtime"
    ),
    "@earendil-works/pi-agent-core": readDependencyVersion(
      join(appDir, "node_modules"),
      "@earendil-works/pi-agent-core"
    ),
    "@earendil-works/pi-ai": readDependencyVersion(
      join(appDir, "node_modules"),
      "@earendil-works/pi-ai"
    ),
    "@earendil-works/pi-coding-agent": readDependencyVersion(
      join(appDir, "node_modules"),
      "@earendil-works/pi-coding-agent"
    ),
    "@hypabolic/pi-hypa": readDependencyVersion(
      join(appDir, "node_modules"),
      "@hypabolic/pi-hypa"
    ),
    "better-sqlite3": readDependencyVersion(
      join(appDir, "node_modules"),
      "better-sqlite3"
    ),
    "context-mode": readDependencyVersion(
      join(appDir, "node_modules"),
      "context-mode"
    ),
    docx: readDependencyVersion(join(appDir, "node_modules"), "docx"),
    "electron-updater": readDependencyVersion(
      join(appDir, "node_modules"),
      "electron-updater"
    ),
    "node-pty": readDependencyVersion(join(appDir, "node_modules"), "node-pty"),
    "pdf-lib": readDependencyVersion(join(appDir, "node_modules"), "pdf-lib"),
    "pdfjs-dist": readDependencyVersion(
      join(appDir, "node_modules"),
      "pdfjs-dist"
    ),
    "pi-mcp-adapter": readDependencyVersion(
      join(appDir, "node_modules"),
      "pi-mcp-adapter"
    ),
    "pi-subagents": readDependencyVersion(
      join(appDir, "node_modules"),
      "pi-subagents"
    ),
    "pi-web-access": readDependencyVersion(
      join(appDir, "node_modules"),
      "pi-web-access"
    ),
    "pi-workspace-history": readDependencyVersion(
      join(appDir, "node_modules"),
      "pi-workspace-history"
    ),
    pptxgenjs: readDependencyVersion(join(appDir, "node_modules"), "pptxgenjs"),
    react: readDependencyVersion(join(appDir, "node_modules"), "react"),
    "react-dom": readDependencyVersion(
      join(appDir, "node_modules"),
      "react-dom"
    ),
    "react-icons": readDependencyVersion(
      join(appDir, "node_modules"),
      "react-icons"
    ),
    sharp: readDependencyVersion(join(appDir, "node_modules"), "sharp"),
    tar: readDependencyVersion(join(appDir, "node_modules"), "tar"),
  },
}

writeFileSync(
  join(appDir, "package.json"),
  `${JSON.stringify(packageJson, null, 2)}\n`
)

console.log(`Prepared Electron app version ${appVersion}.`)
