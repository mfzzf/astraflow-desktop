// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { AgentModelDefinition } from "@/lib/agent-model-settings-shared"

const root = mkdtempSync(join(tmpdir(), "external-agent-provider-proxy-"))
const priorEnvironment = new Map(
  [
    "ASTRAFLOW_ACP_ATTACHMENTS_PATH",
    "ASTRAFLOW_INTERNAL_ORIGIN",
    "ASTRAFLOW_MANAGED_WORKSPACES_PATH",
    "ASTRAFLOW_SANDBOX_WORKSPACES_PATH",
    "ASTRAFLOW_SECRET_KEY",
    "ASTRAFLOW_USER_DATA_PATH",
  ].map((name) => [name, process.env[name]])
)
const REAL_SECRET = "real-modelverse-secret-never-enter-child"
const localSettingsRuntimes = new Set<string>()
const openAiModel = {
  baseUrl: "https://api.modelverse.cn/v1",
  builtin: true,
  defaultReasoningEffort: "medium",
  enabled: true,
  id: "gpt-5.6-sol",
  label: "GPT 5.6 Sol",
  protocol: "openai-responses",
  providerModel: "gpt-5.6-sol",
  reasoningEfforts: ["none", "medium"],
  supportedRuntimeIds: ["codex", "codex-direct", "opencode"],
} satisfies AgentModelDefinition
const claudeModel = {
  baseUrl: "https://api.modelverse.cn",
  builtin: true,
  defaultReasoningEffort: "high",
  enabled: true,
  id: "claude-sonnet-4-6",
  label: "Claude Sonnet 4.6",
  protocol: "anthropic-messages",
  providerModel: "claude-sonnet-4-6",
  reasoningEfforts: ["none", "high"],
  supportedRuntimeIds: ["claude-code", "claude-native", "opencode"],
} satisfies AgentModelDefinition

process.env.ASTRAFLOW_ACP_ATTACHMENTS_PATH = join(root, "attachments")
process.env.ASTRAFLOW_INTERNAL_ORIGIN = "http://127.0.0.1:3456"
process.env.ASTRAFLOW_MANAGED_WORKSPACES_PATH = join(root, "AstraFlow")
process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH = join(root, "sandbox-workspaces")
process.env.ASTRAFLOW_SECRET_KEY = "77".repeat(32)
process.env.ASTRAFLOW_USER_DATA_PATH = join(root, "user-data")

const providerProxy = await import("@/lib/agent/provider-proxy")
const acpRunConfig =
  await import("@/lib/agent/adapters/external-acp-run-config")
const acpRuntime = await import("@/lib/agent/acp/acp-runtime")
const codexDirect = await import("@/lib/agent/adapters/codex-direct-runtime")
const claudeNative = await import("@/lib/agent/adapters/claude-native-runtime")
const openCodeNative =
  await import("@/lib/agent/adapters/opencode-native-runtime")
const openCodeCredentialTransportTest =
  process.platform === "win32" ? test.skip : test

afterAll(() => {
  for (const [name, value] of priorEnvironment) {
    if (value === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = value
    }
  }

  rmSync(root, { force: true, recursive: true })
})

function input(
  runtime: string,
  permissionMode: "default" | "full_access" | "legacy_readonly",
  model: "gpt-5.6-sol" | "gpt-5.4-mini" | "claude-sonnet-4-6"
) {
  return {
    environment: "local" as const,
    messages: [],
    model,
    permissionMode,
    sessionId: `${runtime}-${permissionMode}`,
    signal: new AbortController().signal,
  }
}

const acpCommand = {
  command: process.execPath,
  args: ["agent.mjs"],
}
const externalDependencies = {
  resolveModelverseRunConfig(runtimeId: string) {
    return localSettingsRuntimes.has(runtimeId)
      ? null
      : {
          apiKey: REAL_SECRET,
          model: runtimeId.startsWith("claude") ? claudeModel : openAiModel,
        }
  },
}

function stdio<T>(command: T) {
  expect(command).toBeTruthy()
  expect((command as { transport?: string }).transport).not.toBe("http")
  expect((command as { transport?: string }).transport).not.toBe("websocket")
  return command as {
    transport?: "stdio"
    command: string
    args?: string[]
    env: Record<string, string | undefined>
    providerProxyToken?: string
    providerProxyTokenTransport?:
      | "environment"
      | "fd3"
      | "windows_named_pipe"
    providerProxyTokenPath?: string
    sandbox?: {
      allowedNetworkDomains: string[]
      allowedNetworkEndpoints?: Array<{ host: string; port: number }>
      kind: string
    }
  }
}

