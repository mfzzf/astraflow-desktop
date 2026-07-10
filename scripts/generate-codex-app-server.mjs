import { spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(scriptDir, "..")
const targetDir = join(root, "lib", "generated", "codex-app-server")
const versionFileName = ".codex-version"
const versionFile = join(targetDir, versionFileName)
const require = createRequire(import.meta.url)
const codexPackageJson = require("@openai/codex/package.json")
const codexScript = require.resolve("@openai/codex/bin/codex.js")
const checkOnly = process.argv.includes("--check")

function collectFiles(directory, base = directory) {
  if (!existsSync(directory)) {
    return []
  }

  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.name === versionFileName) {
        return []
      }

      const path = join(directory, entry.name)

      return entry.isDirectory() ? collectFiles(path, base) : [relative(base, path)]
    })
    .sort()
}

function compareGeneratedDirectories(expectedDir, actualDir) {
  const expectedFiles = collectFiles(expectedDir)
  const actualFiles = collectFiles(actualDir)
  const expectedSet = new Set(expectedFiles)
  const actualSet = new Set(actualFiles)
  const differences = []

  for (const file of expectedFiles) {
    if (!actualSet.has(file)) {
      differences.push(`missing generated file: ${file}`)
      continue
    }

    const expected = readFileSync(join(expectedDir, file))
    const actual = readFileSync(join(actualDir, file))

    if (!expected.equals(actual)) {
      differences.push(`generated file differs: ${file}`)
    }
  }

  for (const file of actualFiles) {
    if (!expectedSet.has(file)) {
      differences.push(`stale generated file: ${file}`)
    }
  }

  return differences
}

function generateTypes(outputDir) {
  const result = spawnSync(
    process.execPath,
    [codexScript, "app-server", "generate-ts", "--out", outputDir],
    {
      cwd: root,
      encoding: "utf8",
      stdio: "inherit",
    }
  )

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(
      `Codex app-server type generation exited with status ${result.status ?? "unknown"}.`
    )
  }
}

const temporaryRoot = mkdtempSync(
  join(checkOnly ? tmpdir() : root, "astraflow-codex-app-server-")
)
const generatedDir = join(temporaryRoot, "generated")

try {
  generateTypes(generatedDir)

  if (checkOnly) {
    const recordedVersion = existsSync(versionFile)
      ? readFileSync(versionFile, "utf8").trim()
      : null
    const differences = compareGeneratedDirectories(generatedDir, targetDir)

    if (recordedVersion !== codexPackageJson.version) {
      differences.unshift(
        `generated version is ${recordedVersion ?? "missing"}; installed @openai/codex is ${codexPackageJson.version}`
      )
    }

    if (differences.length > 0) {
      const visible = differences.slice(0, 25)
      const remaining = differences.length - visible.length

      console.error("Codex app-server generated types are out of date:")
      for (const difference of visible) {
        console.error(`- ${difference}`)
      }
      if (remaining > 0) {
        console.error(`- ...and ${remaining} more difference(s)`)
      }
      console.error("Run `bun run codegen:codex-app-server` and commit the result.")
      process.exitCode = 1
    } else {
      console.log(
        `Codex app-server types match @openai/codex ${codexPackageJson.version}.`
      )
    }
  } else {
    writeFileSync(
      join(generatedDir, versionFileName),
      `${codexPackageJson.version}\n`
    )
    rmSync(targetDir, { recursive: true, force: true })

    try {
      renameSync(generatedDir, targetDir)
    } catch (error) {
      if (error?.code !== "EXDEV") {
        throw error
      }

      cpSync(generatedDir, targetDir, { recursive: true })
    }

    console.log(
      `Generated Codex app-server types for @openai/codex ${codexPackageJson.version}.`
    )
  }
} finally {
  if (existsSync(temporaryRoot) && statSync(temporaryRoot).isDirectory()) {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}
