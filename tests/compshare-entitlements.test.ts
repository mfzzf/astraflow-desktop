import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { beforeEach, describe, expect, mock, test } from "bun:test"

type SelectedApiKey = {
  keyCode: string
  apiKey: string
  userPlanCode: string
  planCode?: string
  updatedAt: string
}

type ActionCall = {
  Action: string
  KeyCode?: string
}
type GetUserPlanResponse = {
  Key: {
    Code: string
    Status: number
    UserPlanCode: string
  }
  UserPlan: {
    Code: string
    PlanCode: string
    Status: number
    ExpireAt?: number
  }
}

type PlanResponse = {
  Code: string
  Name: string
  Price: number
  OriginalPrice: number
  Status: number
  Models: Array<{
    Code: string
    Name: string
    Ratio: string | number
  }>
}

type ListPlansResponse = {
  Plans: PlanResponse[]
}

const credentials = {
  publicKey: "test-public-key",
  privateKey: "test-private-key",
}
let selected: SelectedApiKey | null
let getUserPlanResponse: GetUserPlanResponse
let listPlansResponse: ListPlansResponse
let getUserPlanGate: Promise<void> | null = null
const actionCalls: ActionCall[] = []
const controlCredentialCalls: Array<typeof credentials> = []

function createActiveGetUserPlanResponse(): GetUserPlanResponse {
  return {
    Key: {
      Code: "key-selected",
      Status: 1,
      UserPlanCode: "",
    },
    UserPlan: {
      Code: "user-plan-selected",
      PlanCode: "plan-selected",
      Status: 1,
      ExpireAt: Math.floor(Date.now() / 1_000) + 3_600,
    },
  }
}

function createPlansResponse(): ListPlansResponse {
  return {
    Plans: [
      {
        Code: "plan-company",
        Name: "Company",
        Price: 499,
        OriginalPrice: 499,
        Status: 1,
        Models: [
          { Code: "company-only", Name: "company-secret-model", Ratio: 1 },
        ],
      },
      {
        Code: "plan-selected",
        Name: "Basic 基础版",
        Price: 199,
        OriginalPrice: 299,
        Status: 1,
        Models: [
          { Code: "MINI-ALIAS", Name: "gpt-5.4-mini", Ratio: "0.75" },
          { Code: "PLAN-ONLY", Name: "plan-exact-model", Ratio: 1 },
        ],
      },
    ],
  }
}
const ISOLATED_RUN_ENV = "ASTRAFLOW_COMPSHARE_ENTITLEMENTS_ISOLATED"

