import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { fetchGitHubReleaseAssetWithRetry } from "./download-with-retry.mjs"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const root = resolve(scriptDirectory, "..")
const pythonConfigRoot = join(root, "runtime", "python")
const manifestPath = join(pythonConfigRoot, "runtime-manifest.json")
const bootstrapRequirementsPath = join(
  pythonConfigRoot,
  "bootstrap-requirements.txt"
)
const outputRoot = join(pythonConfigRoot, "distributions")
const cacheRoot = join(root, ".cache", "astraflow-runtimes", "python")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
const runtimeTarget =
  process.env.ASTRAFLOW_RUNTIME_TARGET?.trim() ||
  `${process.platform}-${process.arch}`
const target = manifest.targets[runtimeTarget]

if (!target) {
  throw new Error(
    `Bundled Python does not support ${runtimeTarget}. Supported targets: ${Object.keys(
      manifest.targets
    ).join(", ")}`
  )
}

if (runtimeTarget !== `${process.platform}-${process.arch}`) {
  throw new Error(
    `Bundled Python must be prepared on its target host. Requested ${runtimeTarget}, running on ${process.platform}-${process.arch}.`
  )
}

const archivePath = join(cacheRoot, target.archive)
const outputDirectory = join(outputRoot, runtimeTarget)
const stagingDirectory = `${outputDirectory}.staging-${process.pid}`
const runtimeMarkerPath = join(
  outputDirectory,
  ".astraflow-python-runtime.json"
)

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function pythonExecutable(runtimeRoot) {
  return process.platform === "win32"
    ? join(runtimeRoot, "python.exe")
    : join(runtimeRoot, "bin", "python3")
}

function pythonEnvironment(runtimeRoot) {
  const binDirectory =
    process.platform === "win32" ? runtimeRoot : join(runtimeRoot, "bin")
  const pathSeparator = process.platform === "win32" ? ";" : ":"

  return {
    ...process.env,
    PATH: `${binDirectory}${pathSeparator}${process.env.PATH ?? ""}`,
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    PYTHONHOME: runtimeRoot,
    PYTHONNOUSERSITE: "1",
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    ...options,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited ${result.status}: ${
        result.stderr?.trim() || result.stdout?.trim() || "unknown error"
      }`
    )
  }

  return result.stdout?.trim() || ""
}

async function downloadArchive() {
  mkdirSync(cacheRoot, { recursive: true })

  if (existsSync(archivePath) && sha256File(archivePath) === target.sha256) {
    return
  }

  rmSync(archivePath, { force: true })

  const archiveUrl = `${manifest.assetUrlPrefix}/${target.archive}`
  console.log(`Downloading managed Python ${manifest.pythonVersion} for ${runtimeTarget}.`)
  const response = await fetchGitHubReleaseAssetWithRetry(archiveUrl)

  const bytes = Buffer.from(await response.arrayBuffer())
  writeFileSync(archivePath, bytes)

  const actualSha256 = sha256File(archivePath)

  if (actualSha256 !== target.sha256) {
    rmSync(archivePath, { force: true })
    throw new Error(
      `Bundled Python checksum mismatch for ${target.archive}: expected ${target.sha256}, received ${actualSha256}.`
    )
  }
}

function expectedMarker() {
  return {
    schemaVersion: 1,
    target: runtimeTarget,
    distribution: manifest.distribution,
    release: manifest.release,
    pythonVersion: manifest.pythonVersion,
    archive: target.archive,
    archiveSha256: target.sha256,
    bootstrapRequirementsSha256: sha256File(bootstrapRequirementsPath),
  }
}

function markerMatches(expected) {
  if (!existsSync(runtimeMarkerPath) || !existsSync(pythonExecutable(outputDirectory))) {
    return false
  }

  try {
    const actual = JSON.parse(readFileSync(runtimeMarkerPath, "utf8"))

    return Object.entries(expected).every(
      ([key, value]) => actual[key] === value
    )
  } catch {
    return false
  }
}

function smokeRuntime(runtimeRoot, { capture = false } = {}) {
  const executable = pythonExecutable(runtimeRoot)
  const smokeCode = [
    "import pip",
    "import venv",
    "print('AstraFlow Python bootstrap OK')",
  ].join("; ")

  return run(executable, ["-c", smokeCode], {
    capture,
    env: pythonEnvironment(runtimeRoot),
  })
}

function normalizeConsoleScriptShebangs(runtimeRoot) {
  if (process.platform === "win32") {
    return
  }

  const binDirectory = join(runtimeRoot, "bin")

  for (const entry of readdirSync(binDirectory, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue
    }

    const scriptPath = join(binDirectory, entry.name)
    const content = readFileSync(scriptPath)

    if (content[0] !== 0x23 || content[1] !== 0x21) {
      continue
    }

    const newlineIndex = content.indexOf(0x0a)
    const firstLineEnd = newlineIndex >= 0 ? newlineIndex : content.length
    const firstLine = content.subarray(0, firstLineEnd).toString("utf8")

    if (!/python(?:3(?:\.\d+)?)?(?:\s|$)/i.test(firstLine)) {
      continue
    }

    writeFileSync(
      scriptPath,
      Buffer.concat([
        Buffer.from(
          [
            "#!/bin/sh",
            `'''exec' "$(dirname "$0")/python3" "$0" "$@"`,
            "' '''",
          ].join("\n")
        ),
        content.subarray(firstLineEnd),
      ])
    )
  }
}