function assertOpaqueCommand(command: ReturnType<typeof stdio>) {
  expect(JSON.stringify(command)).not.toContain(REAL_SECRET)
  expect(command.env.ASTRAFLOW_MODELVERSE_API_KEY).toHaveLength(43)
  expect(
    providerProxy.resolveAgentProviderProxyCredential(
      command.providerProxyToken ?? ""
    )
  ).toMatchObject({
    apiKey: REAL_SECRET,
    authMode: "bearer",
  })
}

test("local Codex ACP uses only a scoped proxy token and keeps Codex workspace sandboxing", () => {
  for (const permissionMode of ["default", "full_access"] as const) {
    const command = stdio(
      acpRunConfig.configureCodexAcpCommand(
        acpCommand,
        input("codex", permissionMode, "gpt-5.6-sol"),
        externalDependencies
      )
    )
    const config = JSON.parse(command.env.CODEX_CONFIG ?? "{}")

    assertOpaqueCommand(command)
    expect(command.sandbox).toBeUndefined()
    expect(config.model_providers.modelverse.base_url).toBe(
      "http://127.0.0.1:3456/api/internal/agent-provider/credential"
    )
  }
})

test("local Claude Code ACP is process-sandboxed outside Full Access and uses bearer proxy auth", () => {
  const defaultCommand = stdio(
    acpRunConfig.configureClaudeCodeAcpCommand(
      acpCommand,
      input("claude-code", "default", "claude-sonnet-4-6"),
      externalDependencies
    )
  )
  const readonlyCommand = stdio(
    acpRunConfig.configureClaudeCodeAcpCommand(
      acpCommand,
      input("claude-code", "legacy_readonly", "claude-sonnet-4-6"),
      externalDependencies
    )
  )
  const fullAccessCommand = stdio(
    acpRunConfig.configureClaudeCodeAcpCommand(
      acpCommand,
      input("claude-code", "full_access", "claude-sonnet-4-6"),
      externalDependencies
    )
  )

  for (const command of [defaultCommand, readonlyCommand, fullAccessCommand]) {
    assertOpaqueCommand(command)
    expect(command.env.ANTHROPIC_AUTH_TOKEN).toHaveLength(43)
    expect(command.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(command.env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
    expect(command.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBe("1")
    expect(command.env.ANTHROPIC_BASE_URL).toBe(
      "http://127.0.0.1:3456/api/internal/agent-provider/credential"
    )
  }

  expect(defaultCommand.sandbox?.allowedNetworkDomains).toEqual([])
  expect(defaultCommand.sandbox?.allowedNetworkEndpoints).toEqual([
    { host: "127.0.0.1", port: 3456 },
  ])
  expect(readonlyCommand.sandbox?.kind).toBe("astraflow-local")
  expect(fullAccessCommand.sandbox).toBeUndefined()
})

test("local OpenCode ACP uses the loopback proxy in Default and direct process execution in Full Access", () => {
  const defaultCommand = stdio(
    acpRunConfig.configureOpenCodeAcpCommand(
      acpCommand,
      input("opencode", "default", "gpt-5.6-sol"),
      externalDependencies
    )
  )
  const fullAccessCommand = stdio(
    acpRunConfig.configureOpenCodeAcpCommand(
      acpCommand,
      input("opencode", "full_access", "gpt-5.6-sol"),
      externalDependencies
    )
  )
  const config = JSON.parse(defaultCommand.env.OPENCODE_CONFIG_CONTENT ?? "{}")

  for (const command of [defaultCommand, fullAccessCommand]) {
    expect(JSON.stringify(command)).not.toContain(REAL_SECRET)
    expect(command.env.ASTRAFLOW_MODELVERSE_API_KEY).toBeUndefined()
    expect(command.providerProxyTokenTransport).toBe("fd3")
    expect(
      providerProxy.resolveAgentProviderProxyCredential(
        command.providerProxyToken ?? ""
      )
    ).toMatchObject({
      apiKey: REAL_SECRET,
      authMode: "bearer",
    })
  }
  expect(defaultCommand.sandbox?.allowedNetworkDomains).toEqual([])
  expect(defaultCommand.sandbox?.allowedNetworkEndpoints).toEqual([
    { host: "127.0.0.1", port: 3456 },
  ])
  expect(fullAccessCommand.sandbox).toBeUndefined()
  expect(config.provider["modelverse-openai"].options.baseURL).toBe(
    "http://127.0.0.1:3456/api/internal/agent-provider/credential"
  )
  expect(config.provider["modelverse-openai"].options.apiKey).toBe(
    "{file:/dev/fd/3}"
  )
})

test("Windows OpenCode uses a one-shot named pipe instead of exporting its provider credential", () => {
  const command = stdio(
    acpRunConfig.configureOpenCodeAcpCommand(
      acpCommand,
      input("opencode-windows", "default", "gpt-5.6-sol"),
      {
        ...externalDependencies,
        platform: "win32",
      }
    )
  )
  const config = JSON.parse(command.env.OPENCODE_CONFIG_CONTENT ?? "{}")
  const credentialReference =
    config.provider["modelverse-openai"].options.apiKey

  expect(command.env.ASTRAFLOW_MODELVERSE_API_KEY).toBeUndefined()
  expect(command.providerProxyTokenTransport).toBe("windows_named_pipe")
  expect(command.providerProxyTokenPath).toMatch(
    /^\\\\\.\\pipe\\astraflow-provider-/
  )
  expect(credentialReference).toBe(
    `{file:${command.providerProxyTokenPath}}`
  )
  expect(JSON.stringify(command)).not.toContain(REAL_SECRET)
})

openCodeCredentialTransportTest(
  "local OpenCode receives its scoped provider bearer only through an anonymous descriptor",
  async () => {
    const configured = stdio(
      acpRunConfig.configureOpenCodeAcpCommand(
        acpCommand,
        input("opencode-fd", "full_access", "gpt-5.6-sol"),
        externalDependencies
      )
    )
    const child = acpRuntime.spawnAcpChild(
      {
        command: process.execPath,
        args: [
          "-e",
          [
            "const childProcess = require('node:child_process')",
            "const fs = require('node:fs')",
            "const credential = fs.readFileSync('/dev/fd/3', 'utf8')",
            "const shellProbe = childProcess.spawnSync(process.execPath, ['-e', `const fs = require('node:fs'); let value = null; try { value = fs.readFileSync('/dev/fd/3', 'utf8') } catch {}; process.stdout.write(JSON.stringify(value))`], { encoding: 'utf8' })",
            "process.stdout.write(JSON.stringify({ credential, environmentCredential: process.env.ASTRAFLOW_MODELVERSE_API_KEY || null, shellCredential: JSON.parse(shellProbe.stdout || 'null') }))",
          ].join(";"),
        ],
        env: configured.env,
        providerProxyToken: configured.providerProxyToken,
        providerProxyTokenTransport:
          configured.providerProxyTokenTransport,
        transport: "stdio",
      },
      root
    )
    const output = await new Promise<string>((resolveOutput, rejectOutput) => {
      let stdout = ""
      let stderr = ""

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString()
      })
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString()
      })
      child.once("error", rejectOutput)
      child.once("close", (code) => {
        if (code === 0) {
          resolveOutput(stdout)
        } else {
          rejectOutput(
            new Error(`OpenCode credential descriptor probe failed: ${stderr}`)
          )
        }
      })
    })
    const result = JSON.parse(output)

    expect(result.credential).toBe(configured.providerProxyToken)
    expect(result.environmentCredential).toBeNull()
    expect(result.shellCredential).toBeNull()
  }
)

