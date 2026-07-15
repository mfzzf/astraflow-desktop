import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"

import { createLocalSandboxPolicy } from "@/lib/agent/sandbox/local-policy"

const RUNNER_ENV_KEYS = [
  "APPDATA",
  "ComSpec",
  "LANG",
  "LOCALAPPDATA",
  "PATHEXT",
  "SystemDrive",
  "SystemRoot",
  "WINDIR",
] as const
const TERMINATION_FALLBACK_MS = 5_000
const terminationFallbacks = new WeakMap<ChildProcess, NodeJS.Timeout>()

export type LocalSandboxNetworkPermissionRequest = {
  host: string
  port?: number
}

type SandboxRunnerNetworkPermissionRequest =
  LocalSandboxNetworkPermissionRequest & {
    requestId: string
    type: "network_permission_request"
  }

function isSandboxRunnerNetworkPermissionRequest(
  message: unknown
): message is SandboxRunnerNetworkPermissionRequest {
  if (!message || typeof message !== "object") {
    return false
  }

  const candidate = message as Record<string, unknown>

  return (
    candidate.type === "network_permission_request" &&
    typeof candidate.requestId === "string" &&
    candidate.requestId.length > 0 &&
    typeof candidate.host === "string" &&
    candidate.host.length > 0 &&
    (candidate.port === undefined ||
      (typeof candidate.port === "number" &&
        Number.isInteger(candidate.port) &&
        candidate.port > 0 &&
        candidate.port <= 65_535))
  )
}

function sendNetworkPermissionResponse(
  child: ChildProcess,
  requestId: string,
  allowed: boolean
) {
  if (!child.connected) {
    return
  }

  try {
    child.send(
      {
        type: "network_permission_response",
        requestId,
        allowed,
      },
      () => undefined
    )
  } catch {
    // The runner may exit while the user is answering; fail closed there.
  }
}

function resolveSandboxRunnerPath() {
  const configured = process.env.ASTRAFLOW_SANDBOX_RUNNER_PATH?.trim()
  const runnerPath = configured
    ? resolve(configured)
    : join(process.cwd(), "electron", "sandbox-command-runner.mjs")

  if (!existsSync(runnerPath)) {
    throw new Error(
      `AstraFlow sandbox runner is missing at ${runnerPath}. Command execution is blocked.`
    )
  }

  return runnerPath
}

function createRunnerEnvironment(commandEnv: Record<string, string>) {
  const env: NodeJS.ProcessEnv = {
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: process.env.NODE_ENV ?? "production",
    LANG: commandEnv.LANG,
    PATH: commandEnv.PATH,
    PYTHONHOME: commandEnv.PYTHONHOME,
    PYTHONNOUSERSITE: commandEnv.PYTHONNOUSERSITE,
  }

  for (const key of RUNNER_ENV_KEYS) {
    const value = process.env[key]

    if (value) {
      env[key] = value
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("LC_") && value) {
      env[key] = value
    }
  }

  return env
}

export function spawnLocalSandboxedCommand({
  command,
  onNetworkPermissionRequest,
  rootDir,
  sessionId,
}: {
  command: string
  onNetworkPermissionRequest?: (
    request: LocalSandboxNetworkPermissionRequest
  ) => Promise<boolean>
  rootDir: string
  sessionId: string
}) {
  const networkPromptEnabled = Boolean(onNetworkPermissionRequest)
  const policy = createLocalSandboxPolicy({
    allowNetworkPrompt: networkPromptEnabled,
    rootDir,
    sessionId,
  })
  const runnerPath = resolveSandboxRunnerPath()
  const child = spawn(process.execPath, [runnerPath], {
    cwd: policy.rootDir,
    env: createRunnerEnvironment(policy.commandEnv),
    shell: false,
    stdio: ["pipe", "pipe", "pipe", "ipc"],
    windowsHide: true,
  })

  if (onNetworkPermissionRequest) {
    child.on("message", (message) => {
      if (!isSandboxRunnerNetworkPermissionRequest(message)) {
        return
      }

      void (async () => {
        let allowed = false

        try {
          allowed = await onNetworkPermissionRequest({
            host: message.host,
            ...(message.port === undefined ? {} : { port: message.port }),
          })
        } catch {
          allowed = false
        }

        sendNetworkPermissionResponse(child, message.requestId, allowed)
      })()
    })
  }

  child.stdin?.end(
    JSON.stringify({
      command,
      commandEnv: policy.commandEnv,
      config: policy.config,
      cwd: policy.rootDir,
      networkPromptEnabled,
      shell: policy.shell,
    })
  )

  return child
}

export function terminateLocalSandboxedCommand(
  child: ChildProcess
) {
  if (terminationFallbacks.has(child)) {
    return
  }

  let fallback: NodeJS.Timeout | null = null
  const forceTerminate = () => {
    if (fallback) {
      clearTimeout(fallback)
      fallback = null
    }

    terminationFallbacks.delete(child)

    if (process.platform === "win32" && child.pid) {
      const result = spawnSync(
        "taskkill.exe",
        ["/pid", String(child.pid), "/t", "/f"],
        {
          stdio: "ignore",
          windowsHide: true,
        }
      )

      if (!result.error && result.status === 0) {
        return
      }
    }

    child.kill("SIGKILL")
  }
  fallback = setTimeout(forceTerminate, TERMINATION_FALLBACK_MS)
  fallback.unref?.()
  terminationFallbacks.set(child, fallback)
  child.once("close", () => {
    const pendingFallback = terminationFallbacks.get(child)

    if (pendingFallback) {
      clearTimeout(pendingFallback)
      terminationFallbacks.delete(child)
    }
  })

  try {
    if (!child.connected) {
      forceTerminate()
      return
    }

    child.send({ type: "terminate", signal: "SIGTERM" })
  } catch {
    forceTerminate()
  }
}
