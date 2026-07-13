import { randomUUID } from "node:crypto"

import { Sandbox } from "@e2b/code-interpreter"

const DEFAULT_DOMAIN = "cn-wlcb.sandbox.ucloudai.com"
const REQUEST_TIMEOUT_MS = 30_000
const AUTO_PAUSE_TIMEOUT_MS = 3_600_000

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`${name} is required.`)
  }

  return value
}

function normalizeDomain(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^\*\./, "")
    .replace(/\/+$/, "")
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function runChecked(sandbox: Sandbox, command: string) {
  const result = await sandbox.commands.run(command, {
    timeoutMs: 60_000,
    requestTimeoutMs: 70_000,
  })

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "Sandbox command failed.")
  }

  return result.stdout.trim()
}

if (process.env.ASTRAFLOW_CONFIRM_PAUSE_SMOKE !== "1") {
  throw new Error(
    "Set ASTRAFLOW_CONFIRM_PAUSE_SMOKE=1 to confirm that the selected Sandbox may be paused during this smoke test."
  )
}

const sandboxId = requiredEnvironment("ASTRAFLOW_CODEBOX_SANDBOX_ID")
const apiKey =
  process.env.UCLOUD_SANDBOX_API_KEY?.trim() ||
  requiredEnvironment("E2B_API_KEY")
const domain = normalizeDomain(
  process.env.ASTRAFLOW_SANDBOX_DOMAIN ||
    process.env.E2B_DOMAIN ||
    DEFAULT_DOMAIN
)
const workspacePath =
  process.env.ASTRAFLOW_CODEBOX_WORKSPACE_PATH?.trim() || "/workspace"
const runId = randomUUID()
const smokePath = `${workspacePath.replace(/\/+$/, "")}/.astraflow-auto-resume-smoke-${runId}`
const connectionOptions = {
  apiKey,
  domain,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
  timeoutMs: AUTO_PAUSE_TIMEOUT_MS,
  validateApiKey: false,
}

const sandbox = await Sandbox.connect(sandboxId, connectionOptions)

await runChecked(
  sandbox,
  [
    "set -euo pipefail",
    `smoke_path=${shellQuote(smokePath)}`,
    'mkdir -p "$smoke_path"',
    'git -C "$smoke_path" init -q',
    'git -C "$smoke_path" config user.name "AstraFlow Smoke"',
    'git -C "$smoke_path" config user.email "smoke@astraflow.invalid"',
    'printf "committed\\n" > "$smoke_path/tracked.txt"',
    'git -C "$smoke_path" add tracked.txt',
    'git -C "$smoke_path" commit -qm "persistence baseline"',
    'printf "dirty\\n" >> "$smoke_path/tracked.txt"',
    'printf "untracked\\n" > "$smoke_path/untracked.txt"',
  ].join("\n")
)

const paused = await Sandbox.pause(sandboxId, {
  apiKey,
  domain,
  keepMemory: true,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
  validateApiKey: false,
})

if (!paused) {
  throw new Error("Sandbox pause request was not accepted.")
}

const resumed = await Sandbox.connect(sandboxId, connectionOptions)
const verification = await runChecked(
  resumed,
  [
    "set -euo pipefail",
    `smoke_path=${shellQuote(smokePath)}`,
    'test "$(git -C "$smoke_path" show HEAD:tracked.txt)" = "committed"',
    'test "$(cat "$smoke_path/tracked.txt")" = "committed\ndirty"',
    'test "$(cat "$smoke_path/untracked.txt")" = "untracked"',
    'git -C "$smoke_path" status --porcelain',
  ].join("\n")
)

if (resumed.sandboxId !== sandboxId) {
  throw new Error(
    `Auto resume returned a different Sandbox: ${resumed.sandboxId}`
  )
}

await runChecked(resumed, `rm -rf -- ${shellQuote(smokePath)}`)

console.log(
  JSON.stringify(
    {
      ok: true,
      sandboxId,
      workspacePath,
      autoResumed: true,
      preservedGitStatus: verification.split("\n").filter(Boolean),
    },
    null,
    2
  )
)
