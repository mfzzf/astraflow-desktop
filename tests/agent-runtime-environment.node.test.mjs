import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pipeline } from "node:stream/promises"
import { afterEach, test } from "node:test"
import { createBrotliCompress } from "node:zlib"
import { c as createTar } from "tar"

import agentRuntimeEnvironment from "../electron/agent-runtime-environment.cjs"

const { createAgentRuntimeEnvironmentManager } = agentRuntimeEnvironment
const runtimeTarget = `${process.platform}-${process.arch}`
let testRoot = null

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function writeExecutable(path, contents) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
  chmodSync(path, 0o755)
}

async function createFixture() {
  testRoot = mkdtempSync(join(tmpdir(), "astraflow-agent-runtimes-"))

  const appRoot = join(testRoot, "app")
  const userDataPath = join(testRoot, "user-data")
  const runtimeRoot = join(appRoot, "runtime", "agent-runtimes")
  const codexRelativePath = join(
    "node_modules",
    "@openai",
    `codex-${runtimeTarget}`,
    "bin",
    process.platform === "win32" ? "codex.exe" : "codex"
  )
  const claudeRelativePath = join(
    "node_modules",
    "@anthropic-ai",
    `claude-agent-sdk-${runtimeTarget}`,
    process.platform === "win32" ? "claude.exe" : "claude"
  )
  const codexPath = join(appRoot, codexRelativePath)
  const claudePath = join(appRoot, claudeRelativePath)

  writeExecutable(codexPath, "fake-codex-runtime")
  writeExecutable(claudePath, "fake-claude-runtime")
  mkdirSync(runtimeRoot, { recursive: true })

  const archiveName = `${runtimeTarget}.tar.br`
  const archivePath = join(runtimeRoot, archiveName)

  await pipeline(
    createTar(
      { cwd: appRoot, noMtime: true, portable: true },
      [codexRelativePath, claudeRelativePath]
    ),
    createBrotliCompress(),
    createWriteStream(archivePath)
  )

  const manifest = {
    schemaVersion: 1,
    target: runtimeTarget,
    archive: archiveName,
    archiveSha256: sha256File(archivePath),
    archiveSize: statSync(archivePath).size,
    verifyCodeSignatures: false,
    executables: {
      codex: {
        relativePath: codexRelativePath,
        sha256: sha256File(codexPath),
      },
      claude: {
        relativePath: claudeRelativePath,
        sha256: sha256File(claudePath),
      },
    },
  }

  writeFileSync(
    join(runtimeRoot, "runtime-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  )

  return { appRoot, archivePath, manifest, runtimeRoot, userDataPath }
}

afterEach(() => {
  if (testRoot) {
    rmSync(testRoot, { recursive: true, force: true })
    testRoot = null
  }
})

test("extracts and reuses the packaged native agent runtimes", async () => {
  const fixture = await createFixture()
  const manager = createAgentRuntimeEnvironmentManager(fixture)
  const environment = await manager.ensureReady()

  assert.equal(environment.CODEX_PATH, environment.ASTRAFLOW_CODEX_EXECUTABLE)
  assert.equal(
    readFileSync(environment.ASTRAFLOW_CODEX_EXECUTABLE, "utf8"),
    "fake-codex-runtime"
  )
  assert.equal(
    readFileSync(environment.CLAUDE_CODE_EXECUTABLE, "utf8"),
    "fake-claude-runtime"
  )
  assert.ok(environment.PATH.includes(dirname(environment.CODEX_PATH)))
  assert.ok(existsSync(environment.ASTRAFLOW_AGENT_RUNTIME_ROOT))

  rmSync(fixture.archivePath)

  const reusedEnvironment = await createAgentRuntimeEnvironmentManager(
    fixture
  ).ensureReady()

  assert.equal(
    reusedEnvironment.ASTRAFLOW_AGENT_RUNTIME_ROOT,
    environment.ASTRAFLOW_AGENT_RUNTIME_ROOT
  )
})

test("rejects a packaged runtime archive with a mismatched hash", async () => {
  const fixture = await createFixture()
  const archive = readFileSync(fixture.archivePath)

  archive[Math.floor(archive.length / 2)] ^= 0xff
  writeFileSync(fixture.archivePath, archive)

  await assert.rejects(
    createAgentRuntimeEnvironmentManager(fixture).ensureReady(),
    /failed SHA-256 validation/
  )
})

test("rejects an extracted executable with a mismatched hash", async () => {
  const fixture = await createFixture()
  const manifestPath = join(fixture.runtimeRoot, "runtime-manifest.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))

  manifest.executables.codex.sha256 = "0".repeat(64)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  await assert.rejects(
    createAgentRuntimeEnvironmentManager(fixture).ensureReady(),
    /codex executable failed SHA-256 validation/
  )
})