test("OpenCode Anthropic appends v1 only on the child-facing proxy URL", () => {
  const command = stdio(
    acpRunConfig.configureOpenCodeAcpCommand(
      acpCommand,
      input("opencode-anthropic", "default", "claude-sonnet-4-6"),
      {
        resolveModelverseRunConfig: () => ({
          apiKey: REAL_SECRET,
          model: claudeModel,
        }),
      }
    )
  )
  const config = JSON.parse(command.env.OPENCODE_CONFIG_CONTENT ?? "{}")
  const record = providerProxy.resolveAgentProviderProxyCredential(
    command.providerProxyToken ?? ""
  )

  expect(config.provider["modelverse-anthropic"].options.baseURL).toBe(
    "http://127.0.0.1:3456/api/internal/agent-provider/credential/v1"
  )
  expect(config.provider["modelverse-anthropic"].options.apiKey).toBe(
    "{file:/dev/fd/3}"
  )
  expect(record?.baseUrl).toBe("https://api.modelverse.cn")
  expect(record?.authMode).toBe("bearer")
})

test("Claude Code local CLI settings fail closed in Default but remain available in explicit Full Access", () => {
  localSettingsRuntimes.add("claude-code")

  expect(() =>
    acpRunConfig.configureClaudeCodeAcpCommand(
      acpCommand,
      input("claude-code-local", "default", "claude-sonnet-4-6"),
      externalDependencies
    )
  ).toThrow(/requires a Desktop-managed Modelverse provider/)
  const fullAccess = stdio(
    acpRunConfig.configureClaudeCodeAcpCommand(
      acpCommand,
      input("claude-code-local", "full_access", "claude-sonnet-4-6"),
      externalDependencies
    )
  )

  expect(fullAccess.sandbox).toBeUndefined()
  expect(fullAccess.providerProxyToken).toBeUndefined()
  localSettingsRuntimes.delete("claude-code")
})

