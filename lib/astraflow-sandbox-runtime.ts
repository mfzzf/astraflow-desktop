import {
  CommandExitError,
  Sandbox,
  type CommandResult,
  type Execution,
  type RunCodeLanguage,
  type SandboxOpts,
} from "@e2b/code-interpreter"
import { isCompShareChannel } from "@/lib/compshare/config"
import {
  createCompShareSandbox,
  deleteCompShareSandbox,
} from "@/lib/compshare/sandboxes"

const ASTRAFLOW_SANDBOX_DEFAULT_TEMPLATE = "ry2jck30zrnfwtm1fihv"

export const ASTRAFLOW_SANDBOX_TEMPLATE =
  process.env.ASTRAFLOW_SANDBOX_TEMPLATE?.trim() ??
  process.env.E2B_TEMPLATE?.trim() ??
  ASTRAFLOW_SANDBOX_DEFAULT_TEMPLATE
export const ASTRAFLOW_SANDBOX_DEFAULT_DOMAIN = "cn-wlcb.sandbox.ucloudai.com"
export const ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS = 30_000
// CreateSandbox omits the real envd version. SDK versions below 0.4 force the
// legacy `user` account; 0.4 keeps the CompShare template's root default without
// claiming support for newer envd-only features.
const COMPSHARE_DIRECT_ENVD_VERSION = "0.4.0"
export const ASTRAFLOW_SANDBOX_DEFAULT_RUN_TIMEOUT_SECONDS = 60
export const ASTRAFLOW_SANDBOX_DEFAULT_AUTO_PAUSE_TIMEOUT_SECONDS = 300
const ASTRAFLOW_SANDBOX_MAX_OUTPUT_CHARS = 18_000
const ASTRAFLOW_SANDBOX_MAX_SECTION_CHARS = 8_000
const LONG_LIVED_SERVICE_PATTERNS = [
  /\bpython(?:3)?\s+-m\s+http\.server\b/i,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?dev\b/i,
  /\b(?:vite|webpack-dev-server)\b/i,
  /\bnext\s+dev\b/i,
  /\buvicorn\b/i,
  /\bstreamlit\s+run\b/i,
  /\bflask\s+run\b/i,
]

export const ASTRAFLOW_SANDBOX_ENV = {
  domain: "ASTRAFLOW_SANDBOX_DOMAIN",
  apiUrl: "ASTRAFLOW_SANDBOX_API_URL",
  sandboxUrl: "ASTRAFLOW_SANDBOX_URL",
  sessionAutoPauseTimeoutSeconds:
    "ASTRAFLOW_SANDBOX_SESSION_AUTO_PAUSE_TIMEOUT_SECONDS",
} as const

const LEGACY_SANDBOX_ENV: Record<keyof typeof ASTRAFLOW_SANDBOX_ENV, string> = {
  domain: "E2B_DOMAIN",
  apiUrl: "E2B_API_URL",
  sandboxUrl: "E2B_SANDBOX_URL",
  sessionAutoPauseTimeoutSeconds: "E2B_SESSION_AUTO_PAUSE_TIMEOUT_SECONDS",
}

export const ASTRAFLOW_SANDBOX_CODE_LANGUAGES = [
  "python",
  "javascript",
  "typescript",
  "bash",
  "r",
  "java",
] as const

export type AstraFlowSandboxCodeLanguage =
  (typeof ASTRAFLOW_SANDBOX_CODE_LANGUAGES)[number]

export type RunAstraFlowSandboxCodeInput = {
  apiKey: string
  code: string
  language: AstraFlowSandboxCodeLanguage
  autoPause: boolean
  sandboxId?: string
  timeoutSeconds?: number
  autoPauseTimeoutSeconds?: number
}

export type RunAstraFlowSandboxCommandInput = {
  sandbox: Sandbox
  command: string
  cwd?: string
  env?: Record<string, string>
  timeoutSeconds?: number
  lifecycleLine: string
  cleanupLine: string
}

export type AstraFlowSandboxConnectionOptions = Pick<
  SandboxOpts,
  | "apiKey"
  | "validateApiKey"
  | "domain"
  | "apiUrl"
  | "sandboxUrl"
  | "requestTimeoutMs"
