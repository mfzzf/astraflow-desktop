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
import { createBrotliCompress } from "node:zlib"
import { afterEach, test } from "node:test"
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
  const sourceRoot = join(testRoot, "source")
  const userDataPath = join(testRoot, "user-data")
  const catalogRoot = join(appRoot, "runtime", "agent-runtimes")
  const archivePath = join(testRoot, "codex.tar.br")
  const executableRelativePath = join(
    "node_modules",
    "@openai",
    "codex-test",
    process.platform === "win32" ? "codex.exe" : "codex"
  )
  const sourceExecutable = join(sourceRoot, executableRelativePath)

  writeExecutable(sourceExecutable, "fake-codex-runtime")
  mkdirSync(catalogRoot, { recursive: true })
  await pipeline(
    createTar({ cwd: sourceRoot, noMtime: true, portable: true }, [
      executableRelativePath,
    ]),
    createBrotliCompress(),
    createWriteStream(archivePath)
  )

  const catalog = {
    schemaVersion: 1,
    target: runtimeTarget,
    downloadBaseUrl: "https://runtime.test/agent-runtimes/v1",
    runtimes: {
      codex: {
        id: "codex",
        label: "Codex",
        version: "1.2.3",
        executableRelativePath,
      },
      "claude-code": {
        id: "claude-code",
        label: "Claude Code",
        version: "2.3.4",
        executableRelativePath: join("node_modules", "claude", "claude"),
      },
      opencode: {
        id: "opencode",
        label: "OpenCode",
        version: "3.4.5",
        executableRelativePath: join("node_modules", "opencode", "opencode"),
      },
    },
  }
  const manifest = {
    schemaVersion: 1,
    runtimeId: "codex",
    label: "Codex",
    version: "1.2.3",
    target: runtimeTarget,
    archive: "codex.tar.br",
    archiveSha256: sha256File(archivePath),
    archiveSize: statSync(archivePath).size,
    verifyCodeSignature: false,
    executable: {
      relativePath: executableRelativePath,
      sha256: sha256File(sourceExecutable),
    },
  }

  writeFileSync(
    join(catalogRoot, "runtime-catalog.json"),
    `${JSON.stringify(catalog, null, 2)}\n`
  )

  const fetchImpl = async (url) => {
    const value = String(url)

    if (value.endsWith("/runtime-manifest.json")) {
      return Response.json(manifest)
    }

    if (value.endsWith("/codex.tar.br")) {
      return new Response(readFileSync(archivePath), {
        headers: { "content-length": String(manifest.archiveSize) },
      })
    }

    return new Response("not found", { status: 404 })
  }

  return {
    appRoot,
    archivePath,
    catalog,
    fetchImpl,
    manifest,
    userDataPath,
  }
}

afterEach(() => {
  if (testRoot) {
    rmSync(testRoot, { recursive: true, force: true })
    testRoot = null
  }
})

test("downloads, installs, and reuses an agent runtime", async () => {
  const fixture = await createFixture()
  const events = []
  const manager = createAgentRuntimeEnvironmentManager({
    ...fixture,
    onStatusChanged: (status) => events.push(status),
  })
  const environment = await manager.ensureReady()

  assert.equal(manager.getStatuses()[0].phase, "idle")
  assert.equal(existsSync(environment.CODEX_PATH), false)

  const installed = await manager.install("codex")

  assert.equal(installed.phase, "ready")
  assert.equal(installed.ready, true)
  assert.equal(
    readFileSync(environment.ASTRAFLOW_CODEX_EXECUTABLE, "utf8"),
    "fake-codex-runtime"
  )
  assert.ok(events.some((status) => status.phase === "downloading"))
  assert.ok(events.some((status) => status.phase === "installing"))
  assert.equal(events.at(-1).phase, "ready")

  const reusedManager = createAgentRuntimeEnvironmentManager(fixture)

  assert.equal(reusedManager.getStatuses()[0].phase, "ready")
  assert.equal((await reusedManager.install("codex")).phase, "ready")
})

test("uses repository runtimes directly in development", async () => {
  testRoot = mkdtempSync(join(tmpdir(), "astraflow-agent-runtimes-dev-"))
  const manager = createAgentRuntimeEnvironmentManager({
    appRoot: join(testRoot, "app"),
    userDataPath: join(testRoot, "user-data"),
    developmentRuntimes: {
      codex: { id: "codex", label: "Codex", version: "1.2.3" },
      "claude-code": {
        id: "claude-code",
        label: "Claude Code",
        version: "2.3.4",
      },
      opencode: { id: "opencode", label: "OpenCode", version: "3.4.5" },
    },
    fetchImpl: async () => {
      throw new Error("development runtimes must not download")
    },
  })

  assert.deepEqual(
    manager.getStatuses().map((status) => ({
      runtimeId: status.runtimeId,
      phase: status.phase,
      ready: status.ready,
      needsInstall: status.needsInstall,
    })),
    [
      {
        runtimeId: "codex",
        phase: "ready",
        ready: true,
        needsInstall: false,
      },
      {
        runtimeId: "claude-code",
        phase: "ready",
        ready: true,
        needsInstall: false,
      },
      {
        runtimeId: "opencode",
        phase: "ready",
        ready: true,
        needsInstall: false,
      },
    ]
  )
  assert.deepEqual(await manager.ensureReady(), {})
  for (const runtimeId of ["codex", "claude-code", "opencode"]) {
    assert.deepEqual(await manager.install(runtimeId), {
      runtimeId,
      label:
        runtimeId === "codex"
          ? "Codex"
          : runtimeId === "claude-code"
            ? "Claude Code"
            : "OpenCode",
      version:
        runtimeId === "codex"
          ? "1.2.3"
          : runtimeId === "claude-code"
            ? "2.3.4"
            : "3.4.5",
      phase: "ready",
      ready: true,
      needsInstall: false,
      percent: 100,
      transferred: 0,
      total: 0,
      bytesPerSecond: null,
      message: null,
    })
  }
  await assert.rejects(
    manager.install("unknown-runtime"),
    /Unknown downloadable agent runtime: unknown-runtime/
  )
})

test("rejects a downloaded runtime archive with a mismatched hash", async () => {
  const fixture = await createFixture()
  fixture.manifest.archiveSha256 = "0".repeat(64)
  const manager = createAgentRuntimeEnvironmentManager(fixture)

  await assert.rejects(
    manager.install("codex"),
    /download failed SHA-256 validation/
  )
  assert.equal(manager.getStatuses()[0].phase, "error")
})

test("rejects an installed executable with a mismatched hash", async () => {
  const fixture = await createFixture()
  fixture.manifest.executable.sha256 = "0".repeat(64)
  const manager = createAgentRuntimeEnvironmentManager(fixture)

  await assert.rejects(
    manager.install("codex"),
    /executable failed SHA-256 validation/
  )
  assert.equal(manager.getStatuses()[0].ready, false)
})
