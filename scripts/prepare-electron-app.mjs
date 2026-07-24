import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, relative, sep } from "node:path"

import {
  createAgentRuntimeCatalog,
  getAgentRuntimePackageSpecs,
} from "./agent-runtime-packages.mjs"
import { createDeveloperRuntimeCatalog } from "./developer-runtime-packages.mjs"
import { readReleaseVersion } from "./release-version.mjs"

const root = process.cwd()
const appDir = join(root, "dist", "electron-app")
const standaloneDir = join(root, ".next", "standalone")
const runtimeTarget = `${process.platform}-${process.arch}`
const forcedRuntimeDependencies = [
  "@agentclientprotocol/claude-agent-acp",
  "@agentclientprotocol/codex-acp",
  "@anthropic-ai/sandbox-runtime",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@modelcontextprotocol/sdk",
  "docx",
  "electron-updater",
  "node-pty",
  "opencode-ai",
  "pdf-lib",
  "pdfjs-dist",
  "pi-subagents",
  "pptxgenjs",
  "react",
  "react-dom",
  "react-icons",
  "sharp",
  "tar",
  "undici",
]
const runtimeDependenciesWithRequiredOptionals = new Set([
  "@napi-rs/canvas",
  "@anthropic-ai/claude-agent-sdk",
  "@openai/codex",
  "pdfjs-dist",
  "sharp",
])
const packagedReactIconSets = new Set(["bi", "fa", "hi", "lib", "md"])
const bundledAcpScripts = [
  "astraflow-skills-mcp-server.mjs",
]
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

const appVersion = readReleaseVersion() ?? rootPackageJson.version ?? "0.0.1"

function remove(path) {
  rmSync(path, removeOptions)
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

function prepareNativeAgentRuntimeCatalog() {
  const nodeModulesDir = join(appDir, "node_modules")
  const runtimeDirectory = join(appDir, "runtime", "agent-runtimes")
  const specs = getAgentRuntimePackageSpecs({
    appRoot: appDir,
    nodeModulesDir,
    runtimeTarget,
  })
  const catalog = createAgentRuntimeCatalog({
    appRoot: appDir,
    nodeModulesDir,
    runtimeTarget,
  })

  remove(runtimeDirectory)
  mkdirSync(runtimeDirectory, { recursive: true })
  writeFileSync(
    join(runtimeDirectory, "runtime-catalog.json"),
    `${JSON.stringify(catalog, null, 2)}\n`
  )

  for (const spec of specs) {
    remove(spec.packagePath)
  }

  console.log(
    `Prepared downloadable agent runtime catalog for ${runtimeTarget}.`
  )
}

function prepareDeveloperRuntimeCatalog() {
  const runtimeDirectory = join(appDir, "runtime", "developer-runtimes")
  const catalog = createDeveloperRuntimeCatalog({
    appRoot: root,
    runtimeTarget,
  })

  remove(runtimeDirectory)
  mkdirSync(runtimeDirectory, { recursive: true })

  copy(
    join(root, "runtime", "developer-runtimes", "environment-installer.mjs"),
    join(runtimeDirectory, "environment-installer.mjs")
  )

  writeFileSync(
    join(runtimeDirectory, "runtime-catalog.json"),
    `${JSON.stringify(catalog, null, 2)}\n`
  )
  console.log(`Prepared downloadable developer runtimes for ${runtimeTarget}.`)
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

prepareDeveloperRuntimeCatalog()

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
  "pi-subagents",
  "undici",
]) {
  validateSharedRuntimeDependency(dependencyName)
}

prunePackagedReactIcons()
prunePackagedDocumentRuntime()
prunePackagedDebugArtifacts()
prepareNativeAgentRuntimeCatalog()

const packageJson = {
  name: "compshare-desktop",
  version: appVersion,
  description: "优云智算桌面客户端",
  author: {
    name: "UCloud",
    email: "support@ucloud.cn",
  },
  desktopName: "优云智算",
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
    "better-sqlite3": readDependencyVersion(
      join(appDir, "node_modules"),
      "better-sqlite3"
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
    "pi-subagents": readDependencyVersion(
      join(appDir, "node_modules"),
      "pi-subagents"
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
    undici: readDependencyVersion(join(appDir, "node_modules"), "undici"),
  },
}

writeFileSync(
  join(appDir, "package.json"),
  `${JSON.stringify(packageJson, null, 2)}\n`
)

console.log(`Prepared Electron app version ${appVersion}.`)
