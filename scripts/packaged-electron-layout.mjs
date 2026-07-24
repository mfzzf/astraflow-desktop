import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, dirname, join, relative, sep } from "node:path"

function walk(directory) {
  if (!existsSync(directory)) {
    return []
  }

  const entries = []

  for (const entry of readdirSync(directory)) {
    const absolutePath = join(directory, entry)
    const stats = statSync(absolutePath)

    if (stats.isDirectory()) {
      entries.push(...walk(absolutePath))
    } else {
      entries.push(absolutePath)
    }
  }

  return entries
}

function unquoteYamlScalar(value) {
  const trimmed = value.trim()

  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function readTopLevelScalar(source, key) {
  const match = source.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"))

  return match ? unquoteYamlScalar(match[1]) : null
}

function readSectionScalar(source, section, key) {
  const lines = source.split(/\r?\n/)
  let inSection = false

  for (const line of lines) {
    const topLevel = line.match(/^([^\s#][^:]*):/)
    if (topLevel) {
      inSection = topLevel[1] === section
      continue
    }

    if (!inSection) {
      continue
    }

    const match = line.match(
      new RegExp(`^\\s+${key}:\\s*(.+?)\\s*$`)
    )

    if (match) {
      return unquoteYamlScalar(match[1])
    }
  }

  return null
}

function resolveExpectedExecutableName(builderConfigPath, platform) {
  const source = readFileSync(builderConfigPath, "utf8")
  const productName = readTopLevelScalar(source, "productName")

  if (!productName) {
    throw new Error(
      `Electron builder config does not declare productName: ${builderConfigPath}`
    )
  }

  if (platform === "win32") {
    return readSectionScalar(source, "win", "executableName") ?? productName
  }

  if (platform === "linux") {
    return (
      readSectionScalar(source, "linux", "executableName") ?? productName
    )
  }

  return productName
}

function isUnpackedDirectory(name, platform) {
  const prefix = platform === "win32" ? "win" : "linux"

  return (
    name === `${prefix}-unpacked` ||
    (name.startsWith(`${prefix}-`) && name.endsWith("-unpacked"))
  )
}

export function findPackagedExecutable({
  builderConfigPath,
  distDir,
  platform = process.platform,
}) {
  const executableName = resolveExpectedExecutableName(
    builderConfigPath,
    platform
  )
  const files = walk(distDir)

  if (platform === "darwin") {
    const suffix = [
      `${executableName}.app`,
      "Contents",
      "MacOS",
      executableName,
    ].join(sep)

    return files.find((file) => file.endsWith(suffix))
  }

  if (platform !== "win32" && platform !== "linux") {
    return undefined
  }

  const expectedBasename =
    platform === "win32" ? `${executableName}.exe` : executableName

  return files.find((file) => {
    const relativePath = relative(distDir, file)
    const parts = relativePath.split(sep)

    return (
      parts.length === 2 &&
      isUnpackedDirectory(parts[0], platform) &&
      basename(file).toLocaleLowerCase("en-US") ===
        expectedBasename.toLocaleLowerCase("en-US") &&
      existsSync(join(dirname(file), "resources", "app.asar"))
    )
  })
}