>

type AstraFlowSandboxConnectOptions = AstraFlowSandboxConnectionOptions &
  Pick<SandboxOpts, "timeoutMs">

function normalizeDomain(value: string | undefined) {
  const trimmed = value?.trim()

  if (!trimmed) {
    return undefined
  }

  return trimmed
    .replace(/^https?:\/\//i, "")
    .replace(/^\*\./, "")
    .replace(/\/+$/, "")
}

function normalizeUrl(value: string | undefined) {
  const trimmed = value?.trim()

  return trimmed || undefined
}

export function readAstraFlowSandboxEnv(
  name: keyof typeof ASTRAFLOW_SANDBOX_ENV
) {
  const value =
    process.env[ASTRAFLOW_SANDBOX_ENV[name]] ??
    process.env[LEGACY_SANDBOX_ENV[name]]
  const trimmed = value?.trim()

  return trimmed || undefined
}

export function getAstraFlowSandboxConnectionOptions(
  apiKey: string
): AstraFlowSandboxConnectionOptions {
  const options: AstraFlowSandboxConnectionOptions = {
    apiKey,
    validateApiKey: false,
    requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
  }
  const domain = normalizeDomain(
    readAstraFlowSandboxEnv("domain") ?? ASTRAFLOW_SANDBOX_DEFAULT_DOMAIN
  )
  const apiUrl = normalizeUrl(readAstraFlowSandboxEnv("apiUrl"))
  const sandboxUrl = normalizeUrl(readAstraFlowSandboxEnv("sandboxUrl"))

  if (domain) {
    options.domain = domain
  }

  if (apiUrl) {
    options.apiUrl = apiUrl
  }

  if (sandboxUrl) {
    options.sandboxUrl = sandboxUrl
  }

  return options
}

export async function connectAstraFlowSandbox(
  sandboxId: string,
  options: AstraFlowSandboxConnectOptions
) {
  if (!isCompShareChannel()) {
    return Sandbox.connect(sandboxId, options)
  }

  const directOptions = { ...options, apiKey: undefined }
  const startedAt = Date.now()
  const sandbox = Reflect.construct(Sandbox, [
    {
      ...directOptions,
      sandboxId,
      envdVersion: COMPSHARE_DIRECT_ENVD_VERSION,
    },
  ]) as Sandbox

  console.info("[compshare-sandbox] data_plane_attached", {
    sandboxId,
    mode: "direct-envd",
    envdVersion: COMPSHARE_DIRECT_ENVD_VERSION,
    elapsedMs: Date.now() - startedAt,
  })

  return sandbox
}

function clampSeconds(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
) {
  if (!value || !Number.isFinite(value)) {
    return fallback
  }

  return Math.min(Math.max(Math.trunc(value), min), max)
}

export function clampAstraFlowSandboxSeconds(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
) {
  return clampSeconds(value, fallback, min, max)
}

function hasBackgroundOperator(command: string) {
  return (
    /(?:^|[;&|]\s*)(?:nohup|setsid)\b/i.test(command) ||
    /&\s*(?:$|[;\n])/.test(command)
  )
}

function hasLocalHealthCheck(command: string) {
  return /\bcurl\b[\s\S]*(?:127\.0\.0\.1|localhost|0\.0\.0\.0)/i.test(command)
}

export function getAstraFlowLongLivedCommandGuidance(command: string) {
  const trimmed = command.trim()
  const startsKnownService = LONG_LIVED_SERVICE_PATTERNS.some((pattern) =>
    pattern.test(trimmed)
  )
  const mixesBackgroundServiceCheck =
    hasBackgroundOperator(trimmed) && hasLocalHealthCheck(trimmed)

  if (!startsKnownService && !mixesBackgroundServiceCheck) {
    return null
  }

  return [
    "This command appears to start a long-lived preview service. Do not run it directly with execute/run_command, because the sandbox command runner can keep waiting for the service process and eventually report deadline_exceeded.",
    "Use sandbox_start_service with only the foreground server command and the selected workspace as cwd, then use the returned public URL. For static HTML previews, a typical command is 'python3 -m http.server 8080 --bind 0.0.0.0' with port=8080 and health_path='/demo.html'.",
    "Keep health checks as short follow-up commands when needed; do not combine nohup/background operators and curl checks in one execute/run_command call.",
  ].join("\n")
}

function truncateText(
  text: string,
  maxChars = ASTRAFLOW_SANDBOX_MAX_SECTION_CHARS
) {
  if (text.length <= maxChars) {
    return text
  }

  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`
}

function codeFence(label: string, text: string) {
  return ["```" + label, text.replaceAll("```", "`\\`\\`"), "```"].join("\n")
}

function stringifyExecutionResult(
  result: Execution["results"][number],
  index: number
) {
  if (result.text) {
    return `Result ${index + 1}:\n${truncateText(result.text)}`
  }

  if (result.markdown) {
    return `Result ${index + 1} (markdown):\n${truncateText(result.markdown)}`
  }

  if (result.json) {
    return `Result ${index + 1} (json):\n${truncateText(result.json)}`
  }

  if (result.html) {
    return `Result ${index + 1} (html):\n${truncateText(result.html)}`
  }

  if (result.png || result.jpeg || result.svg || result.pdf) {
    return `Result ${index + 1}: binary or rich media output was produced and is not inlined in chat.`
  }

  try {
    return `Result ${index + 1}:\n${truncateText(
      JSON.stringify(result.toJSON(), null, 2)
    )}`
  } catch {
    return ""
  }
}

function formatExecution({
  execution,
  language,
  sandboxId,
  lifecycleLine,
  cleanupLine,
}: {
  execution: Execution
  language: AstraFlowSandboxCodeLanguage
  sandboxId: string
  lifecycleLine: string
  cleanupLine: string
}) {
  const sections = [
    "AstraFlow Sandbox code execution complete.",
    `Runtime template: ${ASTRAFLOW_SANDBOX_TEMPLATE}`,
    `Sandbox ID: ${sandboxId}`,
    `Language: ${language}`,
    lifecycleLine,
    cleanupLine,
  ]
  const stdout = execution.logs.stdout.join("\n").trim()
  const stderr = execution.logs.stderr.join("\n").trim()
  const resultText = execution.results
    .map((result, index) => stringifyExecutionResult(result, index))
    .filter(Boolean)
    .join("\n\n")

  if (stdout) {
    sections.push(`STDOUT:\n${codeFence("text", truncateText(stdout))}`)
  }

  if (stderr) {
    sections.push(`STDERR:\n${codeFence("text", truncateText(stderr))}`)
  }

  if (resultText) {
    sections.push(`RESULTS:\n${truncateText(resultText)}`)
  }

  if (execution.error) {
    sections.push(
      [
        "ERROR:",
        `${execution.error.name}: ${execution.error.value}`,
        truncateText(execution.error.traceback),
      ].join("\n")
    )
  }

  return truncateText(sections.join("\n\n"), ASTRAFLOW_SANDBOX_MAX_OUTPUT_CHARS)
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isAstraFlowCommandTimeoutError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase()

  return (
    message.includes("deadline_exceeded") ||
    message.includes("operation timed out") ||
    message.includes("timeoutms") ||
    message.includes("timed out")
  )
}

function formatAstraFlowCommandTimeoutError(error: unknown) {
  const message = getErrorMessage(error).trim()

  return [
    "Command timed out in AstraFlow Sandbox.",
    "If this command was meant to start a preview server or another long-lived process, start it in a detached tmux session and run health checks as separate short commands. For sandbox previews, bind the service to 0.0.0.0:<port>, verify it with http://127.0.0.1:<port> inside the sandbox, then resolve the public URL with sandbox_get_host.",
    message ? `Original error: ${message}` : null,
  ]
    .filter(Boolean)
    .join("\n")
}

export function normalizeAstraFlowCommandResult(
  error: unknown
): CommandResult | null {
  if (error instanceof CommandExitError) {
    return {
      exitCode: error.exitCode,
      error: error.error,
      stdout: error.stdout,
      stderr: error.stderr,
    }
  }

  if (isAstraFlowCommandTimeoutError(error)) {
    return {
      exitCode: 124,
      error: formatAstraFlowCommandTimeoutError(error),
      stdout: "",
      stderr: "",
    }
  }

  return null
}

function formatCommandExecution({
  command,
  cwd,
  result,
  sandboxId,
  lifecycleLine,
  cleanupLine,
}: {
  command: string
  cwd?: string
  result: CommandResult
  sandboxId: string
  lifecycleLine: string
  cleanupLine: string
}) {
  const sections = [
    "AstraFlow Sandbox shell command complete.",
    `Runtime template: ${ASTRAFLOW_SANDBOX_TEMPLATE}`,
    `Sandbox ID: ${sandboxId}`,
    `Command: ${command}`,
    cwd ? `Working directory: ${cwd}` : "Working directory: sandbox default",
    `Exit code: ${result.exitCode}`,
    lifecycleLine,
    cleanupLine,
  ]
  const stdout = result.stdout.trim()
  const stderr = result.stderr.trim()

  if (stdout) {
    sections.push(`STDOUT:\n${codeFence("text", truncateText(stdout))}`)
  }

  if (stderr) {
    sections.push(`STDERR:\n${codeFence("text", truncateText(stderr))}`)
  }

  if (result.error) {
    sections.push(`ERROR:\n${truncateText(result.error)}`)
  }

  return truncateText(sections.join("\n\n"), ASTRAFLOW_SANDBOX_MAX_OUTPUT_CHARS)
}

async function deleteAstraFlowSandbox(
  sandbox: Sandbox,
  usesCompShareControlPlane: boolean
) {
  if (usesCompShareControlPlane) {
    return (await deleteCompShareSandbox(sandbox.sandboxId)).deleted
  }

  return sandbox.kill({
    requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
  })
}

export async function runAstraFlowSandboxCode({
  apiKey,
  code,
  language,
  autoPause,
  sandboxId,
  timeoutSeconds,
  autoPauseTimeoutSeconds,
}: RunAstraFlowSandboxCodeInput) {
  const runTimeoutSeconds = clampSeconds(
    timeoutSeconds,
    ASTRAFLOW_SANDBOX_DEFAULT_RUN_TIMEOUT_SECONDS,
    1,
    300
  )
  const autoPauseSeconds = clampSeconds(
    autoPauseTimeoutSeconds,
    ASTRAFLOW_SANDBOX_DEFAULT_AUTO_PAUSE_TIMEOUT_SECONDS,
    60,
    3_600
  )
  const runTimeoutMs = runTimeoutSeconds * 1000
  const autoPauseTimeoutMs = autoPauseSeconds * 1000
  const oneShotTimeoutMs = Math.max(runTimeoutMs + 30_000, 60_000)
  const connectionOptions = getAstraFlowSandboxConnectionOptions(apiKey)
  const usesCompShareControlPlane = isCompShareChannel()
  let sandbox: Sandbox | null = null
  let killed = false

  try {
    if (sandboxId) {
      sandbox = await connectAstraFlowSandbox(sandboxId, {
        ...connectionOptions,
        timeoutMs: autoPause ? autoPauseTimeoutMs : oneShotTimeoutMs,
      })
    } else if (usesCompShareControlPlane) {
      const created = await createCompShareSandbox({
        templateId: ASTRAFLOW_SANDBOX_TEMPLATE,
      })

      try {
        sandbox = await connectAstraFlowSandbox(created.sandboxId, {
          ...connectionOptions,
          timeoutMs: autoPause ? autoPauseTimeoutMs : oneShotTimeoutMs,
        })
      } catch (error) {
        await deleteCompShareSandbox(created.sandboxId).catch(() => undefined)
        throw error
      }
    } else {
      sandbox = await Sandbox.create(ASTRAFLOW_SANDBOX_TEMPLATE, {
        ...connectionOptions,
        timeoutMs: autoPause ? autoPauseTimeoutMs : oneShotTimeoutMs,
        lifecycle: autoPause
          ? {
              onTimeout: { action: "pause", keepMemory: true },
              autoResume: true,
            }
          : { onTimeout: "kill" },
        metadata: {
          app: "astraflow-desktop",
          tool: "run_code",
        },
      })
    }

    if (autoPause && sandboxId && !usesCompShareControlPlane) {
      await sandbox.setTimeout(autoPauseTimeoutMs, {
        requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
      })
    }

    const execution = await sandbox.runCode(code, {
      language: language as RunCodeLanguage,
      timeoutMs: runTimeoutMs,
      requestTimeoutMs: Math.max(
        runTimeoutMs + 10_000,
        ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS
      ),
    })

    let cleanupLine = autoPause
      ? `Lifecycle: auto-pause enabled; AstraFlow Sandbox will pause after ${autoPauseSeconds}s of timeout and can auto-resume on traffic with memory and filesystem preserved.`
      : "Lifecycle: one-shot execution."

    if (!autoPause) {
      killed = await deleteAstraFlowSandbox(sandbox, usesCompShareControlPlane)
      cleanupLine = killed
        ? "Cleanup: AstraFlow Sandbox killed after code execution."
        : "Cleanup: AstraFlow Sandbox was already stopped or could not be found."
    }

    return formatExecution({
      execution,
      language,
      sandboxId: sandbox.sandboxId,
      lifecycleLine: autoPause ? "Auto pause: true" : "Auto pause: false",
      cleanupLine,
    })
  } finally {
    if (sandbox && !autoPause && !killed) {
      await deleteAstraFlowSandbox(sandbox, usesCompShareControlPlane).catch(
        () => undefined
      )
    }
  }
}

export async function runCodeInAstraFlowSandbox({
  sandbox,
  code,
  cwd,
  language,
  timeoutSeconds,
  lifecycleLine,
  cleanupLine,
}: {
  sandbox: Sandbox
  code: string
  cwd?: string
  language: AstraFlowSandboxCodeLanguage
  timeoutSeconds?: number
  lifecycleLine: string
  cleanupLine: string
}) {
  const runTimeoutSeconds = clampSeconds(
    timeoutSeconds,
    ASTRAFLOW_SANDBOX_DEFAULT_RUN_TIMEOUT_SECONDS,
    1,
    300
  )
  const runTimeoutMs = runTimeoutSeconds * 1000
  const requestTimeoutMs = Math.max(
    runTimeoutMs + 10_000,
    ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS
  )
  const context = cwd
    ? await sandbox.createCodeContext({
        cwd,
        language: language as RunCodeLanguage,
        requestTimeoutMs,
      })
    : null
  let execution: Awaited<ReturnType<Sandbox["runCode"]>>

  try {
    execution = await sandbox.runCode(code, {
      ...(context ? { context } : { language: language as RunCodeLanguage }),
      timeoutMs: runTimeoutMs,
      requestTimeoutMs,
    })
  } finally {
    if (context) {
      await sandbox.removeCodeContext(context).catch(() => undefined)
    }
  }

  return formatExecution({
    execution,
    language,
    sandboxId: sandbox.sandboxId,
    lifecycleLine,
    cleanupLine,
  })
}

export async function runCommandInAstraFlowSandbox({
  sandbox,
  command,
  cwd,
  env,
  timeoutSeconds,
  lifecycleLine,
  cleanupLine,
}: RunAstraFlowSandboxCommandInput) {
  const runTimeoutSeconds = clampSeconds(
    timeoutSeconds,
    ASTRAFLOW_SANDBOX_DEFAULT_RUN_TIMEOUT_SECONDS,
    1,
    300
  )
  const runTimeoutMs = runTimeoutSeconds * 1000
  let result: CommandResult

  try {
    result = await sandbox.commands.run(command, {
      cwd,
      envs: env,
      timeoutMs: runTimeoutMs,
      requestTimeoutMs: Math.max(
        runTimeoutMs + 10_000,
        ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS
      ),
    })
  } catch (error) {
    const commandResult = normalizeAstraFlowCommandResult(error)

    if (!commandResult) {
      throw error
    }

    result = commandResult
  }

  return formatCommandExecution({
    command,
    cwd,
    result,
    sandboxId: sandbox.sandboxId,
    lifecycleLine,
    cleanupLine,
  })
}