if (process.env[ISOLATED_RUN_ENV] === "1") {
  mock.module("server-only", () => ({}))
  mock.module("@/lib/compshare/config", () => ({
    COMPSHARE_CHANNEL_SLUG: "compshare",
    COMPSHARE_CONTROL_PLANE_URL: "https://api.compshare.cn/",
    COMPSHARE_DEFAULT_MODEL: "deepseek-v4-flash",
    COMPSHARE_MODEL_API_BASE_URL: "https://cp.compshare.cn/v1",
    isCompShareChannel: () => true,
    isCompShareChannelSlug: (slug: string | null | undefined) =>
      slug?.trim().toLowerCase() === "compshare",
  }))
  mock.module("@/lib/compshare/control-plane", () => ({
    callCompShareAction: async ({
      credentials: suppliedCredentials,
      params,
    }: {
      credentials: typeof credentials
      params: ActionCall
    }) => {
      controlCredentialCalls.push({ ...suppliedCredentials })
      actionCalls.push({ ...params })

      if (params.Action === "GetOpenAPIUserPlanByKey") {
        if (getUserPlanGate) {
          await getUserPlanGate
        }
        return getUserPlanResponse
      }

      if (params.Action === "ListOpenAPIPlans") {
        return listPlansResponse
      }

      if (params.Action === "GetOpenAPIUserPlans") {
        return {
          UserPlans: [
            {
              Code: "user-plan-company",
              PlanCode: "plan-company",
              Status: 1,
              ExpireAt: Math.floor(Date.now() / 1_000) + 3_600,
            },
            {
              Code: "user-plan-selected",
              PlanCode: "plan-selected",
              Status: 1,
              ExpireAt: Math.floor(Date.now() / 1_000) + 3_600,
            },
          ],
        }
      }
      throw new Error(`Unexpected CompShare action: ${params.Action}`)
    },
  }))
  mock.module("@/lib/studio-db/compshare", () => ({
    getCompShareControlCredentials: () => credentials,
    getCompShareSelectedApiKey: () => selected,
  }))
  mock.module("@/lib/channel-config", () => ({
    getDistributionChannelSlug: () => "compshare",
    getChannelRuntimeConfig: async () => ({
      slug: "compshare",
      revision: 17,
      restrictModels: false,
      allowedModelIds: [],
    }),
  }))
  mock.module("@/lib/channel-config-shared", () => ({
    isChannelModelAllowed: () => true,
  }))
  mock.module("@/lib/studio-db", () => ({
    getSelectedUCloudProjectId: () => "",
    getStudioAstraFlowApiKeySessionStatus: () => ({ authenticated: false }),
    getStudioModelverseApiKey: () => ({ key: "test-modelverse-key" }),
  }))
  mock.module("@/lib/modelverse-api-keys", () => ({
    listModelverseAvailableModelIds: async () => [],
    resolveModelverseProjectId: async () => "",
  }))
  mock.module("@/lib/ucloud-credentials", () => ({
    getUCloudCredentials: async () => null,
  }))
  mock.module("@/lib/ucloud", () => ({
    callUCloudAction: async () => ({}),
  }))

  // Dynamic imports are required because Bun module mocks must be installed first.
  const entitlements = await import("@/lib/compshare/entitlements")
  const endpoints = await import("@/lib/model-provider-config")
  const modelCatalog = await import("@/lib/agent-model-catalog")

  beforeEach(() => {
    selected = {
      keyCode: "key-selected",
      apiKey: "test-package-api-key",
      userPlanCode: "user-plan-selected",
      planCode: "plan-selected",
      updatedAt: "2026-07-22T00:00:00.000Z",
    }
    getUserPlanResponse = createActiveGetUserPlanResponse()
    listPlansResponse = createPlansResponse()
    getUserPlanGate = null
    actionCalls.length = 0
    controlCredentialCalls.length = 0
    entitlements.invalidateCompShareEntitlements()
  })

  describe("CompShare entitlements", () => {
    test("defaults CompShare runtimes to deepseek-v4-flash", () => {
      const runtimes = {
        astraflow: {
          useLocalSettings: false,
          defaultModel: "gpt-5.6-sol",
        },
      }
      const models = [
        {
          id: "deepseek-plan-code",
          label: "DeepSeek V4 Flash",
          providerModel: "deepseek-v4-flash",
          protocol: "openai-chat",
          baseUrl: null,
          supportedRuntimeIds: ["astraflow"],
          reasoningEfforts: ["none"],
          defaultReasoningEffort: "none",
          builtin: true,
          enabled: true,
        },
      ]

      const repaired = modelCatalog.repairAgentModelRuntimeDefaults(
        runtimes as never,
        models as never
      )

      expect(repaired.astraflow.defaultModel).toBe("deepseek-plan-code")
    })
    test("follows the selected KeyCode through UserPlan.PlanCode and uses only that plan's models", async () => {
      const models = await entitlements.listCompShareEntitledModels()

      expect(actionCalls).toEqual([
        { Action: "GetOpenAPIUserPlanByKey", KeyCode: "key-selected" },
        { Action: "ListOpenAPIPlans" },
      ])
      expect(controlCredentialCalls).toEqual([credentials, credentials])
      expect(models).toEqual([
        { code: "MINI-ALIAS", name: "gpt-5.4-mini", ratio: 0.75 },
        { code: "PLAN-ONLY", name: "plan-exact-model", ratio: 1 },
      ])
      expect(models?.some((model) => model.code === "company-only")).toBe(false)
    })

    test("resolves the selected package ID and live catalog tier", async () => {
      await expect(entitlements.resolveCompShareSelectedPlan()).resolves.toEqual(
        {
          code: "plan-selected",
          name: "Basic 基础版",
          price: 199,
          originalPrice: 299,
        }
      )
      expect(actionCalls).toEqual([
        { Action: "GetOpenAPIUserPlanByKey", KeyCode: "key-selected" },
        { Action: "ListOpenAPIPlans" },
      ])
    })

    test("lists models from active owned plans before an API key is selected", async () => {
      selected = null

      const models = await entitlements.listCompShareEntitledModels()

      expect(actionCalls).toEqual([
        { Action: "GetOpenAPIUserPlans" },
        { Action: "ListOpenAPIPlans" },
      ])
      expect(models).toEqual([
        { code: "company-only", name: "company-secret-model", ratio: 1 },
        { code: "MINI-ALIAS", name: "gpt-5.4-mini", ratio: 0.75 },
        { code: "PLAN-ONLY", name: "plan-exact-model", ratio: 1 },
      ])
      const definitions =
        await entitlements.listCompShareAgentModelDefinitions()
      expect(
        definitions?.map(({ id, label, providerModel }) => ({
          id,
          label,
          providerModel,
        }))
      ).toEqual([
        {
          id: "company-only",
          label: "company-secret-model",
          providerModel: "company-secret-model",
        },
        {
          id: "MINI-ALIAS",
          label: "GPT 5.4 Mini",
          providerModel: "gpt-5.4-mini",
        },
        {
          id: "PLAN-ONLY",
          label: "plan-exact-model",
          providerModel: "plan-exact-model",
        },
      ])
    })
    test("builds every package model from the API as an OpenAI chat model", async () => {
      const models = await entitlements.listCompShareAgentModelDefinitions()

      expect(
        models?.map(({ id, providerModel, protocol, supportedRuntimeIds }) => ({
          id,
          providerModel,
          protocol,
          supportedRuntimeIds,
        }))
      ).toEqual([
        {
          id: "MINI-ALIAS",
          providerModel: "gpt-5.4-mini",
          protocol: "openai-chat",
          supportedRuntimeIds: [
            "astraflow",
            "codex",
            "codex-direct",
            "opencode",
          ],
        },
        {
          id: "PLAN-ONLY",
          providerModel: "plan-exact-model",
          protocol: "openai-chat",
          supportedRuntimeIds: [
            "astraflow",
            "codex",
            "codex-direct",
            "opencode",
          ],
        },
      ])
    })

    test("resolves both Code and Name aliases to the exact executable Name", async () => {
      await expect(
        entitlements.resolveCompShareEntitledModel("  mini-alias  ")
      ).resolves.toBe("gpt-5.4-mini")
      await expect(
        entitlements.resolveCompShareEntitledModel("GPT-5.4-MINI")
      ).resolves.toBe("gpt-5.4-mini")

      expect(actionCalls.map((call) => call.Action)).toEqual([
        "GetOpenAPIUserPlanByKey",
        "ListOpenAPIPlans",
      ])
    })

    const invalidUserPlanCases: ReadonlyArray<
      readonly [string, (response: GetUserPlanResponse) => void]
    > = [
      [
        "inactive key",
        (response) => {
          response.Key.Status = 0
        },
      ],
      [
        "inactive user plan",
        (response) => {
          response.UserPlan.Status = 0
        },
      ],
      [
        "missing expiry",
        (response) => {
          delete response.UserPlan.ExpireAt
        },
      ],
      [
        "expired user plan",
        (response) => {
          response.UserPlan.ExpireAt = Math.floor(Date.now() / 1_000) - 1
        },
      ],
      [
        "mismatched key-to-user-plan link",
        (response) => {
          response.Key.UserPlanCode = "another-user-plan"
        },
      ],
    ]

    test.each(invalidUserPlanCases)(
      "fails closed for %s",
      async (
        _label: string,
        mutate: (response: GetUserPlanResponse) => void
      ) => {
        mutate(getUserPlanResponse)

        await expect(
          entitlements.listCompShareEntitledModels()
        ).resolves.toEqual([])
        expect(actionCalls).toEqual([
          { Action: "GetOpenAPIUserPlanByKey", KeyCode: "key-selected" },
        ])
      }
    )

    test("fails closed when the selected plan is inactive", async () => {
      listPlansResponse.Plans[1].Status = 0

      await expect(entitlements.listCompShareEntitledModels()).resolves.toEqual(
        []
      )
      expect(actionCalls.map((call) => call.Action)).toEqual([
        "GetOpenAPIUserPlanByKey",
        "ListOpenAPIPlans",
      ])
    })

    test("singleflights concurrent loads, caches the result, and refetches after invalidation", async () => {
      let releaseGetUserPlan!: () => void
      getUserPlanGate = new Promise<void>((resolve) => {
        releaseGetUserPlan = resolve
      })

      const first = entitlements.listCompShareEntitledModels()
      const second = entitlements.listCompShareEntitledModels()

      await Promise.resolve()
      expect(actionCalls).toEqual([
        { Action: "GetOpenAPIUserPlanByKey", KeyCode: "key-selected" },
      ])

      releaseGetUserPlan()
      const [firstModels, secondModels] = await Promise.all([first, second])
      expect(firstModels).toEqual(secondModels)
      expect(actionCalls.map((call) => call.Action)).toEqual([
        "GetOpenAPIUserPlanByKey",
        "ListOpenAPIPlans",
      ])

      await entitlements.listCompShareEntitledModels()
      expect(actionCalls).toHaveLength(2)

      entitlements.invalidateCompShareEntitlements()
      await entitlements.listCompShareEntitledModels()
      expect(actionCalls.map((call) => call.Action)).toEqual([
        "GetOpenAPIUserPlanByKey",
        "ListOpenAPIPlans",
        "GetOpenAPIUserPlanByKey",
        "ListOpenAPIPlans",
      ])
    })

    test("rejects a forged model with the stable entitlement 403", async () => {
      await expect(
        entitlements.resolveCompShareEntitledModel("company-secret-model")
      ).rejects.toMatchObject({
        name: "CompShareEntitlementError",
        code: "COMPSHARE_MODEL_NOT_ENTITLED",
        status: 403,
        message: "The selected CompShare package does not include this model.",
      })
    })
  })

  describe("CompShare model endpoints", () => {
    test("uses the CompShare OpenAI chat-completions URL", () => {
      expect(
        endpoints.resolveModelProviderDataPlane("compshare")
      ).toMatchObject({
        channel: "compshare",
        providerName: "CompShare",
        baseUrl: "https://cp.compshare.cn/v1",
        apiKey: "test-package-api-key",
        keyCode: "key-selected",
      })

      expect(
        endpoints.resolveModelProviderEndpoint({
          channel: "compshare",
          protocol: "openai-chat",
        })
      ).toMatchObject({
        baseUrl: "https://cp.compshare.cn/v1",
        path: "chat/completions",
        url: "https://cp.compshare.cn/v1/chat/completions",
      })
    })

    test("preserves the ModelVerse endpoint defaults", () => {
      expect(
        endpoints.resolveModelProviderEndpoint({
          channel: "modelverse",
          protocol: "openai-chat",
        }).url
      ).toBe("https://api.modelverse.cn/v1/chat/completions")
      expect(
        endpoints.resolveModelProviderEndpoint({
          channel: "modelverse",
          protocol: "openai-responses",
        }).url
      ).toBe("https://api.modelverse.cn/v1/responses")
      expect(
        endpoints.resolveModelProviderEndpoint({
          channel: "modelverse",
          protocol: "anthropic-messages",
        }).url
      ).toBe("https://api.modelverse.cn/v1/messages")
    })
  })
} else {
  test("passes the isolated CompShare entitlement contract suite", () => {
    const result = spawnSync(
      process.execPath,
      ["test", fileURLToPath(import.meta.url)],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          [ISOLATED_RUN_ENV]: "1",
        },
      }
    )

    assert.equal(result.status, 0, result.stderr || result.stdout)
  })
}
