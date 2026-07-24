import { createHash } from "node:crypto"
import { existsSync, mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  spawn,
  spawnSync,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from "node:child_process"

import {
  createLocalSandboxPolicy,
  type LocalSandboxMaskedEnvironmentVariable,
  type LocalSandboxNetworkEndpoint,
} from "@/lib/agent/sandbox/local-policy"
import {
  isWindowsProviderCredentialPipePath,
  type ProviderProxyTokenTransport,
} from "@/lib/agent/provider-credential-transport"

const RUNNER_ENV_KEYS = [
  "APPDATA",
  "ComSpec",
  "LANG",
  "LOCALAPPDATA",
  "PATHEXT",
  "SRT_DEBUG",
  "SystemDrive",
  "SystemRoot",
  "WINDIR",
] as const
const TERMINATION_FALLBACK_MS = 5_000
const terminationFallbacks = new WeakMap<ChildProcess, NodeJS.Timeout>()
const sandboxRunnerProcesses = new WeakSet<ChildProcess>()
const ASTRAFLOW_MODELVERSE_API_KEY_ENV = "ASTRAFLOW_MODELVERSE_API_KEY"
const ASTRAFLOW_ACP_STATE_KEY_ENV = "ASTRAFLOW_ACP_STATE_KEY"
const ASTRAFLOW_ACP_STATE_ROOT_ENV = "ASTRAFLOW_ACP_STATE_ROOT"
const WINDOWS_SANDBOX_PROFILE_ENV_NAMES = new Set(
  [
    "ANTHROPIC_CONFIG_DIR",
    "APPDATA",
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "NPM_CONFIG_USERCONFIG",
    "OPENCODE_CONFIG",
    "OPENCODE_CONFIG_DIR",
    "PYTHONPYCACHEPREFIX",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USERPROFILE",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
  ].map((name) => name.toLocaleUpperCase("en-US"))
)

function createWindowsSandboxProfileId(workspaceDir: string) {
  return createHash("sha256")
    .update(resolve(workspaceDir))
    .digest("hex")
    .slice(0, 32)
}

function isWindowsSandboxProfileEnvironmentVariable(name: string) {
  return (
    process.platform === "win32" &&
    WINDOWS_SANDBOX_PROFILE_ENV_NAMES.has(name.toLocaleUpperCase("en-US"))
  )
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

function resolveSandboxRunnerExecutable() {
  const configured = process.env.ASTRAFLOW_NODE_EXECUTABLE?.trim()
  const executable = configured || process.execPath

  if (!existsSync(executable)) {
    throw new Error(
      `AstraFlow's Node runtime is missing at ${executable}. Sandboxed Agent startup is blocked.`
    )
  }

  return executable
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

function quotePosixArgument(value: string) {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`
}

function quoteWindowsArgument(value: string) {
  if (!value || /[\s"&|<>^()]/.test(value)) {
    return `"${value
      .replaceAll(/(\\*)"/g, '$1$1\\"')
      .replaceAll(/(\\+)$/g, "$1$1")}"`
  }

  return value
}

function serializeCommand(command: string, args: string[]) {
  const quote =
    process.platform === "win32" ? quoteWindowsArgument : quotePosixArgument

  return [command, ...args].map(quote).join(" ")
}

export type LocalSandboxedAcpProcessOptions = {
  additionalReadRoots?: string[]
  allowLocalBinding?: boolean
  allowMachLookup?: string[]
  allowedNetworkDomains: string[]
  allowedNetworkEndpoints?: LocalSandboxNetworkEndpoint[]
  args?: string[]
  command: string
  env?: Record<string, string | undefined>
  maskedEnvironmentVariables?: LocalSandboxMaskedEnvironmentVariable[]
  rootDir: string
  runtimeStateRoot: string
  sessionId: string
  stateRoot?: string
  providerProxyToken?: string
  providerProxyTokenTransport?: ProviderProxyTokenTransport
  providerProxyTokenPath?: string
  terminateMaskedCredentialTls?: boolean
}

/**
 * Starts an ACP adapter with its complete process tree inside one long-lived
 * OS sandbox. The ACP protocol keeps stdin/stdout open for the lifetime of the
 * process, so bootstrap data travels over the trusted Node IPC channel rather
 * than consuming ACP stdin.
 */
export function spawnLocalSandboxedAcpProcess({
  additionalReadRoots = [],
  allowLocalBinding = false,
  allowMachLookup = [],
  allowedNetworkDomains,
  allowedNetworkEndpoints = [],
  args = [],
  command,
  env = {},
  maskedEnvironmentVariables = [],
  rootDir,
  runtimeStateRoot,
  sessionId,
  stateRoot,
  providerProxyToken,
  providerProxyTokenTransport = "environment",
  providerProxyTokenPath,
  terminateMaskedCredentialTls = true,
}: LocalSandboxedAcpProcessOptions): ChildProcessWithoutNullStreams {
  const providerCredential = env[ASTRAFLOW_MODELVERSE_API_KEY_ENV]

  if (providerProxyTokenTransport === "fd3" && process.platform === "win32") {
    throw new Error(
      "Anonymous file-descriptor provider credential transport is unavailable on Windows."
    )
  }
  if (
    providerProxyTokenTransport === "windows_named_pipe" &&
    (process.platform !== "win32" ||
      !isWindowsProviderCredentialPipePath(providerProxyTokenPath))
  ) {
    throw new Error(
      "Windows named-pipe provider credential transport is unavailable."
    )
  }
  if (
    providerProxyTokenTransport !== "environment" &&
    providerCredential !== undefined
  ) {
    throw new Error(
      "An anonymously transported provider credential must not also be present in the Agent environment."
    )
  }
  if (
    providerProxyTokenTransport === "environment" &&
    providerCredential !== undefined &&
    (!providerProxyToken || providerCredential !== providerProxyToken)
  ) {
    throw new Error(
      "A local sandbox Agent process can only receive a Desktop-scoped provider credential."
    )
  }
  if (
    providerProxyTokenTransport !== "environment" &&
    !providerProxyToken
  ) {
    throw new Error(
      "Anonymous provider credential transport requires a Desktop-scoped provider credential."
    )
  }
  if (stateRoot) {
    mkdirSync(stateRoot, { recursive: true, mode: 0o700 })
  } else if (
    env[ASTRAFLOW_ACP_STATE_KEY_ENV] !== undefined ||
    env[ASTRAFLOW_ACP_STATE_ROOT_ENV] !== undefined
  ) {
    throw new Error(
      "AstraFlow ACP private state cannot be passed to a brokered sandbox process."
    )
  }
  mkdirSync(runtimeStateRoot, { recursive: true, mode: 0o700 })

  const policy = createLocalSandboxPolicy({
    additionalAllowedDomains: allowedNetworkDomains,
    additionalAllowedNetworkEndpoints: allowedNetworkEndpoints,
    additionalReadRoots,
    additionalWriteRoots: [runtimeStateRoot, ...(stateRoot ? [stateRoot] : [])],
    allowLocalBinding,
    allowMachLookup,
    maskedEnvironmentVariables,
    terminateMaskedCredentialTls,
    passthroughEnvironmentVariables: [
      ...(stateRoot ? [ASTRAFLOW_ACP_STATE_KEY_ENV] : []),
      ...(providerProxyToken &&
      providerProxyTokenTransport === "environment"
        ? [ASTRAFLOW_MODELVERSE_API_KEY_ENV]
        : []),
    ],
    rootDir,
    sessionId,
  })
  const commandEnv = Object.fromEntries(
    Object.entries({
      ...env,
      ...policy.commandEnv,
    }).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" &&
        !isWindowsSandboxProfileEnvironmentVariable(entry[0])
    )
  )
  const runnerPath = resolveSandboxRunnerPath()
  const child = spawn(
    resolveSandboxRunnerExecutable(),
    [runnerPath, "--long-lived-stdio"],
    {
      cwd: policy.rootDir,
      env: createRunnerEnvironment(policy.commandEnv),
      shell: false,
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      windowsHide: true,
    }
  )
  sandboxRunnerProcesses.add(child)

  try {
    child.send({
      type: "start",
      request: {
        command: serializeCommand(command, args),
        commandEnv,
        config: policy.config,
        cwd: policy.rootDir,
        allowedNetworkEndpoints: policy.allowedNetworkEndpoints,
        mode: "long_lived_stdio",
        ...(providerProxyTokenTransport !== "environment"
          ? {
              providerCredential: providerProxyToken,
              ...(providerProxyTokenTransport === "windows_named_pipe"
                ? { providerCredentialPath: providerProxyTokenPath }
                : {}),
            }
          : {}),
        sensitiveEnvNames: [
          ASTRAFLOW_MODELVERSE_API_KEY_ENV,
          ASTRAFLOW_ACP_STATE_KEY_ENV,
        ],
        shell: policy.shell,
        ...(process.platform === "win32"
          ? {
              windowsProfileId: createWindowsSandboxProfileId(
                policy.workspaceDir
              ),
            }
          : {}),
      },
    })
  } catch (error) {
    child.kill("SIGKILL")
    throw error
  }

  return child as ChildProcessWithoutNullStreams
}

export function spawnLocalSandboxedCommand({
  command,
  rootDir,
  sessionId,
}: {
  command: string
  rootDir: string
  sessionId: string
}) {
  const policy = createLocalSandboxPolicy({
    rootDir,
    sessionId,
  })
  const runnerPath = resolveSandboxRunnerPath()
  const child = spawn(resolveSandboxRunnerExecutable(), [runnerPath], {
    cwd: policy.rootDir,
    env: createRunnerEnvironment(policy.commandEnv),
    shell: false,
    stdio: ["pipe", "pipe", "pipe", "ipc"],
    windowsHide: true,
  })
  sandboxRunnerProcesses.add(child)

  child.stdin?.end(
    JSON.stringify({
      command,
      commandEnv: policy.commandEnv,
      config: policy.config,
      cwd: policy.rootDir,
      allowedNetworkEndpoints: policy.allowedNetworkEndpoints,
      shell: policy.shell,
      ...(process.platform === "win32"
        ? {
            windowsProfileId: createWindowsSandboxProfileId(
              policy.workspaceDir
            ),
          }
        : {}),
    })
  )

  return child
}

export function terminateLocalSandboxedCommand(child: ChildProcess) {
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

export function isLocalSandboxRunnerProcess(child: ChildProcess) {
  return sandboxRunnerProcesses.has(child)
}
