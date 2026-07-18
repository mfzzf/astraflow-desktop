/* eslint-disable @typescript-eslint/no-require-imports */

const {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} = require("node:fs")
const { join, sep } = require("node:path")
const { createPackageWithOptions, extractAll } = require("@electron/asar")

const ELECTRON_BUILDER_ARCH_NAMES = {
  0: "ia32",
  1: "x64",
  2: "armv7l",
  3: "arm64",
  4: "universal",
}

const REBUILDABLE_NATIVE_MODULES = ["better-sqlite3", "node-pty"]
const ASAR_UNPACK_DIRECTORIES =
  "{runtime,node_modules/@anthropic-ai/sandbox-runtime,node_modules/@hypabolic/hypa*,node_modules/recheck*}"
const ASAR_UNPACK_FILES =
  "{**/*.{node,dylib,so,dll,exe},**/*.so.*,**/spawn-helper}"

function copyFilter(sourcePath) {
  return !sourcePath.endsWith(".map")
}

function copyTree(source, target) {
  if (!copyFilter(source)) {
    return
  }

  const stats = lstatSync(source)

  if (stats.isSymbolicLink()) {
    copyTree(realpathSync(source), target)
    return
  }

  if (stats.isDirectory()) {
    mkdirSync(target, { recursive: true })

    for (const entry of readdirSync(source)) {
      copyTree(join(source, entry), join(target, entry))
    }

    return
  }

  if (stats.isFile()) {
    // Native copying does not retain an entire large runtime binary in V8's
    // heap, which matters on the 2-GB packaging runners.
    copyFileSync(source, target)
    chmodSync(target, stats.mode)
  }
}

function removeMatchingFiles(directory, predicate) {
  if (!existsSync(directory)) {
    return
  }

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)

    if (entry.isDirectory()) {
      removeMatchingFiles(entryPath, predicate)
    } else if (predicate(entry.name)) {
      rmSync(entryPath, { force: true })
    }
  }
}

function containsMatchingFile(directory, predicate) {
  if (!existsSync(directory)) {
    return false
  }

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (containsMatchingFile(join(directory, entry.name), predicate)) {
        return true
      }
    } else if (predicate(entry.name)) {
      return true
    }
  }

  return false
}

function materializePackage(packageDir) {
  const tempDir = `${packageDir}.tmp-${process.pid}`

  rmSync(tempDir, { recursive: true, force: true })
  copyTree(packageDir, tempDir)
  rmSync(packageDir, { recursive: true, force: true })
  renameSync(tempDir, packageDir)
}

function getPackageNameFromNodeModulesPath(packagePath) {
  const parts = packagePath.split(sep)
  const nodeModulesIndex = parts.lastIndexOf("node_modules")

  if (nodeModulesIndex === -1 || !parts[nodeModulesIndex + 1]) {
    return null
  }

  const firstPart = parts[nodeModulesIndex + 1]

  if (firstPart.startsWith("@") && parts[nodeModulesIndex + 2]) {
    return `${firstPart}/${parts[nodeModulesIndex + 2]}`
  }

  return firstPart
}

function getPackagedAppDir(context) {
  if (context.electronPlatformName === "darwin") {
    return join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      "Contents",
      "Resources",
      "app"
    )
  }

  return join(context.appOutDir, "resources", "app")
}

function materializePackagedAppDir(context) {
  const appDir = getPackagedAppDir(context)

  if (existsSync(appDir)) {
    return appDir
  }

  const archivePath = join(appDir, "..", "app.asar")
  const unpackedPath = `${archivePath}.unpacked`

  if (!existsSync(archivePath)) {
    throw new Error(`Missing packaged app archive: ${archivePath}`)
  }

  extractAll(archivePath, appDir)

  if (existsSync(unpackedPath)) {
    cpSync(unpackedPath, appDir, {
      recursive: true,
      force: true,
    })
  }

  rmSync(archivePath, { force: true })
  rmSync(unpackedPath, { recursive: true, force: true })
  return appDir
}

