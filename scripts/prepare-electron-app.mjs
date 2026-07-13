import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { spawnSync } from "node:child_process"
import { delimiter, dirname, isAbsolute, join, relative, sep } from "node:path"

const root = process.cwd()
const appDir = join(root, "dist", "electron-app")
const standaloneDir = join(root, ".next", "standalone")
const runtimeTarget = `${process.platform}-${process.arch}`
const forcedRuntimeDependencies = [
  "@agentclientprotocol/claude-agent-acp",
  "@agentclientprotocol/codex-acp",
  "@anthropic-ai/sandbox-runtime",
  "@modelcontextprotocol/sdk",
  "docx",
  "electron-updater",
  "opencode-ai",
  "pdf-lib",
  "pdfjs-dist",
  "pptxgenjs",
  "react",
  "react-dom",
  "react-icons",
  "sharp",
]
const runtimeDependenciesWithRequiredOptionals = new Set([
  "@napi-rs/canvas",
  "@anthropic-ai/claude-agent-sdk",
  "@openai/codex",
  "pdfjs-dist",
  "sharp",
])
const standaloneExcludedTopLevel = new Set([
  ".cache",
  ".data",
  ".git",
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
    ["-c", "import markitdown; print('packaged-markitdown-ok')"],
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
      if (source.endsWith(".map")) {
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

function copyRuntimeDependency(packageName, seen = new Set(), optional = false) {
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

remove(appDir)

copyStandalone(standaloneDir, appDir)
copy(join(root, ".next", "static"), join(appDir, ".next", "static"))
copy(join(root, "public"), join(appDir, "public"))
copy(join(root, "electron"), join(appDir, "electron"))
copy(join(root, "bundled-skills"), join(appDir, "bundled-skills"))

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
  "README.md",
  "requirements.lock",
  "runtime-manifest.json",
]) {
  copy(
    join(root, "runtime", "python", fileName),
    join(appDir, "runtime", "python", fileName)
  )
}

const bundledSandboxSource = join(
  root,
  "runtime",
  "sandbox",
  runtimeTarget
)

if (existsSync(bundledSandboxSource)) {
  copy(
    bundledSandboxSource,
    join(appDir, "runtime", "sandbox", runtimeTarget)
  )
}

for (const dependencyName of forcedRuntimeDependencies) {
  copyRuntimeDependency(dependencyName)
}

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
    "better-sqlite3": readDependencyVersion(
      join(appDir, "node_modules"),
      "better-sqlite3"
    ),
    docx: readDependencyVersion(join(appDir, "node_modules"), "docx"),
    "electron-updater": readDependencyVersion(
      join(appDir, "node_modules"),
      "electron-updater"
    ),
    "pdf-lib": readDependencyVersion(join(appDir, "node_modules"), "pdf-lib"),
    "pdfjs-dist": readDependencyVersion(
      join(appDir, "node_modules"),
      "pdfjs-dist"
    ),
    pptxgenjs: readDependencyVersion(
      join(appDir, "node_modules"),
      "pptxgenjs"
    ),
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
  },
}

writeFileSync(
  join(appDir, "package.json"),
  `${JSON.stringify(packageJson, null, 2)}\n`
)

console.log(`Prepared Electron app version ${appVersion}.`)
