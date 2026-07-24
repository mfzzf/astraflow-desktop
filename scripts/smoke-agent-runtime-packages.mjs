import { spawnSync } from "node:child_process"
import { dirname, join, delimiter } from "node:path"

import { getAgentRuntimePackageSpecs } from "./agent-runtime-packages.mjs"

const root = process.cwd()
const runtimeTarget =
  process.env.ASTRAFLOW_RUNTIME_TARGET?.trim() ||
  `${process.platform}-${process.arch}`
const specs = Object.fromEntries(
  getAgentRuntimePackageSpecs({
    appRoot: root,
    nodeModulesDir: join(root, "node_modules"),
    runtimeTarget,
  }).map((spec) => [spec.id, spec])
)
const environment = {
  ...process.env,
  ASTRAFLOW_CODEX_EXECUTABLE: specs.codex.executablePath,
  ASTRAFLOW_OPENCODE_EXECUTABLE: specs.opencode.executablePath,
  CLAUDE_CODE_EXECUTABLE: specs["claude-code"].executablePath,
  CODEX_PATH: specs.codex.executablePath,
  PATH: [
    dirname(specs.codex.executablePath),
    dirname(specs["claude-code"].executablePath),
    dirname(specs.opencode.executablePath),
    process.env.PATH,
  ]
    .filter(Boolean)
    .join(delimiter),
}
const result = spawnSync(
  "bun",
  ["scripts/smoke-acp.ts", "--require-all"],
  {
    cwd: root,
    encoding: "utf8",
    env: environment,
    maxBuffer: 16 * 1024 * 1024,
    stdio: "inherit",
    windowsHide: true,
  }
)

if (result.error) {
  throw result.error
}
if (result.status !== 0) {
  throw new Error(
    `Agent runtime ACP smoke failed for ${runtimeTarget} with code ${result.status}.`
  )
}

console.log(`All native ACP runtimes started successfully for ${runtimeTarget}.`)
