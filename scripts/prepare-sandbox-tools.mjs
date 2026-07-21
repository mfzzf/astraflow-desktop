import { createHash } from "node:crypto"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const root = resolve(scriptDirectory, "..")
const runtimeTarget = `${process.platform}-${process.arch}`
const targetRoot = join(root, "runtime", "sandbox", runtimeTarget)
const targetBin = join(targetRoot, "bin")

function writeNodeLauncher() {
  const windows = process.platform === "win32"
  const launcherPath = join(targetBin, windows ? "node.cmd" : "node")
  const launcher = windows
    ? [
        "@echo off",
        'set "ASTRAFLOW_EFFECTIVE_NODE=%ASTRAFLOW_DEVELOPER_NODE_EXECUTABLE%"',
        'if not "%ASTRAFLOW_EFFECTIVE_NODE%"=="" if not exist "%ASTRAFLOW_EFFECTIVE_NODE%" set "ASTRAFLOW_EFFECTIVE_NODE="',
        'if "%ASTRAFLOW_EFFECTIVE_NODE%"=="" set "ASTRAFLOW_EFFECTIVE_NODE=%ASTRAFLOW_NODE_EXECUTABLE%"',
        'if "%ASTRAFLOW_EFFECTIVE_NODE%"=="" (',
        "  echo AstraFlow bundled Node launcher is not configured. 1>&2",
        "  exit /b 126",
        ")",
        'if "%ASTRAFLOW_EFFECTIVE_NODE%"=="%ASTRAFLOW_DEVELOPER_NODE_EXECUTABLE%" set "ELECTRON_RUN_AS_NODE="',
        'if not "%ASTRAFLOW_EFFECTIVE_NODE%"=="%ASTRAFLOW_DEVELOPER_NODE_EXECUTABLE%" set "ELECTRON_RUN_AS_NODE=1"',
        '"%ASTRAFLOW_EFFECTIVE_NODE%" %*',
        "exit /b %errorlevel%",
        "",
      ].join("\r\n")
    : [
        "#!/bin/sh",
        'node_executable="${ASTRAFLOW_DEVELOPER_NODE_EXECUTABLE:-}"',
        'if [ -z "$node_executable" ] || [ ! -x "$node_executable" ]; then',
        '  node_executable="${ASTRAFLOW_NODE_EXECUTABLE:-}"',
        "  export ELECTRON_RUN_AS_NODE=1",
        "else",
        "  unset ELECTRON_RUN_AS_NODE",
        "fi",
        'if [ -z "$node_executable" ]; then',
        '  echo "AstraFlow bundled Node launcher is not configured." >&2',
        "  exit 126",
        "fi",
        'exec "$node_executable" "$@"',
        "",
      ].join("\n")

  writeFileSync(launcherPath, launcher)

  if (!windows) {
    chmodSync(launcherPath, 0o755)
  }

  return launcherPath
}

rmSync(targetRoot, { recursive: true, force: true })
mkdirSync(targetBin, { recursive: true })
const nodeLauncherPath = writeNodeLauncher()

if (process.platform !== "linux") {
  writeFileSync(
    join(targetRoot, "manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        target: runtimeTarget,
        sandboxRuntime: "@anthropic-ai/sandbox-runtime@0.0.65",
        nodeLauncher: {
          path: `bin/${process.platform === "win32" ? "node.cmd" : "node"}`,
          sha256: createHash("sha256")
            .update(readFileSync(nodeLauncherPath))
            .digest("hex"),
        },
      },
      null,
      2
    )}\n`
  )
  console.log(`Prepared sandbox tools for ${runtimeTarget}.`)
  process.exit(0)
}

const pythonRoot = join(
  root,
  "runtime",
  "python",
  "distributions",
  runtimeTarget
)
const pythonExecutable = join(pythonRoot, "bin", "python3")
const bwrapPath = join(
  pythonRoot,
  "lib",
  "python3.12",
  "site-packages",
  "bubblewrap_bin",
  "_bin",
  "bwrap"
)
const ripgrepPath = join(pythonRoot, "bin", "rg")
const bridgeSource = join(root, "runtime", "sandbox", "socat-bridge.py")
const bridgeTarget = join(targetBin, "socat")

for (const path of [pythonExecutable, bwrapPath, ripgrepPath, bridgeSource]) {
  if (!existsSync(path)) {
    throw new Error(
      `Missing Linux sandbox dependency ${path}. Run bun run runtime:python first.`
    )
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${join(pythonRoot, "bin")}:${process.env.PATH ?? ""}`,
      PYTHONHOME: pythonRoot,
      PYTHONNOUSERSITE: "1",
    },
    maxBuffer: 4 * 1024 * 1024,
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

copyFileSync(bridgeSource, bridgeTarget)
chmodSync(bridgeTarget, 0o755)

const bwrapVersion = run(bwrapPath, ["--version"])
const ripgrepVersion = run(ripgrepPath, ["--version"]).split(/\r?\n/, 1)[0]
run(pythonExecutable, [
  "-c",
  `from pathlib import Path; p=Path(${JSON.stringify(
    bridgeTarget
  )}); compile(p.read_text(encoding='utf-8'), str(p), 'exec')`,
])

writeFileSync(
  join(targetRoot, "manifest.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      target: runtimeTarget,
      sandboxRuntime: "@anthropic-ai/sandbox-runtime@0.0.65",
      bubblewrap: {
        path: "python/lib/python3.12/site-packages/bubblewrap_bin/_bin/bwrap",
        version: bwrapVersion,
      },
      ripgrep: {
        path: "python/bin/rg",
        version: ripgrepVersion,
      },
      nodeLauncher: {
        path: "bin/node",
        sha256: sha256(nodeLauncherPath),
      },
      socatBridge: {
        path: "bin/socat",
        sha256: sha256(bridgeTarget),
      },
    },
    null,
    2
  )}\n`
)

console.log(`Prepared Linux sandbox tools for ${runtimeTarget}.`)
