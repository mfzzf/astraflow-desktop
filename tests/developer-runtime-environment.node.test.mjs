import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  chmodSync,
  createWriteStream,
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

import developerRuntimeEnvironment from "../electron/developer-runtime-environment.cjs"

const { createDeveloperRuntimeEnvironmentManager } = developerRuntimeEnvironment
const runtimeTarget = `${process.platform}-${process.arch}`
let testRoot = null

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function writeExecutable(path, contents) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
  chmodSync(path, 0o755)
}

async function runtimeFixture(id, version, commands) {
  const sourceRoot = join(testRoot, `source-${id}`)
  const archivePath = join(testRoot, `${id}.tar.br`)
  const commandMetadata = {}

  for (const [name, relativePath] of Object.entries(commands)) {
    const path = join(sourceRoot, relativePath)
    const output =
      name === "python"
        ? version
        : name === "pip"
          ? "pip 25.0"
          : name === "node"
            ? `v${version}`
            : "11.13.0"
    writeExecutable(
      path,
      process.platform === "win32"
        ? `fake-${id}-${name}`
        : `#!/bin/sh\n# fake-${id}-${name}\nprintf '%s\\n' '${output}'\n`
    )
    commandMetadata[name] = { relativePath, sha256: sha256(path) }
  }

  await pipeline(
    createTar({ cwd: sourceRoot, noMtime: true, portable: true }, ["."]),
    createBrotliCompress(),
    createWriteStream(archivePath)
  )

  return {
    archivePath,
    manifest: {
      schemaVersion: 1,
      runtimeId: id,
      label: id === "python" ? "Python" : "Node.js + npm",
      version,
      target: runtimeTarget,
      archive: `${id}.tar.br`,
      archiveSha256: sha256(archivePath),
      archiveSize: statSync(archivePath).size,
      commands: commandMetadata,
    },
  }
}

