import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { dirname, join, relative } from "node:path"
import { Readable, Writable } from "node:stream"
import {
  PROTOCOL_VERSION,
  client as createAcpClient,
  methods,
  ndJsonStream,
} from "@agentclientprotocol/sdk"
import { extractAll } from "@electron/asar"

const root = process.cwd()
const distDir = join(root, "dist", "electron")
const timeoutMs = 120_000

function walk(directory) {
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

function findPackagedExecutable() {
  const files = walk(distDir)

  if (process.platform === "darwin") {
    return files.find((file) => file.endsWith(".app/Contents/MacOS/AstraFlow"))
  }

  if (process.platform === "win32") {
    return files.find(
      (file) => file.includes("win-unpacked") && file.endsWith("AstraFlow.exe")
    )
  }

  return files.find((file) =>
    ["AstraFlow", "astraflow", "astraflow-desktop"].some(
      (name) => file.includes("linux-unpacked") && file.endsWith(`/${name}`)
    )
  )
}

function getPackagedResourcesRoot(executable) {
  if (process.platform === "darwin") {
    return join(dirname(executable), "..", "Resources")
  }

  return join(dirname(executable), "resources")
}

function validatePackagedAsarLayout(executable) {
  const resourcesRoot = getPackagedResourcesRoot(executable)
  const archivePath = join(resourcesRoot, "app.asar")

  if (!existsSync(archivePath)) {
    return
  }

  const unpackedRoot = join(resourcesRoot, "app.asar.unpacked")
  const requiredUnpackedFiles = [
    join(
      unpackedRoot,
      "node_modules",
      "better-sqlite3",
      "build",
      "Release",
      "better_sqlite3.node"
    ),
    join(
      unpackedRoot,
      "node_modules",
      "node-pty",
      "build",
      "Release",
      process.platform === "win32" ? "conpty.node" : "pty.node"
    ),
  ]

  if (process.platform === "darwin") {
    requiredUnpackedFiles.push(
      join(
        unpackedRoot,
        "node_modules",
        "node-pty",
        "build",
        "Release",
        "spawn-helper"
      )
    )
  }

  for (const file of requiredUnpackedFiles) {
    if (!existsSync(file)) {
      throw new Error(`Required ASAR-unpacked runtime file is missing: ${file}`)
    }
  }

  if (process.platform === "darwin") {
    const spawnHelper = requiredUnpackedFiles.at(-1)

    if ((statSync(spawnHelper).mode & 0o111) === 0) {
      throw new Error(
        `ASAR-unpacked node-pty spawn helper is not executable: ${spawnHelper}`
      )
    }
  }
}

function smokePackagedAsarNativeRuntime(executable) {
  const resourcesRoot = getPackagedResourcesRoot(executable)
  const archivePath = join(resourcesRoot, "app.asar")

  if (!existsSync(archivePath)) {
    return
  }

  const nodeModulesRoot = join(archivePath, "node_modules")

  runChecked(
    executable,
    [
      "-e",
      [
        "const path = require('node:path')",
        "const requirePackaged = (name) => require(path.join(process.env.ASTRAFLOW_PACKAGED_NODE_MODULES, name))",
        "const Database = requirePackaged('better-sqlite3')",
        "const database = new Database(':memory:')",
        "database.close()",
        "const sharp = requirePackaged('sharp')",
        "const sharpSmoke = sharp(Buffer.from([0, 0, 0, 255]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer()",
        "const pty = requirePackaged('node-pty')",
        "const windows = process.platform === 'win32'",
        "const shell = windows ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh'",
        "const args = windows ? ['/d', '/s', '/c', 'echo astraflow-node-pty-ok'] : ['-lc', 'printf astraflow-node-pty-ok']",
        "const terminal = pty.spawn(shell, args, { cwd: process.cwd(), env: { ...process.env, TERM: 'xterm-256color' } })",
        "let output = ''",
        "terminal.onData((data) => { output += data })",
        "const ptySmoke = new Promise((resolve, reject) => { const timeout = setTimeout(() => { terminal.kill(); reject(new Error('Packaged node-pty smoke timed out.')) }, 10_000); terminal.onExit(({ exitCode }) => { clearTimeout(timeout); setTimeout(() => { if (exitCode !== 0 || !output.includes('astraflow-node-pty-ok')) { reject(new Error(`Packaged node-pty smoke failed (${exitCode}): ${output}`)); return } resolve() }, 50) }) })",
        "Promise.all([sharpSmoke, ptySmoke]).then(() => console.log('packaged-asar-native-runtime-ok')).catch((error) => { console.error(error); process.exitCode = 1 })",
      ].join("; "),
    ],
    {
      cwd: resourcesRoot,
      env: {
        ...process.env,
        ASTRAFLOW_PACKAGED_NODE_MODULES: nodeModulesRoot,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_PATH: nodeModulesRoot,
      },
    },
    "Raw packaged ASAR native runtime smoke test"
  )
}

function materializePackagedAppRoot(executable, stagingRoot) {
  const resourcesRoot = getPackagedResourcesRoot(executable)
  const legacyAppRoot = join(resourcesRoot, "app")
  const archivePath = join(resourcesRoot, "app.asar")

  if (!existsSync(archivePath) && existsSync(legacyAppRoot)) {
    return legacyAppRoot
  }

  const unpackedRoot = join(resourcesRoot, "app.asar.unpacked")

  if (!existsSync(archivePath)) {
    throw new Error(`Packaged app archive is missing: ${archivePath}`)
  }

  extractAll(archivePath, stagingRoot)

  if (existsSync(unpackedRoot)) {
    cpSync(unpackedRoot, stagingRoot, {
      recursive: true,
      force: true,
    })
  }

  return stagingRoot
}

function runChecked(command, args, options, label) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    ...options,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(
      `${label} failed with code ${result.status}: ${
        result.stderr?.trim() || result.stdout?.trim() || "unknown error"
      }`
    )
  }
}

