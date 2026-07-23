import assert from "node:assert/strict"
// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { beforeEach, describe, mock, test } from "bun:test"

const lifecycleCalls: Array<{
  action: string
  sandboxId?: string
  templateId?: string
}> = []
const persisted = new Map<string, Record<string, unknown>>()
let directCreateCalls = 0
let directKillCalls = 0
let directAttachCalls = 0
const directAttachOptions: Array<Record<string, unknown>> = []

const fakeSandbox = {
  sandboxId: "compshare-sandbox-1",
  files: {
    write: async () => undefined,
    read: async () => "password: restored-password\n",
  },
  commands: {
    run: async (command: string) => ({
      exitCode: command.startsWith("test -f ") ? 1 : 0,
      stdout: "",
      stderr: "",
      disconnect: async () => undefined,
    }),
  },
  pty: {},
  runCode: async () => {
    throw new Error("runtime probe stopped after connect")
  },
  setTimeout: async (timeoutMs: number) => {
    lifecycleCalls.push({ action: `timeout:${timeoutMs}` })
  },
  getHost: (port: number) =>
    `${port}-compshare-sandbox-1.cn-wlcb.sandbox.ucloudai.com`,
  kill: async () => {
    directKillCalls += 1
    return true
  },
}

class FakeCommandExitError extends Error {}

class FakeSandbox {
  constructor(options: Record<string, unknown>) {
    directAttachCalls += 1
    directAttachOptions.push(options)
    Object.assign(this, fakeSandbox)
  }

  static async create() {
    directCreateCalls += 1
    return fakeSandbox
  }

  static async connect(sandboxId: string) {
    throw new Error(
      `Sandbox.connect must not authenticate CompShare sandbox ${sandboxId}.`
    )
  }

  static async kill() {
    directKillCalls += 1
    return true
  }

  static list() {
    throw new Error("Direct Sandbox.list must not serve the CompShare channel.")
  }
}

mock.module("server-only", () => ({}))
mock.module("@e2b/code-interpreter", () => ({
  CommandExitError: FakeCommandExitError,
  Sandbox: FakeSandbox,
}))
mock.module("@/lib/compshare/config", () => ({
  COMPSHARE_CHANNEL_SLUG: "compshare",
  COMPSHARE_CONTROL_PLANE_URL: "https://api.compshare.cn/",
  COMPSHARE_MODEL_API_BASE_URL: "https://cp.compshare.cn/v1",
  COMPSHARE_DEFAULT_MODEL: "deepseek-v4-flash",
  COMPSHARE_CAPABILITIES: Object.freeze({
    controlPlaneAuth: "ucloud-signature",
    modelAuth: "bearer",
    oauthRefresh: false,
    streaming: true,
  }),
  isCompShareChannelSlug: (slug: string | null | undefined) =>
    slug?.trim().toLowerCase() === "compshare",
  isCompShareChannel: () => true,
}))
mock.module("@/lib/model-provider-config", () => ({
  resolveModelProviderDataPlane: () => ({
    channel: "compshare",
    providerName: "CompShare",
    apiKey: "selected-model-key",
    keyCode: "key-1",
  }),
  resolveModelProviderEndpoint: ({ protocol }: { protocol: string }) => ({
    baseUrl:
      protocol === "anthropic-messages"
        ? "https://api.compshare.cn"
        : "https://api.compshare.cn/v1",
  }),
  resolveModelProviderOpenCodeBaseUrl: () => "https://api.compshare.cn/v1",
}))
mock.module("@/lib/sandbox-workspace-paths", () => ({
  ASTRAFLOW_SANDBOX_EXTERNAL_FILE_ROOTS: [],
  isPosixPathInsideRoot: () => false,
  normalizeSandboxReadableFilePath: (value: string) => value,
}))
mock.module("@/lib/workspace-gateway-compatibility", () => ({
  requireCompatibleWorkspaceGatewayAgentRuntime: () => undefined,
}))
mock.module("@/lib/studio-db", () => ({
  deleteCodeBoxSandboxRecord: (sandboxId: string) =>
    persisted.delete(sandboxId),
  getCodeBoxGithubTokens: () => null,
  getCodeBoxSandboxRecord: (sandboxId: string) =>
    persisted.get(sandboxId) ?? null,
  getStudioModelverseApiKey: () => null,
  getStudioOAuthTokens: () => null,
  listCodeBoxSandboxRecords: () => Array.from(persisted.values()),
  touchCodeBoxSandboxRecord: () => null,
  updateCodeBoxSandboxNameRecord: () => null,
  upsertCodeBoxSandboxRecord: (input: Record<string, unknown>) => {
    const timestamp = "2026-07-22T00:00:00.000Z"
    const record = {
      ...input,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastUsedAt: timestamp,
    }
    persisted.set(String(input.sandboxId), record)
    return record
  },
}))
mock.module("@/lib/compshare/sandboxes", () => ({
  createCompShareSandbox: async ({ templateId }: { templateId: string }) => {
    lifecycleCalls.push({ action: "create", templateId })
    return { sandboxId: "compshare-sandbox-1", status: "Created" }
  },
  deleteCompShareSandbox: async (sandboxId: string) => {
    lifecycleCalls.push({ action: "delete", sandboxId })
    return { deleted: true, sandboxId }
  },
  describeCompShareSandboxes: async () => {
    lifecycleCalls.push({ action: "describe" })
    return [
      {
        sandboxId: "compshare-sandbox-1",
        templateId: "yeyb5hbs2kweus6ku07l",
        status: "Created",
        userEmail: null,
        createTime: 1_784_686_233,
        updateTime: 1_784_686_233,
      },
    ]
  },
}))

