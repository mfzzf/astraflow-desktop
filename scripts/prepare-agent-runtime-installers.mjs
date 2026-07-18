import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { pipeline } from "node:stream/promises"
import { constants as zlibConstants, createBrotliCompress } from "node:zlib"
import { c as createTar } from "tar"

import { getAgentRuntimePackageSpecs } from "./agent-runtime-packages.mjs"

const root = process.cwd()
const runtimeTarget =
  process.env.ASTRAFLOW_RUNTIME_TARGET?.trim() ||
  `${process.platform}-${process.arch}`
const nodeModulesDir = join(root, "node_modules")
const outputRoot = join(root, "dist", "agent-runtime-installers")
const brotliQuality = 5

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function runChecked(command, args, label) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(
      `${label} failed: ${
        result.stderr?.trim() || result.stdout?.trim() || result.status
      }`
    )
  }
}

function prepareMacCodeSignature(spec) {
  if (process.platform !== "darwin") {
    return false
  }

  const identity = process.env.ASTRAFLOW_RUNTIME_SIGNING_IDENTITY?.trim()
  const keychain = process.env.ASTRAFLOW_RUNTIME_SIGNING_KEYCHAIN?.trim()

  if (spec.id === "opencode" && identity) {
    runChecked(
      "/usr/bin/codesign",
      [
        "--force",
        "--options",
        "runtime",
        "--timestamp",
        "--sign",
        identity,
        ...(keychain ? ["--keychain", keychain] : []),
        spec.executablePath,
      ],
      `${spec.label} code signing`
    )
  }

  const verification = spawnSync(
    "/usr/bin/codesign",
    ["--verify", "--strict", "--verbose=2", spec.executablePath],
    { encoding: "utf8" }
  )

  if (verification.status === 0) {
    return true
  }

  if (process.env.ASTRAFLOW_ALLOW_UNSIGNED_RUNTIME === "1") {
    console.warn(
      `Preparing unsigned ${spec.label} runtime because ASTRAFLOW_ALLOW_UNSIGNED_RUNTIME=1.`
    )
    return false
  }

  throw new Error(
    `${spec.label} runtime is not signed with a valid macOS code signature. ` +
      "Set ASTRAFLOW_RUNTIME_SIGNING_IDENTITY or use ASTRAFLOW_ALLOW_UNSIGNED_RUNTIME=1 for a local-only build."
  )
}

rmSync(outputRoot, { recursive: true, force: true })

const specs = getAgentRuntimePackageSpecs({
  appRoot: root,
  nodeModulesDir,
  runtimeTarget,
})

for (const spec of specs) {
  const runtimeOutput = join(outputRoot, spec.id, spec.version, runtimeTarget)
  const stagingArchivePath = join(runtimeOutput, `${spec.id}.tar.br`)

  mkdirSync(runtimeOutput, { recursive: true })
  const verifyCodeSignature = prepareMacCodeSignature(spec)
  console.log(
    `Compressing ${spec.label} ${spec.version} for ${runtimeTarget}...`
  )
  await pipeline(
    createTar(
      {
        cwd: root,
        noMtime: true,
        portable: true,
      },
      [spec.packageRelativePath]
    ),
    createBrotliCompress({
      params: {
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_GENERIC,
        [zlibConstants.BROTLI_PARAM_QUALITY]: brotliQuality,
      },
    }),
    createWriteStream(stagingArchivePath)
  )

  const archiveSha256 = sha256File(stagingArchivePath)
  const archiveName = `${spec.id}-${archiveSha256}.tar.br`
  const archivePath = join(runtimeOutput, archiveName)
  renameSync(stagingArchivePath, archivePath)

  const manifest = {
    schemaVersion: 1,
    runtimeId: spec.id,
    label: spec.label,
    version: spec.version,
    target: runtimeTarget,
    archive: archiveName,
    archiveSha256,
    archiveSize: statSync(archivePath).size,
    verifyCodeSignature,
    executable: {
      relativePath: spec.executableRelativePath,
      sha256: sha256File(spec.executablePath),
    },
  }

  writeFileSync(
    join(runtimeOutput, "runtime-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  )

  console.log(
    `Prepared ${spec.label} installer (${Math.ceil(
      manifest.archiveSize / (1024 * 1024)
    )} MiB).`
  )
}