function validatePackagedAgentRuntimeLayout(appRoot) {
  const nextTrace = walk(join(appRoot, ".next")).find((file) =>
    file.endsWith(".nft.json")
  )

  if (nextTrace) {
    throw new Error(`Next.js build trace should not be packaged: ${nextTrace}`)
  }

  const runtimeRoot = join(appRoot, "runtime", "agent-runtimes")
  const catalogPath = join(runtimeRoot, "runtime-catalog.json")

  if (!existsSync(catalogPath)) {
    throw new Error(`Packaged agent runtime catalog is missing: ${catalogPath}`)
  }

  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"))

  if (
    catalog.schemaVersion !== 1 ||
    catalog.target !== `${process.platform}-${process.arch}` ||
    !catalog.downloadBaseUrl?.startsWith("https://")
  ) {
    throw new Error(`Packaged agent runtime catalog is invalid.`)
  }

  for (const runtimeId of ["codex", "claude-code", "opencode"]) {
    const runtime = catalog.runtimes?.[runtimeId]
    const rawExecutable = join(appRoot, runtime?.executableRelativePath ?? "")

    if (!runtime || existsSync(rawExecutable)) {
      throw new Error(
        `Downloadable ${runtimeId} runtime was packaged incorrectly: ${rawExecutable}`
      )
    }
  }

  for (const nestedDependency of [
    join(
      appRoot,
      "node_modules",
      "@agentclientprotocol",
      "claude-agent-acp",
      "node_modules",
      "@anthropic-ai",
      "claude-agent-sdk"
    ),
    join(
      appRoot,
      "node_modules",
      "@agentclientprotocol",
      "codex-acp",
      "node_modules",
      "@openai",
      "codex"
    ),
  ]) {
    if (existsSync(nestedDependency)) {
      throw new Error(
        `ACP runtime dependency was packaged twice: ${nestedDependency}`
      )
    }
  }

  const sourceAstraflowAcpRoot = join(root, "runtime", "astraflow-acp")
  const packagedAstraflowAcpRoot = join(appRoot, "runtime", "astraflow-acp")

  for (const [
    sourceRelativePath,
    packagedRelativePath = sourceRelativePath,
  ] of [
    ["package.json"],
    ["package-lock.json", "package-lock.runtime.json"],
    ["host-tools-manifest.json"],
    [join("src", "index.mjs")],
  ]) {
    const sourcePath = join(sourceAstraflowAcpRoot, sourceRelativePath)
    const packagedPath = join(packagedAstraflowAcpRoot, packagedRelativePath)

    if (!existsSync(packagedPath)) {
      throw new Error(`Packaged AstraFlow ACP file is missing: ${packagedPath}`)
    }

    if (!readFileSync(sourcePath).equals(readFileSync(packagedPath))) {
      throw new Error(
        `Packaged AstraFlow ACP file differs from the shared runtime source: ${sourceRelativePath}`
      )
    }
  }

  const sourceFiles = walk(join(sourceAstraflowAcpRoot, "src"))
    .map((file) => relative(join(sourceAstraflowAcpRoot, "src"), file))
    .sort()
  const packagedFiles = walk(join(packagedAstraflowAcpRoot, "src"))
    .map((file) => relative(join(packagedAstraflowAcpRoot, "src"), file))
    .sort()

  if (JSON.stringify(packagedFiles) !== JSON.stringify(sourceFiles)) {
    throw new Error(
      "Packaged AstraFlow ACP source file set differs from runtime/astraflow-acp/src."
    )
  }

  for (const relativePath of sourceFiles) {
    const sourcePath = join(sourceAstraflowAcpRoot, "src", relativePath)
    const packagedPath = join(packagedAstraflowAcpRoot, "src", relativePath)

    if (!readFileSync(sourcePath).equals(readFileSync(packagedPath))) {
      throw new Error(
        `Packaged AstraFlow ACP source differs from the shared runtime: ${relativePath}`
      )
    }
  }

  const astraflowAcpPackage = JSON.parse(
    readFileSync(join(packagedAstraflowAcpRoot, "package.json"), "utf8")
  )
  const packagedAppPackage = JSON.parse(
    readFileSync(join(appRoot, "package.json"), "utf8")
  )

  for (const dependencyName of ["undici"]) {
    const runtimeVersion = astraflowAcpPackage.dependencies?.[dependencyName]
    const packagedVersion = packagedAppPackage.dependencies?.[dependencyName]

    if (!runtimeVersion || packagedVersion !== runtimeVersion) {
      throw new Error(
        `Packaged app must declare AstraFlow ACP dependency ${dependencyName} ${runtimeVersion || "missing"}; found ${packagedVersion || "missing"}.`
      )
    }
  }

  const nestedAstraflowAcpNodeModules = join(
    packagedAstraflowAcpRoot,
    "node_modules"
  )

  if (existsSync(nestedAstraflowAcpNodeModules)) {
    throw new Error(
      `AstraFlow ACP dependencies must not be packaged twice: ${nestedAstraflowAcpNodeModules}`
    )
  }

  for (const [dependencyName, expectedVersion] of Object.entries(
    astraflowAcpPackage.dependencies ?? {}
  )) {
    const dependencyPackagePath = join(
      appRoot,
      "node_modules",
      ...dependencyName.split("/"),
      "package.json"
    )

    if (!existsSync(dependencyPackagePath)) {
      throw new Error(
        `Shared packaged AstraFlow ACP dependency is missing: ${dependencyName}`
      )
    }

    const dependencyPackage = JSON.parse(
      readFileSync(dependencyPackagePath, "utf8")
    )

    if (dependencyPackage.version !== expectedVersion) {
      throw new Error(
        `Packaged AstraFlow ACP dependency ${dependencyName} ${dependencyPackage.version} does not match ${expectedVersion}.`
      )
    }
  }

  for (const fileName of ["astraflow-skills-mcp-server.mjs"]) {
    const sourcePath = join(root, "scripts", fileName)
    const packagedPath = join(appRoot, "scripts", fileName)

    if (
      !existsSync(packagedPath) ||
      !readFileSync(sourcePath).equals(readFileSync(packagedPath))
    ) {
      throw new Error(
        `Packaged AstraFlow ACP helper differs from the release source: ${fileName}`
      )
    }
  }

  const nodePtyRoot = join(appRoot, "node_modules", "node-pty")

  if (existsSync(join(nodePtyRoot, "prebuilds"))) {
    throw new Error(`Unused node-pty platform prebuilds were packaged.`)
  }

  const reactIconsRoot = join(appRoot, "node_modules", "react-icons")
  const expectedIconSets = new Set(["bi", "fa", "hi", "lib", "md"])

  for (const entry of readdirSync(reactIconsRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && !expectedIconSets.has(entry.name)) {
      throw new Error(`Unused react-icons set was packaged: ${entry.name}`)
    }
  }

  for (const iconSet of expectedIconSets) {
    if (!existsSync(join(reactIconsRoot, iconSet))) {
      throw new Error(`Required react-icons set is missing: ${iconSet}`)
    }
  }

  for (const redundantDocumentRuntimePath of [
    join(appRoot, "node_modules", "pdf-lib", "dist"),
    join(appRoot, "node_modules", "pdf-lib", "src"),
    join(appRoot, "node_modules", "docx", "dist", "index.iife.js"),
    join(appRoot, "node_modules", "docx", "dist", "index.umd.cjs"),
    join(appRoot, "node_modules", "pptxgenjs", "dist", "pptxgen.bundle.js"),
    join(appRoot, "node_modules", "pptxgenjs", "dist", "pptxgen.min.js"),
  ]) {
    if (existsSync(redundantDocumentRuntimePath)) {
      throw new Error(
        `Redundant document runtime file was packaged: ${redundantDocumentRuntimePath}`
      )
    }
  }

  for (const pdfJsBuildDirectory of [
    join(appRoot, "node_modules", "pdfjs-dist", "build"),
    join(appRoot, "node_modules", "pdfjs-dist", "legacy", "build"),
  ]) {
    const redundantMinifiedBuild = readdirSync(pdfJsBuildDirectory).find(
      (entry) => entry.endsWith(".min.mjs")
    )

    if (redundantMinifiedBuild) {
      throw new Error(
        `Redundant PDF.js minified build was packaged: ${join(pdfJsBuildDirectory, redundantMinifiedBuild)}`
      )
    }
  }

  const debugArtifact = walk(join(appRoot, "node_modules")).find(
    (file) =>
      file.split(/[\\/]/).some((segment) => segment.endsWith(".dSYM")) ||
      file.toLowerCase().endsWith(".pdb") ||
      file.endsWith("pi-web-fetch-demo.mp4")
  )

  if (debugArtifact) {
    throw new Error(
      `Debug or demo artifact should not be packaged: ${debugArtifact}`
    )
  }

  const recheckPlatformPackages = {
    "darwin-arm64": "recheck-macos-arm64",
    "darwin-x64": "recheck-macos-x64",
    "linux-x64": "recheck-linux-x64",
    "win32-x64": "recheck-windows-x64",
  }
  const runtimeTarget = `${process.platform}-${process.arch}`

  if (
    recheckPlatformPackages[runtimeTarget] &&
    existsSync(
      join(appRoot, "node_modules", recheckPlatformPackages[runtimeTarget])
    ) &&
    existsSync(join(appRoot, "node_modules", "recheck-jar"))
  ) {
    throw new Error(
      `Redundant recheck Java fallback was packaged with its native backend.`
    )
  }

  const koffiBuildDir = join(appRoot, "node_modules", "koffi", "build", "koffi")

  if (existsSync(koffiBuildDir)) {
    const expectedKoffiTriplets = {
      "darwin-arm64": "darwin_arm64",
      "darwin-x64": "darwin_x64",
      "linux-arm64": "linux_arm64",
      "linux-x64": "linux_x64",
      "win32-arm64": "win32_arm64",
      "win32-x64": "win32_x64",
    }
    const expectedKoffiTriplet = expectedKoffiTriplets[runtimeTarget]
    const packagedKoffiTriplets = readdirSync(koffiBuildDir, {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    if (
      expectedKoffiTriplet &&
      (packagedKoffiTriplets.length !== 1 ||
        packagedKoffiTriplets[0] !== expectedKoffiTriplet)
    ) {
      throw new Error(
        `Koffi packaged unexpected platform runtimes: ${packagedKoffiTriplets.join(", ")}`
      )
    }
  }
}

function validatePackagedDeveloperRuntimeLayout(appRoot) {
  const runtimeTarget = `${process.platform}-${process.arch}`
  const runtimeRoot = join(appRoot, "runtime", "developer-runtimes")
  const catalogPath = join(runtimeRoot, "runtime-catalog.json")

  if (!existsSync(catalogPath)) {
    throw new Error(
      `Packaged developer runtime catalog is missing: ${catalogPath}`
    )
  }

  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"))

  if (
    catalog.schemaVersion !== 1 ||
    catalog.target !== runtimeTarget ||
    !catalog.downloadBaseUrl?.startsWith("https://")
  ) {
    throw new Error("Packaged developer runtime catalog is invalid.")
  }

  for (const runtimeId of ["python", "node"]) {
    if (!catalog.runtimes?.[runtimeId]) {
      throw new Error(
        `Packaged developer runtime catalog is missing ${runtimeId}.`
      )
    }
  }

  const previouslyBundledPython = join(
    appRoot,
    "runtime",
    "python",
    runtimeTarget
  )

  if (existsSync(previouslyBundledPython)) {
    throw new Error(
      `Python must be downloaded after installation, not packaged: ${previouslyBundledPython}`
    )
  }

  if (!existsSync(join(runtimeRoot, "environment-installer.mjs"))) {
    throw new Error("Packaged environment installer is missing.")
  }

  if (
    !existsSync(join(appRoot, "electron", "developer-runtime-environment.cjs"))
  ) {
    throw new Error(
      "Packaged developer runtime environment manager is missing."
    )
  }
}

async function smokePackagedAstraflowAcp(executable, appRoot, userDataPath) {
  const runtimeRoot = join(appRoot, "runtime", "astraflow-acp")
  const runtimePackage = JSON.parse(
    readFileSync(join(runtimeRoot, "package.json"), "utf8")
  )

  runChecked(
    executable,
    [
      "-e",
      [
        "import('undici')",
        ".then(({ fetch, ProxyAgent }) => {",
        "if (typeof fetch !== 'function') throw new Error('undici fetch export is missing')",
        "if (typeof ProxyAgent !== 'function') throw new Error('undici ProxyAgent export is missing')",
        "console.log('packaged-astraflow-acp-dependencies-ok')",
        "})",
        ".catch((error) => { console.error(error); process.exitCode = 1 })",
      ].join(" "),
    ],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_PATH: join(appRoot, "node_modules"),
      },
    },
    "Packaged AstraFlow ACP dependency import smoke test"
  )

  const child = spawn(executable, [join(runtimeRoot, "src", "index.mjs")], {
    cwd: appRoot,
    env: {
      ...process.env,
      ASTRAFLOW_ACP_EXECUTION: "local",
      ASTRAFLOW_ACP_MODEL_CONFIG: JSON.stringify({
        id: "package-smoke-model",
        label: "Package smoke model",
        providerModel: "package-smoke-model",
        protocol: "openai-responses",
        baseUrl: "https://example.invalid/v1",
        reasoningEffort: "none",
        reasoningMode: "openai_reasoning_effort",
      }),
      ASTRAFLOW_ACP_STATE_ROOT: join(userDataPath, "astraflow-acp-smoke-state"),
      ASTRAFLOW_MODELVERSE_API_KEY: "package-smoke-key",
      ASTRAFLOW_PERMISSION_MODE: "auto",
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  let stderr = ""
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin),
    Readable.toWeb(child.stdout)
  )
  const app = createAcpClient({
    name: "AstraFlow packaged runtime smoke",
  })
  let timeout

  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-4_000)
  })

  try {
    const initialized = await Promise.race([
      app.connectWith(stream, (agent) =>
        agent.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: {
            name: "AstraFlow package smoke",
            version: "0.0.0",
          },
        })
      ),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                `Packaged AstraFlow ACP initialization timed out.${
                  stderr ? `\n${stderr}` : ""
                }`
              )
            ),
          20_000
        )
      }),
      new Promise((_, reject) => {
        child.once("error", reject)
        child.once("exit", (code, signal) => {
          reject(
            new Error(
              `Packaged AstraFlow ACP exited before initialization: code=${code ?? "null"} signal=${signal ?? "null"}.${
                stderr ? `\n${stderr}` : ""
              }`
            )
          )
        })
      }),
    ])

    assert.equal(initialized.protocolVersion, PROTOCOL_VERSION)
    assert.equal(initialized.agentInfo?.version, runtimePackage.version)
  } finally {
    clearTimeout(timeout)
    await stream.writable.close().catch(() => undefined)
    child.kill()
  }
}