const { ASTRAFLOW_SANDBOX_TEMPLATE, runAstraFlowSandboxCode } =
  await import("@/lib/astraflow-sandbox-runtime")

const {
  ASTRAFLOW_CODE_SANDBOX_TEMPLATE,
  createCodeBoxSandbox,
  killCodeBoxSandbox,
  listCodeBoxSandboxes,
} = await import("@/lib/codebox-runtime")

beforeEach(() => {
  lifecycleCalls.length = 0
  persisted.clear()
  directCreateCalls = 0
  directKillCalls = 0
  directAttachCalls = 0
  directAttachOptions.length = 0
})

describe("CodeBox CompShare lifecycle routing", () => {
  test("creates through api.compshare.cn and keeps ucloudai.com for sandbox access", async () => {
    const result = await createCodeBoxSandbox({ name: "CompShare box" })

    assert.equal(result.sandboxId, "compshare-sandbox-1")
    assert.equal(
      result.codeServerHost,
      "8080-compshare-sandbox-1.cn-wlcb.sandbox.ucloudai.com"
    )
    assert.equal(directCreateCalls, 0)
    assert.equal(directAttachCalls, 1)
    assert.deepEqual(directAttachOptions[0], {
      apiKey: undefined,
      validateApiKey: false,
      requestTimeoutMs: 30_000,
      domain: "cn-wlcb.sandbox.ucloudai.com",
      sandboxId: "compshare-sandbox-1",
      envdVersion: "0.4.0",
      timeoutMs: 3_600_000,
    })
    assert.deepEqual(lifecycleCalls, [
      { action: "create", templateId: ASTRAFLOW_CODE_SANDBOX_TEMPLATE },
    ])
  })

  test("lists through DescribeSandbox instead of the E2B account paginator", async () => {
    persisted.set("compshare-sandbox-1", {
      sandboxId: "compshare-sandbox-1",
      name: "CompShare box",
      ownerKey: "compshare:key:key-1",
      ownerEmail: null,
      companyId: "compshare",
      projectId: "key:key-1",
      sandboxDomain: "cn-wlcb.sandbox.ucloudai.com",
      template: ASTRAFLOW_CODE_SANDBOX_TEMPLATE,
      status: "running",
      volumeId: null,
      volumeName: null,
      codeServerUrl:
        "https://8080-compshare-sandbox-1.cn-wlcb.sandbox.ucloudai.com/?folder=%2Fworkspace",
      codeServerHost: "8080-compshare-sandbox-1.cn-wlcb.sandbox.ucloudai.com",
      codeServerPort: 8080,
      password: "known-password",
      workspacePath: "/workspace",
      repoUrl: null,
      startedAt: null,
      endAt: null,
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:00:00.000Z",
      lastUsedAt: "2026-07-22T00:00:00.000Z",
    })

    const result = await listCodeBoxSandboxes()

    assert.equal(result.length, 1)
    assert.equal(result[0].sandboxId, "compshare-sandbox-1")
    assert.deepEqual(lifecycleCalls, [{ action: "describe" }])
  })

  test("deletes through DeleteSandbox instead of the direct SDK", async () => {
    persisted.set("compshare-sandbox-1", {
      sandboxId: "compshare-sandbox-1",
    })

    assert.equal(await killCodeBoxSandbox("compshare-sandbox-1"), true)
    assert.equal(directKillCalls, 0)
    assert.deepEqual(lifecycleCalls, [
      { action: "delete", sandboxId: "compshare-sandbox-1" },
    ])
    assert.equal(persisted.has("compshare-sandbox-1"), false)
  })
})

describe("General CompShare sandbox lifecycle routing", () => {
  test("uses CompShare creation and deletion while retaining the ucloudai.com data plane", async () => {
    await assert.rejects(
      runAstraFlowSandboxCode({
        apiKey: "selected-model-key",
        code: "print('probe')",
        language: "python",
        autoPause: false,
        timeoutSeconds: 1,
      }),
      /runtime probe stopped after connect/
    )

    assert.equal(directCreateCalls, 0)
    assert.equal(directAttachCalls, 1)
    assert.equal(directKillCalls, 0)
    assert.deepEqual(lifecycleCalls, [
      { action: "create", templateId: ASTRAFLOW_SANDBOX_TEMPLATE },
      { action: "delete", sandboxId: "compshare-sandbox-1" },
    ])
  })
})