function getPackageNameFromPackageJson(packageDir) {
  const packageJsonPath = join(packageDir, "package.json")

  if (!existsSync(packageJsonPath)) {
    return null
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
    return typeof packageJson.name === "string" ? packageJson.name : null
  } catch {
    return null
  }
}

function getPackagedPackageForAlias(sourceAlias, targetAppDir) {
  const packageNameFromAlias = getPackageNameFromAlias(
    sourceAlias,
    join(targetAppDir, "node_modules")
  )
  let packageName = getPackageNameFromPackageJson(sourceAlias)

  if (!packageName && lstatSync(sourceAlias).isSymbolicLink()) {
    try {
      const realPath = realpathSync(sourceAlias)
      packageName =
        getPackageNameFromNodeModulesPath(realPath) ??
        getPackageNameFromPackageJson(realPath)
    } catch {
      packageName = null
    }
  }

  packageName ??= packageNameFromAlias

  if (!packageName) {
    return null
  }

  const packagedPackage = join(
    targetAppDir,
    "node_modules",
    ...packageName.split("/")
  )

  return existsSync(packagedPackage) ? packagedPackage : null
}

function collectPackagedPackageNames(nodeModulesDir) {
  const packageNames = []

  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue
    }

    if (entry.name.startsWith("@")) {
      const scopeDir = join(nodeModulesDir, entry.name)

      for (const scopedEntry of readdirSync(scopeDir, {
        withFileTypes: true,
      })) {
        if (scopedEntry.isDirectory()) {
          packageNames.push(`${entry.name}/${scopedEntry.name}`)
        }
      }

      continue
    }

    packageNames.push(entry.name)
  }

  return packageNames.sort((a, b) => b.length - a.length)
}

function getPackageNameFromAlias(sourceAlias, nodeModulesDir) {
  const aliasName = sourceAlias.split(sep).at(-1)

  if (!aliasName || !existsSync(nodeModulesDir)) {
    return null
  }

  return (
    collectPackagedPackageNames(nodeModulesDir).find((packageName) =>
      aliasName.startsWith(`${packageName.split("/").at(-1)}-`)
    ) ?? null
  )
}

function copyNextModuleAliases(sourceAppDir, targetAppDir) {
  const sourceAliasesDir = join(sourceAppDir, ".next", "node_modules")

  if (!existsSync(sourceAliasesDir)) {
    return
  }

  const finalAliasesDir = join(targetAppDir, ".next", "node_modules")
  const targetAliasesDir =
    sourceAppDir === targetAppDir
      ? `${finalAliasesDir}.tmp-${process.pid}`
      : finalAliasesDir

  rmSync(targetAliasesDir, { recursive: true, force: true })
  mkdirSync(targetAliasesDir, { recursive: true })

  for (const entry of readdirSync(sourceAliasesDir, { withFileTypes: true })) {
    const sourceAlias = join(sourceAliasesDir, entry.name)
    const targetAlias = join(targetAliasesDir, entry.name)

    if (entry.isDirectory() && entry.name.startsWith("@")) {
      mkdirSync(targetAlias, { recursive: true })

      for (const scopedEntry of readdirSync(sourceAlias, {
        withFileTypes: true,
      })) {
        if (!scopedEntry.isDirectory() && !scopedEntry.isSymbolicLink()) {
          continue
        }

        const scopedSourceAlias = join(sourceAlias, scopedEntry.name)
        const packagedPackage = getPackagedPackageForAlias(
          scopedSourceAlias,
          targetAppDir
        )
        const copySource = packagedPackage ?? scopedSourceAlias

        console.log(
          `[electron-package] materializing Next module alias ${entry.name}/${scopedEntry.name} from ${copySource}`
        )

        copyTree(copySource, join(targetAlias, scopedEntry.name))
      }

      continue
    }

    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue
    }

    const packagedPackage = getPackagedPackageForAlias(
      sourceAlias,
      targetAppDir
    )
    const copySource = packagedPackage ?? sourceAlias

    console.log(
      `[electron-package] materializing Next module alias ${entry.name} from ${copySource}`
    )

    copyTree(copySource, join(targetAliasesDir, entry.name))
  }

  if (targetAliasesDir !== finalAliasesDir) {
    rmSync(finalAliasesDir, { recursive: true, force: true })
    renameSync(targetAliasesDir, finalAliasesDir)
  }
}