async function createFixture() {
  testRoot = mkdtempSync(join(tmpdir(), "astraflow-developer-runtimes-"))
  const appRoot = join(testRoot, "app")
  const userDataPath = join(testRoot, "user-data")
  const catalogRoot = join(appRoot, "runtime", "developer-runtimes")
  const windows = process.platform === "win32"
  const runtimes = {
    python: {
      id: "python",
      label: "Python",
      version: "3.12.13",
      commands: {
        python: windows ? "python.exe" : "bin/python3",
        pip: windows ? "Scripts/pip.cmd" : "bin/pip3",
      },
    },
    node: {
      id: "node",
      label: "Node.js + npm",
      version: "24.17.0",
      packageManagerVersion: "11.13.0",
      commands: {
        node: windows ? "node.exe" : "bin/node",
        npm: windows ? "npm.cmd" : "bin/npm",
        npx: windows ? "npx.cmd" : "bin/npx",
      },
    },
  }
  const fixtures = Object.fromEntries(
    await Promise.all(
      Object.values(runtimes).map(async (runtime) => [
        runtime.id,
        await runtimeFixture(runtime.id, runtime.version, runtime.commands),
      ])
    )
  )

  mkdirSync(catalogRoot, { recursive: true })
  writeFileSync(
    join(catalogRoot, "runtime-catalog.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        target: runtimeTarget,
        downloadBaseUrl: "https://runtime.test/developer-runtimes/v1",
        runtimes,
      },
      null,
      2
    )}\n`
  )

  const fetchImpl = async (url) => {
    const match = String(url).match(/\/(python|node)\/[^/]+\/[^/]+\/([^/]+)$/)

    if (!match) {
      return new Response("not found", { status: 404 })
    }

    const fixture = fixtures[match[1]]

    return match[2] === "runtime-manifest.json"
      ? Response.json(fixture.manifest)
      : new Response(readFileSync(fixture.archivePath))
  }

  return { appRoot, fetchImpl, userDataPath }
}

afterEach(() => {
  if (testRoot) {
    rmSync(testRoot, { recursive: true, force: true })
    testRoot = null
  }
})

test("downloads checksummed Python and Node.js/npm runtimes outside the app", async () => {
  const fixture = await createFixture()
  const events = []
  const manager = createDeveloperRuntimeEnvironmentManager({
    ...fixture,
    onStatusChanged: (status) => events.push(status),
  })
  const environment = manager.getProcessEnvironment()

  assert.equal(
    manager.getStatuses().every((status) => status.needsInstall),
    true
  )
  assert.match(environment.ASTRAFLOW_DEVELOPER_RUNTIME_ROOT, /user-data/)
  assert.match(environment.ASTRAFLOW_NPM_EXECUTABLE, /developer-runtimes/)

  const statuses = await manager.ensureInstalled()

  assert.equal(
    statuses.every((status) => status.ready),
    true
  )
  assert.equal(
    readFileSync(
      environment.ASTRAFLOW_DEVELOPER_NODE_EXECUTABLE,
      "utf8"
    ).includes("fake-node-node"),
    true
  )
  assert.equal(
    readFileSync(manager.getRuntimePaths().python.python, "utf8").includes(
      "fake-python-python"
    ),
    true
  )
  assert.ok(events.some((status) => status.phase === "downloading"))
  assert.ok(events.some((status) => status.phase === "installing"))
})

test(
  "executes runtime commands during health checks",
  { skip: process.platform === "win32" },
  async () => {
    const fixture = await createFixture()
    const manager = createDeveloperRuntimeEnvironmentManager(fixture)

    await manager.ensureInstalled()
    const health = await manager.checkHealth()

    assert.equal(health.length, 2)
    assert.equal(
      health.every((runtime) => runtime.installed && runtime.healthy),
      true
    )
    assert.deepEqual(
      health
        .find((runtime) => runtime.runtimeId === "node")
        .checks.map((check) => check.command),
      ["node", "npm", "npx"]
    )
  }
)

test(
  "force-repairs an installed runtime that fails its health check",
  { skip: process.platform === "win32" },
  async () => {
    const fixture = await createFixture()
    const manager = createDeveloperRuntimeEnvironmentManager(fixture)

    await manager.install("node")
    writeExecutable(manager.getRuntimePaths().node.node, "#!/bin/sh\nexit 23\n")

    const failedHealth = await manager.checkHealth("node")
    assert.equal(failedHealth.installed, true)
    assert.equal(failedHealth.healthy, false)

    await manager.install("node", { force: true })
    const repairedHealth = await manager.checkHealth("node")
    assert.equal(repairedHealth.healthy, true)
  }
)

test("rejects a developer runtime with an invalid archive hash", async () => {
  const fixture = await createFixture()
  const originalFetch = fixture.fetchImpl
  fixture.fetchImpl = async (url) => {
    const response = await originalFetch(url)

    if (String(url).endsWith("runtime-manifest.json")) {
      const manifest = await response.json()
      manifest.archiveSha256 = "0".repeat(64)
      return Response.json(manifest)
    }

    return response
  }
  const manager = createDeveloperRuntimeEnvironmentManager(fixture)

  await assert.rejects(
    manager.install("python"),
    /download failed SHA-256 validation/
  )
  assert.equal(
    manager.getStatuses().find((status) => status.runtimeId === "python").phase,
    "error"
  )
})

test("serializes concurrent installs from the app and MCP helper", async () => {
  const fixture = await createFixture()
  const originalFetch = fixture.fetchImpl
  let pythonArchiveDownloads = 0
  fixture.fetchImpl = async (url) => {
    if (String(url).endsWith("/python.tar.br")) {
      pythonArchiveDownloads += 1
    }

    return originalFetch(url)
  }
  const appManager = createDeveloperRuntimeEnvironmentManager(fixture)
  const toolManager = createDeveloperRuntimeEnvironmentManager(fixture)
  const [appStatus, toolStatus] = await Promise.all([
    appManager.install("python"),
    toolManager.install("python"),
  ])

  assert.equal(appStatus.ready, true)
  assert.equal(toolStatus.ready, true)
  assert.equal(pythonArchiveDownloads, 1)
})

test("refreshes cached status after another process installs a runtime", async () => {
  const fixture = await createFixture()
  const appManager = createDeveloperRuntimeEnvironmentManager(fixture)
  const toolManager = createDeveloperRuntimeEnvironmentManager(fixture)

  assert.equal(
    appManager.getStatuses().find((status) => status.runtimeId === "python")
      .ready,
    false
  )
  await toolManager.install("python")

  const refreshed = appManager
    .getStatuses()
    .find((status) => status.runtimeId === "python")
  assert.equal(refreshed.ready, true)
  assert.equal(refreshed.phase, "ready")
})