async function smokePackagedAgentRuntime(executable, userDataPath, appRoot) {
  const packagedRequire = createRequire(import.meta.url)
  const { createAgentRuntimeEnvironmentManager } = packagedRequire(
    join(appRoot, "electron", "agent-runtime-environment.cjs")
  )
  const manager = createAgentRuntimeEnvironmentManager({
    appRoot,
    userDataPath,
  })
  const environment = await manager.ensureReady()
  const statuses = manager.getStatuses()

  assert.equal(statuses.length, 3)
  assert.ok(statuses.every((status) => status.needsInstall))
  assert.ok(environment.CODEX_PATH)
  assert.ok(environment.CLAUDE_CODE_EXECUTABLE)
  assert.ok(environment.ASTRAFLOW_OPENCODE_EXECUTABLE)
  assert.equal(existsSync(environment.CODEX_PATH), false)
  assert.equal(existsSync(environment.CLAUDE_CODE_EXECUTABLE), false)
  assert.equal(existsSync(environment.ASTRAFLOW_OPENCODE_EXECUTABLE), false)
  await smokePackagedAstraflowAcp(executable, appRoot, userDataPath)
}

function smokeBundledDocumentRuntime(executable, appRoot) {
  const nodeModulesRoot = join(appRoot, "node_modules")

  validatePackagedAgentRuntimeLayout(appRoot)
  validatePackagedDeveloperRuntimeLayout(appRoot)

  for (const slug of ["pptx", "xlsx", "docx", "pdf"]) {
    const skillPath = join(appRoot, "bundled-skills", slug, "SKILL.md")

    if (!existsSync(skillPath)) {
      throw new Error(`Packaged bundled skill is missing: ${skillPath}`)
    }
  }

  runChecked(
    executable,
    [
      "-e",
      [
        "require('docx')",
        "require('pdf-lib')",
        "require('pptxgenjs')",
        "require('react')",
        "require('react-dom/server')",
        "require('react-icons/fa')",
        "require('sharp')",
        "require('@napi-rs/canvas')",
        "import('pdfjs-dist/legacy/build/pdf.mjs').then(() => console.log('packaged-node-documents-ok')).catch((error) => { console.error(error); process.exitCode = 1 })",
      ].join("; "),
    ],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_PATH: nodeModulesRoot,
      },
    },
    "Packaged Node.js document runtime smoke test"
  )
}