function prepareAsarStandaloneServer(appDir) {
  const serverPath = join(appDir, "server.js")

  if (!existsSync(serverPath)) {
    throw new Error(`Missing standalone Next.js server: ${serverPath}`)
  }

  const source = readFileSync(serverPath, "utf8")
  const original = "process.chdir(__dirname)"
  const replacement =
    "if (!__dirname.includes('.asar')) { process.chdir(__dirname) }"

  if (source.includes(replacement)) {
    return
  }

  if (!source.includes(original)) {
    throw new Error(
      `Could not prepare standalone Next.js server for ASAR: ${serverPath}`
    )
  }

  writeFileSync(serverPath, source.replace(original, replacement))
}

async function packAsar(appDir) {
  const archivePath = join(appDir, "..", "app.asar")
  const unpackedPath = `${archivePath}.unpacked`

  rmSync(archivePath, { force: true })
  rmSync(unpackedPath, { recursive: true, force: true })

  await createPackageWithOptions(appDir, archivePath, {
    unpack: ASAR_UNPACK_FILES,
    unpackDir: ASAR_UNPACK_DIRECTORIES,
  })

  rmSync(appDir, { recursive: true, force: true })
}

function syncPackage(sourcePackage, targetPackage) {
  if (existsSync(targetPackage)) {
    materializePackage(targetPackage)
    return
  }

  copyTree(sourcePackage, targetPackage)
}

function syncNodeModules(source, target) {
  mkdirSync(target, { recursive: true })

  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue
    }

    const sourceEntry = join(source, entry.name)
    const targetEntry = join(target, entry.name)

    if (entry.name.startsWith("@")) {
      mkdirSync(targetEntry, { recursive: true })

      for (const scopedEntry of readdirSync(sourceEntry, {
        withFileTypes: true,
      })) {
        if (!scopedEntry.isDirectory()) {
          continue
        }

        syncPackage(
          join(sourceEntry, scopedEntry.name),
          join(targetEntry, scopedEntry.name)
        )
      }

      continue
    }

    syncPackage(sourceEntry, targetEntry)
  }
}

function getElectronVersion(projectDir) {
  const packageJson = JSON.parse(
    readFileSync(join(projectDir, "package.json"), "utf8")
  )
  const version =
    packageJson.devDependencies?.electron ?? packageJson.dependencies?.electron
  const match =
    typeof version === "string" ? version.match(/\d+\.\d+\.\d+/) : null

  if (!match) {
    throw new Error("Could not resolve Electron version from package.json.")
  }

  return match[0]
}

function getElectronRebuildArch(context) {
  const arch =
    typeof context.arch === "string"
      ? context.arch
      : ELECTRON_BUILDER_ARCH_NAMES[context.arch]

  if (!arch || arch === "universal") {
    throw new Error(`Unsupported Electron rebuild arch: ${context.arch}`)
  }

  return arch
}

function getNodeModuleDir(nodeModulesDir, packageName) {
  return join(nodeModulesDir, ...packageName.split("/"))
}