test("Codex Direct and Claude Native child environments contain only opaque provider credentials", () => {
  const codexInput = input("codex-direct", "default", "gpt-5.4-mini")
  const codexConfig = codexDirect.getCodexDirectModelverseConfig(codexInput, {
    resolveModelverseConfig: () => ({
      apiKey: REAL_SECRET,
      model: openAiModel,
    }),
  })
  const codexEnv = codexDirect.createCodexDirectEnv(codexConfig)
  const claudeConfig = claudeNative.resolveClaudeNativeRunConfig(
    input("claude-native", "default", "claude-sonnet-4-6"),
    {
      resolveModelverseConfig: () => ({
        apiKey: REAL_SECRET,
        model: claudeModel,
      }),
    }
  )

  expect(codexConfig).toBeTruthy()
  expect(JSON.stringify(codexEnv)).not.toContain(REAL_SECRET)
  expect(codexEnv.ASTRAFLOW_MODELVERSE_API_KEY).toHaveLength(43)
  expect(
    JSON.parse(codexEnv.CODEX_CONFIG ?? "{}").model_providers.modelverse
      .base_url
  ).toBe("http://127.0.0.1:3456/api/internal/agent-provider/credential")
  expect(JSON.stringify(claudeConfig)).not.toContain(REAL_SECRET)
  expect(claudeConfig.env?.ANTHROPIC_AUTH_TOKEN).toHaveLength(43)
  expect(claudeConfig.env?.ANTHROPIC_API_KEY).toBeUndefined()
  expect(claudeConfig.env?.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
  expect(claudeConfig.env?.ANTHROPIC_BASE_URL).toBe(
    "http://127.0.0.1:3456/api/internal/agent-provider/credential"
  )
  expect(
    providerProxy.resolveAgentProviderProxyCredential(
      claudeConfig.providerProxyToken ?? ""
    )
  ).toMatchObject({ authMode: "bearer", apiKey: REAL_SECRET })
})

test("OpenCode Native fails closed unless Full Access is explicit", async () => {
  expect(
    openCodeNative.getOpenCodeNativePermissionError({
      permissionMode: "default",
    })
  ).toMatch(/no verified process sandbox/)
  expect(
    openCodeNative.getOpenCodeNativePermissionError({
      permissionMode: "legacy_readonly",
    })
  ).toMatch(/no verified process sandbox/)
  expect(
    openCodeNative.getOpenCodeNativePermissionError({
      permissionMode: "full_access",
    })
  ).toBeNull()

  const runtime = openCodeNative.createOpenCodeNativeRuntime({
    baseUrl: "http://127.0.0.1:1",
  })
  const events = []

  for await (const event of runtime.startRun(
    input("opencode-native", "default", "gpt-5.6-sol")
  )) {
    events.push(event)
  }

  expect(events[0]?.type).toBe("error")
  expect(events[0]?.type === "error" ? events[0].message : "").toMatch(
    /Select Full Access explicitly/
  )
})