const executable = findPackagedExecutable()
const smokeArgs = process.platform === "linux" ? ["--no-sandbox"] : []
const smokeEnv =
  process.platform === "linux"
    ? {
        ELECTRON_DISABLE_SANDBOX: "1",
      }
    : {}

if (!executable) {
  throw new Error(
    `Could not find a packaged AstraFlow executable in ${distDir}.`
  )
}

const smokeUserDataPath = mkdtempSync(
  join(tmpdir(), "astraflow-electron-smoke-")
)

try {
  validatePackagedAsarLayout(executable)
  smokePackagedAsarNativeRuntime(executable)

  const appRoot = materializePackagedAppRoot(
    executable,
    join(smokeUserDataPath, "app")
  )

  smokeBundledDocumentRuntime(executable, appRoot)
  await smokePackagedAgentRuntime(executable, smokeUserDataPath, appRoot)

  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, smokeArgs, {
      env: {
        ...process.env,
        ASTRAFLOW_ELECTRON_SMOKE: "1",
        ASTRAFLOW_ELECTRON_SMOKE_USER_DATA: smokeUserDataPath,
        ELECTRON_ENABLE_LOGGING: "1",
        ...smokeEnv,
      },
      stdio: "inherit",
      windowsHide: true,
    })

    const timeout = setTimeout(() => {
      child.kill()
      rejectRun(new Error(`Electron smoke run timed out: ${executable}`))
    }, timeoutMs)

    child.once("error", (error) => {
      clearTimeout(timeout)
      rejectRun(error)
    })

    child.once("exit", (code, signal) => {
      clearTimeout(timeout)

      if (code === 0) {
        resolveRun()
        return
      }

      rejectRun(
        new Error(
          `Electron smoke run failed with code ${code ?? "null"} and signal ${
            signal ?? "null"
          }.`
        )
      )
    })
  })
} finally {
  rmSync(smokeUserDataPath, { recursive: true, force: true })
}