function copyRebuildableNativeModules(projectDir, targetAppDir) {
  for (const packageName of REBUILDABLE_NATIVE_MODULES) {
    const sourcePackage = getNodeModuleDir(
      join(projectDir, "node_modules"),
      packageName
    )
    const targetPackage = getNodeModuleDir(
      join(targetAppDir, "node_modules"),
      packageName
    )

    if (!existsSync(sourcePackage)) {
      throw new Error(`Missing native module source package: ${sourcePackage}`)
    }

    rmSync(targetPackage, { recursive: true, force: true })
    copyTree(sourcePackage, targetPackage)
  }
}

function pruneRebuildableNativeModules(targetAppDir) {
  const betterSqliteDir = getNodeModuleDir(
    join(targetAppDir, "node_modules"),
    "better-sqlite3"
  )
  const betterSqliteBinary = join(
    betterSqliteDir,
    "build",
    "Release",
    "better_sqlite3.node"
  )

  if (!existsSync(betterSqliteBinary)) {
    throw new Error(
      `Missing rebuilt better-sqlite3 binary: ${betterSqliteBinary}`
    )
  }

  const binaryMode = lstatSync(betterSqliteBinary).mode
  const binaryContents = readFileSync(betterSqliteBinary)

  rmSync(join(betterSqliteDir, "build"), { recursive: true, force: true })
  mkdirSync(join(betterSqliteDir, "build", "Release"), { recursive: true })
  writeFileSync(betterSqliteBinary, binaryContents)
  chmodSync(betterSqliteBinary, binaryMode)

  for (const entry of ["deps", "src", "test"]) {
    rmSync(join(betterSqliteDir, entry), { recursive: true, force: true })
  }

  for (const entry of [
    "binding.gyp",
    "common.gypi",
    "copy.js",
    "defines.gypi",
    "download.sh",
  ]) {
    rmSync(join(betterSqliteDir, entry), { force: true })
  }

  const nodePtyDir = getNodeModuleDir(
    join(targetAppDir, "node_modules"),
    "node-pty"
  )
  const nodePtyReleaseDir = join(nodePtyDir, "build", "Release")
  const nodePtySpawnHelper = join(nodePtyReleaseDir, "spawn-helper")
  const nodePtyReleaseTemp = `${nodePtyDir}.release-${process.pid}`

  if (!containsMatchingFile(nodePtyReleaseDir, (name) => name.endsWith(".node"))) {
    throw new Error(
      `Missing rebuilt node-pty binary under ${nodePtyReleaseDir}`
    )
  }

  if (
    process.platform === "darwin" &&
    !existsSync(nodePtySpawnHelper)
  ) {
    throw new Error(
      `Missing rebuilt node-pty spawn helper: ${nodePtySpawnHelper}`
    )
  }

  if (
    process.platform === "darwin" &&
    (lstatSync(nodePtySpawnHelper).mode & 0o111) === 0
  ) {
    throw new Error(
      `Rebuilt node-pty spawn helper is not executable: ${nodePtySpawnHelper}`
    )
  }

  rmSync(nodePtyReleaseTemp, { recursive: true, force: true })
  copyTree(nodePtyReleaseDir, nodePtyReleaseTemp)
  rmSync(join(nodePtyDir, "build"), { recursive: true, force: true })
  mkdirSync(join(nodePtyDir, "build"), { recursive: true })
  renameSync(nodePtyReleaseTemp, nodePtyReleaseDir)
  removeMatchingFiles(nodePtyReleaseDir, (name) =>
    name.toLowerCase().endsWith(".pdb")
  )

  for (const entry of [
    "deps",
    "node-addon-api",
    "prebuilds",
    "scripts",
    "src",
    "third_party",
    "typings",
  ]) {
    rmSync(join(nodePtyDir, entry), { recursive: true, force: true })
  }

  rmSync(join(nodePtyDir, "binding.gyp"), { force: true })
  removeMatchingFiles(join(nodePtyDir, "lib"), (name) =>
    name.endsWith(".test.js")
  )
}