function prepareWindowsPipLauncher(runtimeRoot) {
  if (process.platform !== "win32") {
    return
  }

  const scriptsDirectory = join(runtimeRoot, "Scripts")

  mkdirSync(scriptsDirectory, { recursive: true })
  writeFileSync(
    join(scriptsDirectory, "pip.cmd"),
    '@echo off\r\n"%~dp0..\\python.exe" -m pip %*\r\n'
  )
}

async function prepare() {
  const marker = expectedMarker()

  if (markerMatches(marker)) {
    prepareWindowsPipLauncher(outputDirectory)
    normalizeConsoleScriptShebangs(outputDirectory)
    smokeRuntime(outputDirectory, { capture: true })
    console.log(
      `Bundled Python ${manifest.pythonVersion} for ${runtimeTarget} is ready.`
    )
    return
  }

  await downloadArchive()
  rmSync(stagingDirectory, { recursive: true, force: true })
  mkdirSync(stagingDirectory, { recursive: true })

  try {
    run("tar", ["-xzf", archivePath, "-C", stagingDirectory])

    const extractedRoot = join(stagingDirectory, "python")

    if (!existsSync(pythonExecutable(extractedRoot))) {
      throw new Error(
        `Python archive ${target.archive} did not contain the expected runtime layout.`
      )
    }

    rmSync(outputDirectory, { recursive: true, force: true })
    mkdirSync(dirname(outputDirectory), { recursive: true })
    renameSync(extractedRoot, outputDirectory)
    rmSync(stagingDirectory, { recursive: true, force: true })

    const executable = pythonExecutable(outputDirectory)
    const env = pythonEnvironment(outputDirectory)
    const pipCheck = spawnSync(executable, ["-m", "pip", "--version"], {
      cwd: root,
      env,
      encoding: "utf8",
      stdio: "ignore",
    })

    if (pipCheck.status !== 0) {
      run(executable, ["-m", "ensurepip", "--upgrade"], { env })
    }

    run(
      executable,
      [
        "-m",
        "pip",
        "install",
        "--no-cache-dir",
        "--only-binary=:all:",
        "--requirement",
        bootstrapRequirementsPath,
      ],
      { env }
    )
    prepareWindowsPipLauncher(outputDirectory)
    normalizeConsoleScriptShebangs(outputDirectory)
    run(executable, ["-m", "pip", "check"], { env })
    smokeRuntime(outputDirectory)

    const frozenPackages = run(
      executable,
      ["-m", "pip", "freeze", "--all"],
      { capture: true, env }
    )

    writeFileSync(
      runtimeMarkerPath,
      `${JSON.stringify(
        {
          ...marker,
          packages: frozenPackages.split(/\r?\n/).filter(Boolean),
        },
        null,
        2
      )}\n`
    )
  } catch (error) {
    rmSync(stagingDirectory, { recursive: true, force: true })
    rmSync(outputDirectory, { recursive: true, force: true })
    throw error
  }
}

await prepare()
