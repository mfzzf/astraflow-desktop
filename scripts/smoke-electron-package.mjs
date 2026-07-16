import { spawn, spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"
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
  const manifestPath = join(runtimeRoot, "runtime-manifest.json")

  if (!existsSync(manifestPath)) {
    throw new Error(`Packaged agent runtime manifest is missing: ${manifestPath}`)
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const archivePath = join(runtimeRoot, manifest.archive ?? "")

  if (
    manifest.schemaVersion !== 1 ||
    manifest.target !== `${process.platform}-${process.arch}` ||
    !existsSync(archivePath) ||
    statSync(archivePath).size !== manifest.archiveSize
  ) {
    throw new Error(`Packaged agent runtime manifest or archive is invalid.`)
  }

  for (const [name, executable] of Object.entries(
    manifest.executables ?? {}
  )) {
    const rawExecutable = join(appRoot, executable.relativePath ?? "")

    if (existsSync(rawExecutable)) {
      throw new Error(
        `Raw ${name} executable should only exist in the compressed runtime archive: ${rawExecutable}`
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

  const nodePtyRoot = join(appRoot, "node_modules", "node-pty")

  if (existsSync(join(nodePtyRoot, "prebuilds"))) {
    throw new Error(`Unused node-pty platform prebuilds were packaged.`)
  }

  const openCodeExecutable = join(
    appRoot,
    "node_modules",
    "opencode-ai",
    "bin",
    "opencode.exe"
  )

  if (!existsSync(openCodeExecutable)) {
    throw new Error(`Packaged OpenCode executable is missing: ${openCodeExecutable}`)
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
      join(
        appRoot,
        "node_modules",
        recheckPlatformPackages[runtimeTarget]
      )
    ) &&
    existsSync(join(appRoot, "node_modules", "recheck-jar"))
  ) {
    throw new Error(
      `Redundant recheck Java fallback was packaged with its native backend.`
    )
  }

  const koffiBuildDir = join(
    appRoot,
    "node_modules",
    "koffi",
    "build",
    "koffi"
  )

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

function smokeCodexAppServer(codexExecutable, codexHome) {
  return new Promise((resolveSmoke, rejectSmoke) => {
    mkdirSync(codexHome, { recursive: true })

    const child = spawn(
      codexExecutable,
      ["app-server", "--stdio"],
      {
        env: { ...process.env, CODEX_HOME: codexHome },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      }
    )
    const lines = createInterface({ input: child.stdout })
    let stderr = ""
    let settled = false

    const finish = (error) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      lines.close()
      child.kill()

      if (error) {
        rejectSmoke(error)
      } else {
        resolveSmoke()
      }
    }
    const timeout = setTimeout(() => {
      finish(
        new Error(
          `Packaged Codex app-server timed out.${stderr ? `\n${stderr}` : ""}`
        )
      )
    }, 20_000)

    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4_000)
    })
    child.once("error", finish)
    child.once("exit", (code, signal) => {
      if (!settled) {
        finish(
          new Error(
            `Packaged Codex app-server exited before initialization: code=${code ?? "null"} signal=${signal ?? "null"}.${stderr ? `\n${stderr}` : ""}`
          )
        )
      }
    })
    lines.on("line", (line) => {
      let message

      try {
        message = JSON.parse(line)
      } catch {
        return
      }

      if (message.id !== 1) {
        return
      }

      if (message.error) {
        finish(
          new Error(
            `Packaged Codex app-server initialize failed: ${JSON.stringify(message.error)}`
          )
        )
        return
      }

      finish()
    })

    child.stdin.write(
      `${JSON.stringify({
        id: 1,
        method: "initialize",
        params: {
          capabilities: null,
          clientInfo: {
            name: "astraflow-electron-package-smoke",
            title: "AstraFlow Electron Package Smoke",
            version: "0.0.0",
          },
        },
      })}\n`
    )
  })
}

async function smokePackagedAgentRuntime(
  executable,
  userDataPath,
  appRoot
) {
  const packagedRequire = createRequire(import.meta.url)
  const { createAgentRuntimeEnvironmentManager } = packagedRequire(
    join(appRoot, "electron", "agent-runtime-environment.cjs")
  )
  const environment = await createAgentRuntimeEnvironmentManager({
    appRoot,
    userDataPath,
  }).ensureReady()

  runChecked(
    environment.CLAUDE_CODE_EXECUTABLE,
    ["--version"],
    { env: process.env },
    "Packaged Claude runtime smoke test"
  )
  runChecked(
    join(appRoot, "node_modules", "opencode-ai", "bin", "opencode.exe"),
    ["--version"],
    { env: process.env },
    "Packaged OpenCode runtime smoke test"
  )
  await smokeCodexAppServer(
    environment.CODEX_PATH,
    join(userDataPath, "codex-smoke-home")
  )
}

function smokeBundledDocumentRuntime(executable, appRoot) {
  const runtimeTarget = `${process.platform}-${process.arch}`
  const pythonRoot = join(appRoot, "runtime", "python", runtimeTarget)
  const pythonExecutable =
    process.platform === "win32"
      ? join(pythonRoot, "python.exe")
      : join(pythonRoot, "bin", "python3")
  const nodeModulesRoot = join(appRoot, "node_modules")

  validatePackagedAgentRuntimeLayout(appRoot)

  for (const slug of ["pptx", "xlsx", "docx", "pdf"]) {
    const skillPath = join(appRoot, "bundled-skills", slug, "SKILL.md")

    if (!existsSync(skillPath)) {
      throw new Error(`Packaged bundled skill is missing: ${skillPath}`)
    }
  }

  if (!existsSync(pythonExecutable)) {
    throw new Error(`Packaged Python is missing: ${pythonExecutable}`)
  }

  runChecked(
    pythonExecutable,
    [
      "-c",
      [
        "import pip, venv",
        "print('packaged-python-bootstrap-ok')",
      ].join("; "),
    ],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONHOME: pythonRoot,
        PYTHONNOUSERSITE: "1",
      },
    },
    "Packaged Python bootstrap smoke test"
  )

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