async function rebuildElectronNativeModules(context, targetAppDir) {
  const { rebuild } = await import("@electron/rebuild")
  const electronVersion = getElectronVersion(context.packager.projectDir)
  const arch = getElectronRebuildArch(context)
  const nativeModuleBuildDir = join(
    targetAppDir,
    "node_modules",
    "better-sqlite3",
    "build"
  )

  console.log(
    `[electron-package] rebuilding native modules for Electron ${electronVersion} (${context.electronPlatformName}/${arch})`
  )

  copyRebuildableNativeModules(context.packager.projectDir, targetAppDir)
  rmSync(nativeModuleBuildDir, { recursive: true, force: true })

  const rebuildTask = rebuild({
    buildPath: targetAppDir,
    electronVersion,
    platform: context.electronPlatformName,
    arch,
    onlyModules: REBUILDABLE_NATIVE_MODULES,
    force: true,
    buildFromSource: true,
    disablePreGypCopy: true,
    projectRootPath: targetAppDir,
  })
  let foundNativeModules = []

  rebuildTask.lifecycle.on("modules-found", (modules) => {
    foundNativeModules = modules
    console.log(
      `[electron-package] native modules found: ${modules.join(", ")}`
    )
  })

  rebuildTask.lifecycle.on("module-done", (moduleName) => {
    console.log(`[electron-package] rebuilt native module: ${moduleName}`)
  })

  await rebuildTask

  for (const moduleName of REBUILDABLE_NATIVE_MODULES) {
    if (!foundNativeModules.includes(moduleName)) {
      throw new Error(`${moduleName} was not found during Electron rebuild.`)
    }
  }

  pruneRebuildableNativeModules(targetAppDir)
}

function prunePackagedOptionalPayloads(context, targetAppDir) {
  const nodeModulesDir = join(targetAppDir, "node_modules")
  const arch = getElectronRebuildArch(context)
  const runtimeTarget = `${context.electronPlatformName}-${arch}`

  removeMatchingFiles(nodeModulesDir, (name) =>
    name.toLowerCase().endsWith(".pdb")
  )

  const removeDebugDirectories = (directory) => {
    if (!existsSync(directory)) {
      return
    }

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name)

      if (!entry.isDirectory()) {
        continue
      }

      if (entry.name.endsWith(".dSYM")) {
        rmSync(entryPath, { recursive: true, force: true })
        continue
      }

      removeDebugDirectories(entryPath)
    }
  }

  removeDebugDirectories(nodeModulesDir)
  rmSync(
    join(nodeModulesDir, "pi-web-access", "pi-web-fetch-demo.mp4"),
    { force: true }
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
    existsSync(join(nodeModulesDir, recheckPlatformPackage))
  ) {
    rmSync(join(nodeModulesDir, "recheck-jar"), {
      recursive: true,
      force: true,
    })
  }

  const koffiDir = join(nodeModulesDir, "koffi")
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
        rmSync(join(koffiBuildDir, entry.name), {
          recursive: true,
          force: true,
        })
      }
    }

    for (const entry of ["doc", "src", "vendor"]) {
      rmSync(join(koffiDir, entry), { recursive: true, force: true })
    }
  }
}

exports.default = async function copyElectronNodeModules(context) {
  const projectDir = context.packager.projectDir
  const sourceAppDir = join(projectDir, "dist", "electron-app")
  const targetAppDir = materializePackagedAppDir(context)
  const source = join(sourceAppDir, "node_modules")
  const target = join(targetAppDir, "node_modules")

  if (!existsSync(source)) {
    throw new Error(`Missing traced Electron node_modules: ${source}`)
  }

  syncNodeModules(source, target)
  await rebuildElectronNativeModules(context, targetAppDir)
  copyNextModuleAliases(sourceAppDir, targetAppDir)
  prunePackagedOptionalPayloads(context, targetAppDir)
  prepareAsarStandaloneServer(targetAppDir)
  await packAsar(targetAppDir)
}
