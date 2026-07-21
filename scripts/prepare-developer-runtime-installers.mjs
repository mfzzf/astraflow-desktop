import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { pipeline } from "node:stream/promises"
import { constants as zlibConstants, createBrotliCompress } from "node:zlib"
import { c as createTar } from "tar"

import {
  createDeveloperRuntimeCatalog,
  NODE_RUNTIME_VERSION,
  NPM_RUNTIME_VERSION,
} from "./developer-runtime-packages.mjs"

const root = process.cwd()
const runtimeTarget =
  process.env.ASTRAFLOW_RUNTIME_TARGET?.trim() ||
  `${process.platform}-${process.arch}`
const outputRoot = join(root, "dist", "developer-runtime-installers")
const brotliQuality = 5

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${
        result.stderr?.trim() || result.stdout?.trim() || result.status
      }`
    )
  }

  return result.stdout.trim()
}

function nodeRuntimeRoot() {
  const executable = realpathSync.native(process.execPath)

  return process.platform === "win32"
    ? dirname(executable)
    : resolve(dirname(executable), "..")
}

function portablePath(value) {
  return value.split(sep).join("/")
}

function assertRuntimeFile(runtimeRoot, relativePath, label) {
  const path = join(runtimeRoot, relativePath)

  if (!existsSync(path)) {
    throw new Error(`${label} is missing: ${path}`)
  }

  return path
}

async function packageRuntime({
  commands,
  entries: configuredEntries,
  id,
  label,
  runtimeRoot,
  version,
}) {
  const runtimeOutput = join(outputRoot, id, version, runtimeTarget)
  const temporaryArchive = join(runtimeOutput, `${id}.tar.br`)
  const entries = configuredEntries ?? readdirSync(runtimeRoot)

  if (!entries.length) {
    throw new Error(`${label} runtime root is empty: ${runtimeRoot}`)
  }

  mkdirSync(runtimeOutput, { recursive: true })
  await pipeline(
    createTar(
      {
        cwd: runtimeRoot,
        noMtime: true,
        portable: true,
      },
      entries
    ),
    createBrotliCompress({
      params: {
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_GENERIC,
        [zlibConstants.BROTLI_PARAM_QUALITY]: brotliQuality,
      },
    }),
    createWriteStream(temporaryArchive)
  )

  const archiveSha256 = sha256File(temporaryArchive)
  const archive = `${id}-${archiveSha256}.tar.br`
  const archivePath = join(runtimeOutput, archive)
  renameSync(temporaryArchive, archivePath)

  const commandFiles = Object.fromEntries(
    Object.entries(commands).map(([name, relativePath]) => {
      const path = assertRuntimeFile(
        runtimeRoot,
        relativePath,
        `${label} ${name}`
      )

      return [
        name,
        {
          relativePath: portablePath(relative(runtimeRoot, path)),
          sha256: sha256File(path),
        },
      ]
    })
  )
  const manifest = {
    schemaVersion: 1,
    runtimeId: id,
    label,
    version,
    target: runtimeTarget,
    archive,
    archiveSha256,
    archiveSize: statSync(archivePath).size,
    commands: commandFiles,
  }

  writeFileSync(
    join(runtimeOutput, "runtime-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  )
  console.log(
    `Prepared ${label} ${version} (${Math.ceil(
      manifest.archiveSize / (1024 * 1024)
    )} MiB).`
  )
}

if (`${process.platform}-${process.arch}` !== runtimeTarget) {
  throw new Error(
    `Developer runtimes must be prepared on the target host (${runtimeTarget}).`
  )
}

if (process.versions.node !== NODE_RUNTIME_VERSION) {
  throw new Error(
    `Node.js ${NODE_RUNTIME_VERSION} is required; received ${process.versions.node}.`
  )
}

const npmCli = join(
  nodeRuntimeRoot(),
  ...(process.platform === "win32" ? [] : ["lib"]),
  "node_modules",
  "npm",
  "bin",
  "npm-cli.js"
)
const npmVersion = commandOutput(process.execPath, [npmCli, "--version"])

if (npmVersion !== NPM_RUNTIME_VERSION) {
  throw new Error(
    `npm ${NPM_RUNTIME_VERSION} is required; received ${npmVersion}.`
  )
}

const catalog = createDeveloperRuntimeCatalog({
  appRoot: root,
  runtimeTarget,
})
const pythonRoot = join(
  root,
  "runtime",
  "python",
  "distributions",
  runtimeTarget
)
const nodeRoot = nodeRuntimeRoot()
const nodeEntries = (
  process.platform === "win32"
    ? [
        "node.exe",
        "npm",
        "npm.cmd",
        "npx",
        "npx.cmd",
        "node_modules/npm",
        "LICENSE",
        "README.md",
      ]
    : [
        "bin/node",
        "bin/npm",
        "bin/npx",
        "lib/node_modules/npm",
        "LICENSE",
        "README.md",
      ]
).filter((entry) => existsSync(join(nodeRoot, entry)))

for (const runtimeRoot of [pythonRoot, nodeRoot]) {
  if (!existsSync(runtimeRoot) || !lstatSync(runtimeRoot).isDirectory()) {
    throw new Error(`Developer runtime root is unavailable: ${runtimeRoot}`)
  }
}

rmSync(outputRoot, { recursive: true, force: true })
await packageRuntime({
  ...catalog.runtimes.python,
  runtimeRoot: pythonRoot,
})
await packageRuntime({
  ...catalog.runtimes.node,
  entries: nodeEntries,
  runtimeRoot: nodeRoot,
})
