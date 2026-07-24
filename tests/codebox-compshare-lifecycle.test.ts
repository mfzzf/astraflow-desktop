import assert from "node:assert/strict"
// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { beforeEach, describe, mock, test } from "bun:test"

import {
  getCodeBoxSandboxProfile,
  getCompShareCodeBoxAccess,
} from "@/lib/codebox-sandbox-profile"

const lifecycleCalls: Array<{
  action: string
  sandboxId?: string
  templateId?: string
  timeoutSeconds?: number
}> = []
const persisted = new Map<string, Record<string, unknown>>()
const persistedEnvdTokens = new Map<string, string>()
let directCreateCalls = 0
let directKillCalls = 0
let directAttachCalls = 0
const directAttachOptions: Array<Record<string, unknown>> = []
let selectedPlan = {
  code: "cp-qefblm9qadmd5m0s",
  name: "Basic 基础版",
  price: 199,
  originalPrice: 199,
}

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
mock.module("@/lib/compshare/entitlements", () => ({
  resolveCompShareSelectedPlan: async () => selectedPlan,
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
  ASTRAFLOW_WORKSPACE_CONFINEMENT_CAPABILITY:
    "agent.astraflow.workspace-confinement.v1",
  requireCompatibleWorkspaceGatewayAgentRuntime: () => undefined,
}))
mock.module("@/lib/studio-db", () => ({
  deleteCodeBoxSandboxRecord: (sandboxId: string) => {
    persistedEnvdTokens.delete(sandboxId)
    return persisted.delete(sandboxId)
  },
  getCodeBoxGithubTokens: () => null,
  getCodeBoxSandboxRecord: (sandboxId: string) =>
    persisted.get(sandboxId) ?? null,
  getCodeBoxSandboxEnvdAccessToken: (sandboxId: string) =>
    persistedEnvdTokens.get(sandboxId) ?? null,
  getStudioModelverseApiKey: () => null,
  getStudioOAuthTokens: () => null,
  listCodeBoxSandboxRecords: () => Array.from(persisted.values()),
  touchCodeBoxSandboxRecord: () => null,
  updateCodeBoxSandboxNameRecord: () => null,
  updateCodeBoxSandboxEnvdAccessTokenRecord: (
    sandboxId: string,
    envdAccessToken: string
  ) => {
    persistedEnvdTokens.set(sandboxId, envdAccessToken)
    return true
  },
  upsertCodeBoxSandboxRecord: (input: Record<string, unknown>) => {
    const { envdAccessToken, ...publicInput } = input
    if (typeof envdAccessToken === "string" && envdAccessToken) {
      persistedEnvdTokens.set(String(input.sandboxId), envdAccessToken)
    }
    const timestamp = "2026-07-22T00:00:00.000Z"
    const record = {
      ...publicInput,
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
    return {
      sandboxId: "compshare-sandbox-1",
      status: "Created",
      envdAccessToken: "envd-token-created",
    }
  },
  deleteCompShareSandbox: async (sandboxId: string) => {
    lifecycleCalls.push({ action: "delete", sandboxId })
    return { deleted: true, sandboxId }
  },
  describeCompShareSandbox: async (sandboxId: string) => {
    lifecycleCalls.push({ action: "describe-one", sandboxId })
    return {
      sandboxId,
      templateId: "i21vxo1qnl9gmk8nqakj",
      envdAccessToken: "envd-token-described",
      status: "Created",
      userEmail: null,
      createTime: 1_784_686_233,
      updateTime: 1_784_686_233,
      endAt: 1_784_689_833,
    }
  },
  describeCompShareSandboxes: async () => {
    lifecycleCalls.push({ action: "describe" })
    return [
      {
        sandboxId: "compshare-sandbox-1",
        templateId: "i21vxo1qnl9gmk8nqakj",
        envdAccessToken: "envd-token-described",
        status: "Created",
        userEmail: null,
        createTime: 1_784_686_233,
        updateTime: 1_784_686_233,
        endAt: 1_784_689_833,
      },
    ]
  },
  setCompShareSandboxTimeout: async (
    sandboxId: string,
    timeoutSeconds: number
  ) => {
    lifecycleCalls.push({ action: "set-timeout", sandboxId, timeoutSeconds })
    return { sandboxId, timeoutSeconds }
  },
}))

const { ASTRAFLOW_SANDBOX_TEMPLATE, runAstraFlowSandboxCode } =
  await import("@/lib/astraflow-sandbox-runtime")

const {
  ASTRAFLOW_CODE_SANDBOX_TEMPLATE,
  createCodeBoxSandbox,
  killCodeBoxSandbox,
  connectOwnedCodeBoxSandbox,
  listCodeBoxSandboxes,
} = await import("@/lib/codebox-runtime")

beforeEach(() => {
  lifecycleCalls.length = 0
  persisted.clear()
  persistedEnvdTokens.clear()
  directCreateCalls = 0
  directKillCalls = 0
  directAttachCalls = 0
  directAttachOptions.length = 0
  selectedPlan = {
    code: "cp-qefblm9qadmd5m0s",
    name: "Basic 基础版",
    price: 199,
    originalPrice: 199,
  }
})

describe("CodeBox CompShare lifecycle routing", () => {
  test("keeps the dedicated general sandbox and Pro CodeBox defaults", () => {
    assert.equal(ASTRAFLOW_SANDBOX_TEMPLATE, "i21vxo1qnl9gmk8nqakj")
    assert.equal(ASTRAFLOW_CODE_SANDBOX_TEMPLATE, "79a9c0uxquw17scu698u")
  })

  test("exposes the assigned CPU and memory for the CodeBox panel", () => {
    assert.deepEqual(getCodeBoxSandboxProfile("i21vxo1qnl9gmk8nqakj"), {
      tier: "basic",
      label: "Basic",
      cpuCount: 2,
      memoryMB: 4096,
      templateId: "i21vxo1qnl9gmk8nqakj",
    })
    assert.deepEqual(getCodeBoxSandboxProfile("79a9c0uxquw17scu698u"), {
      tier: "pro",
      label: "Pro+",
      cpuCount: 8,
      memoryMB: 8192,
      templateId: "79a9c0uxquw17scu698u",
    })
  })

  test("maps the current 199/499/799/999 package IDs to sandbox access", () => {
    assert.deepEqual(getCompShareCodeBoxAccess("cp-qefblm9qadmd5m0s"), {
      allowedSizes: ["2c4g"],
      defaultSize: "2c4g",
    })

    for (const planCode of [
      "cp-us783egxorxbcoxd",
      "cp-umtvqmhllyfdnhgf",
      "cp-ed7xwzitoiyd4nuk",
    ]) {
      assert.deepEqual(getCompShareCodeBoxAccess(planCode), {
        allowedSizes: ["2c4g", "8c8g"],
        defaultSize: "8c8g",
      })
    }

    assert.equal(getCompShareCodeBoxAccess("cp-drfubqaxtxx0y5rt"), null)
  })

  test("creates a 2C4G CodeBox for the 199 Basic package", async () => {
    const result = await createCodeBoxSandbox({
      name: "CompShare box",
      sandboxSize: "2c4g",
    })

    assert.equal(result.sandboxId, "compshare-sandbox-1")
    assert.equal(result.template, "i21vxo1qnl9gmk8nqakj")
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
      envdAccessToken: "envd-token-created",
    })
    assert.deepEqual(lifecycleCalls, [
      { action: "create", templateId: "i21vxo1qnl9gmk8nqakj" },
      {
        action: "set-timeout",
        sandboxId: "compshare-sandbox-1",
        timeoutSeconds: 3_600,
      },
    ])
  })

  test("creates an 8C8G CodeBox for Pro and higher packages", async () => {
    selectedPlan = {
      code: "cp-us783egxorxbcoxd",
      name: "Pro 专业版",
      price: 499,
      originalPrice: 499,
    }

    const result = await createCodeBoxSandbox({
      name: "CompShare Pro box",
      sandboxSize: "8c8g",
    })

    assert.equal(result.template, "79a9c0uxquw17scu698u")
    assert.deepEqual(lifecycleCalls, [
      { action: "create", templateId: "79a9c0uxquw17scu698u" },
      {
        action: "set-timeout",
        sandboxId: "compshare-sandbox-1",
        timeoutSeconds: 3_600,
      },
    ])
  })

  test("allows a Pro package to choose the smaller 2C4G configuration", async () => {
    selectedPlan = {
      code: "cp-umtvqmhllyfdnhgf",
      name: "Max 高级版",
      price: 799,
      originalPrice: 799,
    }

    const result = await createCodeBoxSandbox({
      name: "CompShare smaller box",
      sandboxSize: "2c4g",
    })

    assert.equal(result.template, "i21vxo1qnl9gmk8nqakj")
  })

  test("rejects 8C8G for the Basic package before creating a sandbox", async () => {
    await assert.rejects(
      createCodeBoxSandbox({
        name: "Oversized Basic box",
        sandboxSize: "8c8g",
      }),
      /does not include the 8C8G/
    )
    assert.equal(lifecycleCalls.length, 0)
  })

  test("rejects packages that do not include a CodeBox sandbox", async () => {
    selectedPlan = {
      code: "cp-drfubqaxtxx0y5rt",
      name: "Lite 入门版",
      price: 99,
      originalPrice: 99,
    }

    await assert.rejects(
      createCodeBoxSandbox({
        name: "Lite box",
        sandboxSize: "2c4g",
      }),
      /does not include a CodeBox sandbox/
    )
    assert.equal(lifecycleCalls.length, 0)
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
      template: "i21vxo1qnl9gmk8nqakj",
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

  test("recovers a missing envd token from DescribeSandbox and persists it", async () => {
    persisted.set("compshare-sandbox-1", {
      sandboxId: "compshare-sandbox-1",
      ownerKey: "compshare:key:key-1",
    })

    await connectOwnedCodeBoxSandbox("compshare-sandbox-1")

    assert.equal(
      persistedEnvdTokens.get("compshare-sandbox-1"),
      "envd-token-described"
    )
    assert.deepEqual(lifecycleCalls, [
      { action: "describe-one", sandboxId: "compshare-sandbox-1" },
      {
        action: "set-timeout",
        sandboxId: "compshare-sandbox-1",
        timeoutSeconds: 3_600,
      },
    ])
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
      {
        action: "set-timeout",
        sandboxId: "compshare-sandbox-1",
        timeoutSeconds: 60,
      },
      { action: "delete", sandboxId: "compshare-sandbox-1" },
    ])
  })
})
