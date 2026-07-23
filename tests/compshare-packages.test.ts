import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { beforeEach, describe, mock, test } from "bun:test"

type ControlRequest = {
  credentials: { publicKey: string; privateKey: string }
  params: Record<string, unknown>
}

type StoredKey = {
  keyCode: string
  apiKey: string
  userPlanCode: string
  planCode?: string
  name?: string
  updatedAt: string
}

const fixtureCredentials = {
  publicKey: "fixture-public-key",
  privateKey: "fixture-private-key",
}

let selectedKey: StoredKey | null = null
let controlRequests: ControlRequest[] = []
let storageEvents: string[] = []
let invalidationCount = 0
let keyring = new Map<string, { apiKey: string; userPlanCode?: string }>()
let controlHandler: (
  request: ControlRequest
) => Promise<Record<string, unknown>>

class MockCompShareApiError extends Error {
  readonly status: number
  readonly retCode?: number

  constructor(message: string, status = 502, retCode?: number) {
    super(message)
    this.status = status
    this.retCode = retCode
  }
}

const callCompShareAction = mock(async (request: ControlRequest) => {
  controlRequests.push(request)
  return controlHandler(request)
})

if (process.env.COMPSHARE_PACKAGES_ISOLATED === "1") {
  mock.module("server-only", () => ({}))
  mock.module("@/lib/compshare/control-plane", () => ({
    callCompShareAction,
    CompShareApiError: MockCompShareApiError,
  }))
  mock.module("@/lib/compshare/entitlements", () => ({
    invalidateCompShareEntitlements: () => {
      invalidationCount += 1
      storageEvents.push("invalidate")
    },
  }))
  mock.module("@/lib/studio-db/compshare", () => ({
    clearCompShareSelectedApiKey: () => {
      selectedKey = null
      storageEvents.push("clear-selected")
    },
    getCompShareApiKeyByCode: (keyCode: string) =>
      keyring.get(keyCode)?.apiKey ?? null,
    getCompShareControlCredentials: () => fixtureCredentials,
    getCompShareSelectedApiKey: () => selectedKey,
    removeCompShareApiKey: (keyCode: string) => {
      keyring.delete(keyCode)
      storageEvents.push(`remove:${keyCode}`)
      if (selectedKey?.keyCode === keyCode) selectedKey = null
    },
    saveCompShareSelectedApiKey: (input: Omit<StoredKey, "updatedAt">) => {
      selectedKey = { ...input, updatedAt: "fixture-time" }
      keyring.set(input.keyCode, {
        apiKey: input.apiKey,
        userPlanCode: input.userPlanCode,
      })
      storageEvents.push(`select:${input.keyCode}`)
      return selectedKey
    },
    upsertCompShareApiKey: (input: {
      keyCode: string
      apiKey: string
      userPlanCode?: string
    }) => {
      keyring.set(input.keyCode, {
        apiKey: input.apiKey,
        userPlanCode: input.userPlanCode,
      })
      storageEvents.push(`upsert:${input.keyCode}`)
    },
  }))

  // These server dependencies must be mocked before packages.ts is evaluated.
  const packages = await import("@/lib/compshare/packages")

  beforeEach(() => {
    selectedKey = null
    controlRequests = []
    storageEvents = []
    invalidationCount = 0
    keyring = new Map()
    controlHandler = async () => {
      throw new Error("Unexpected CompShare control-plane call")
    }
  })

  describe("CompShare package contract adaptation", () => {
    test("adapts live Plans[].Models fields and sends no browser identity", async () => {
      controlHandler = async () => ({
        RetCode: 0,
        TotalCount: 1,
        Plans: [
          {
            Code: "plan-standard",
            Name: "Standard",
            LimitPer5h: 50,
            LimitPerWeek: 500,
            LimitPerMonth: 1500,
            ConcurrencyLimit: 3,
            IsTeam: 0,
            Status: 1,
            CreatedAt: 1_700_000_000,
            Models: [
              {
                Code: "model-live-code",
                Name: "Live Model",
                Ratio: 1.25,
                code: "wrong-lowercase-code",
                name: "Wrong lowercase name",
                ratio: 99,
              },
            ],
            Price: 12,
            OriginalPrice: 20,
          },
        ],
      })

      const result = await packages.listCompSharePlans()

      assert.deepEqual(controlRequests, [
        {
          credentials: fixtureCredentials,
          params: { Action: "ListOpenAPIPlans" },
        },
      ])
      assert.deepEqual(result, {
        totalCount: 1,
        plans: [
          {
            code: "plan-standard",
            name: "Standard",
            limitPer5h: 50,
            limitPerWeek: 500,
            limitPerMonth: 1500,
            concurrencyLimit: 3,
            isTeam: false,
            status: 1,
            createdAt: 1_700_000_000,
            models: [
              { code: "model-live-code", name: "Live Model", ratio: 1.25 },
            ],
            price: 12,
            originalPrice: 20,
          },
        ],
      })
    })

    test("preserves quota-window update and reset timestamps", async () => {
      controlHandler = async () => ({
        RetCode: 0,
        TotalCount: 1,
        UserPlans: [
          {
            Code: "personal-plan",
            IsTeam: false,
            Status: 1,
            UsagePer5hUpdatedAt: 1_700_000_001,
            UsagePerWeekUpdatedAt: 1_700_000_002,
            UsagePerMonthUpdatedAt: 1_700_000_003,
            UsagePer5hResetAt: 1_700_000_004,
            UsagePerWeekResetAt: 1_700_000_005,
            UsagePerMonthResetAt: 1_700_000_006,
          },
        ],
        InvalidUserPlans: [],
      })

      const result = await packages.listCompShareUserPlans({ isTeam: false })

      assert.deepEqual(
        result.userPlans.map(
          ({
            usagePer5hUpdatedAt,
            usagePerWeekUpdatedAt,
            usagePerMonthUpdatedAt,
            usagePer5hResetAt,
            usagePerWeekResetAt,
            usagePerMonthResetAt,
          }) => ({
            usagePer5hUpdatedAt,
            usagePerWeekUpdatedAt,
            usagePerMonthUpdatedAt,
            usagePer5hResetAt,
            usagePerWeekResetAt,
            usagePerMonthResetAt,
          })
        ),
        [
          {
            usagePer5hUpdatedAt: 1_700_000_001,
            usagePerWeekUpdatedAt: 1_700_000_002,
            usagePerMonthUpdatedAt: 1_700_000_003,
            usagePer5hResetAt: 1_700_000_004,
            usagePerWeekResetAt: 1_700_000_005,
            usagePerMonthResetAt: 1_700_000_006,
          },
        ]
      )
    })

    test("masks listed keys while scoping selection to the stored key code", async () => {
      const firstValue = "fixture-list-value-A1B2"
      const selectedValue = "fixture-list-value-C3D4"
      selectedKey = {
        keyCode: "key-selected",
        apiKey: selectedValue,
        userPlanCode: "user-plan-1",
        updatedAt: "fixture-time",
      }
      keyring.set("key-selected", {
        apiKey: selectedValue,
        userPlanCode: "user-plan-1",
      })
      controlHandler = async () => ({
        RetCode: 0,
        TotalCount: 2,
        Keys: [
          {
            Code: "key-other",
            Name: "Other",
            APIKey: firstValue,
            UserPlanCode: "user-plan-1",
            Status: 1,
          },
          {
            Code: "key-selected",
            Name: "Selected",
            UserPlanCode: "user-plan-1",
            Status: 1,
          },
        ],
      })

      const result = await packages.listCompShareKeys()

      assert.equal(result.selectedKeyCode, "key-selected")
      assert.deepEqual(
        result.keys.map(({ code, maskedApiKey, selected }) => ({
          code,
          maskedApiKey,
          selected,
        })),
        [
          {
            code: "key-other",
            maskedApiKey: "••••••••A1B2",
            selected: false,
          },
          {
            code: "key-selected",
            maskedApiKey: "••••••••C3D4",
            selected: true,
          },
        ]
      )
      assert.equal(JSON.stringify(result).includes(firstValue), false)
      assert.equal(JSON.stringify(result).includes(selectedValue), false)
      assert.deepEqual(storageEvents, ["upsert:key-other"])
      assert.deepEqual(controlRequests[0]?.params, {
        Action: "ListOpenAPIKeys",
      })
    })

    test("scopes listed keys to personal or team user plans", async () => {
      controlHandler = async ({ params }) => {
        switch (params.Action) {
          case "GetOpenAPIUserPlans":
            return {
              RetCode: 0,
              UserPlans: [
                {
                  Code: "personal-plan-active",
                  PlanCode: "cp-qefblm9qadmd5m0s",
                  IsTeam: false,
                  Status: 1,
                },
                {
                  Code: "team-plan-active",
                  PlanCode: "cp-us783egxorxbcoxd",
                  IsTeam: true,
                  Status: 1,
                },
              ],
              InvalidUserPlans: [
                { Code: "team-plan-inactive", IsTeam: true, Status: 0 },
                { Code: "personal-plan-inactive", IsTeam: false, Status: 0 },
              ],
            }
          case "ListOpenAPIKeys":
            return {
              RetCode: 0,
              TotalCount: 2,
              Keys: [
                {
                  Code: "team-key",
                  Name: "Team key",
                  UserPlanCode: "team-plan-active",
                  Status: 1,
                },
                {
                  Code: "personal-key",
                  Name: "Personal key",
                  UserPlanCode: "personal-plan-active",
                  Status: 1,
                },
              ],
            }
          default:
            throw new Error(`Unexpected action: ${String(params.Action)}`)
        }
      }

      const result = await packages.listCompShareKeys({ isTeam: true })

      assert.deepEqual(
        controlRequests.map(({ params }) => params),
        [
          { Action: "GetOpenAPIUserPlans", IsTeam: true },
          {
            Action: "ListOpenAPIKeys",
            UserPlanCodes: ["team-plan-active", "team-plan-inactive"],
          },
        ]
      )
      assert.deepEqual(
        result.keys.map(({ code, userPlanCode, userPlan }) => ({
          code,
          userPlanCode,
          planCode: userPlan?.planCode,
        })),
        [
          {
            code: "team-key",
            userPlanCode: "team-plan-active",
            planCode: "cp-us783egxorxbcoxd",
          },
        ]
      )
    })

    test("returns no keys without issuing an unscoped key request", async () => {
      controlHandler = async ({ params }) => {
        assert.deepEqual(params, {
          Action: "GetOpenAPIUserPlans",
          IsTeam: false,
        })
        return {
          RetCode: 0,
          UserPlans: [],
          InvalidUserPlans: [],
        }
      }

      const result = await packages.listCompShareKeys({ isTeam: false })

      assert.deepEqual(result.keys, [])
      assert.equal(result.totalCount, 0)
      assert.equal(controlRequests.length, 1)
    })

    test("persists a created one-time key before returning and invalidates entitlements", async () => {
      const oneTimeValue = "fixture-created-value-E5F6"
      controlHandler = async () => ({
        RetCode: 0,
        Key: {
          Code: "key-created",
          Name: "Created",
          APIKey: oneTimeValue,
          UserPlanCode: "user-plan-create",
          Status: 1,
        },
      })

      const result = await packages.createCompShareKey({
        userPlanCode: "user-plan-create",
        keyName: "Created",
      })

      assert.deepEqual(controlRequests[0]?.params, {
        Action: "CreateOpenAPIKey",
        UserPlanCode: "user-plan-create",
        KeyName: "Created",
      })
      assert.deepEqual(storageEvents, [
        "upsert:key-created",
        "select:key-created",
        "invalidate",
      ])
      assert.deepEqual(keyring.get("key-created"), {
        apiKey: oneTimeValue,
        userPlanCode: "user-plan-create",
      })
      assert.deepEqual(result.oneTimeKeys, [
        {
          apiKey: oneTimeValue,
          keyCode: "key-created",
          userPlanCode: "user-plan-create",
        },
      ])
      assert.deepEqual(result.selectedKey, {
        keyCode: "key-created",
        userPlanCode: "user-plan-create",
      })
      assert.equal(result.key?.maskedApiKey, "••••••••E5F6")
      assert.equal(invalidationCount, 1)
    })

    test("omits IsTeam from individual purchase requests", async () => {
      controlHandler = async () => ({
        RetCode: 0,
        SuccessCount: 1,
        UserPlan: {
          Code: "individual-user-plan",
          PlanCode: "individual-plan",
          PlanName: "Individual",
          Status: 1,
        },
      })

      await packages.buyCompSharePlan({
        planCode: "individual-plan",
        keyName: "Personal",
      })

      assert.deepEqual(controlRequests[0], {
        credentials: fixtureCredentials,
        params: {
          Action: "BuyOpenAPIPlan",
          PlanCode: "individual-plan",
          KeyName: "Personal",
          Count: 1,
        },
      })
      assert.equal("IsTeam" in controlRequests[0].params, false)
    })

    test("accepts a partial team purchase once, persists every returned key, and warns", async () => {
      const firstValue = "fixture-purchase-value-G7H8"
      const secondValue = "fixture-purchase-value-J9K0"
      controlHandler = async () => ({
        RetCode: 217000,
        Message: "Only two team seats were available.",
        RequestedCount: 3,
        SuccessCount: 2,
        UserPlans: [
          {
            Code: "team-user-plan-1",
            PlanCode: "team-plan",
            PlanName: "Team",
            IsTeam: 1,
            Status: 1,
            Keys: [
              {
                Code: "team-key-1",
                Name: "Seat 1",
                APIKey: firstValue,
                UserPlanCode: "team-user-plan-1",
                Status: 1,
              },
            ],
          },
          {
            Code: "team-user-plan-2",
            PlanCode: "team-plan",
            PlanName: "Team",
            IsTeam: 1,
            Status: 1,
            Keys: [
              {
                Code: "team-key-2",
                Name: "Seat 2",
                APIKey: secondValue,
                UserPlanCode: "team-user-plan-2",
                Status: 1,
              },
            ],
          },
        ],
      })

      const result = await packages.buyCompSharePlan({
        planCode: "team-plan",
        keyName: "Seat",
        isTeam: true,
        count: 3,
      })

      assert.equal(
        controlRequests.length,
        1,
        "must not duplicate the billing call"
      )
      assert.deepEqual(controlRequests[0], {
        credentials: fixtureCredentials,
        params: {
          Action: "BuyOpenAPIPlan",
          PlanCode: "team-plan",
          KeyName: "Seat",
          IsTeam: true,
          Count: 3,
        },
      })
      assert.deepEqual(storageEvents, [
        "upsert:team-key-1",
        "upsert:team-key-2",
        "select:team-key-1",
        "invalidate",
      ])
      assert.deepEqual(result.oneTimeKeys, [
        {
          apiKey: firstValue,
          keyCode: "team-key-1",
          userPlanCode: "team-user-plan-1",
        },
        {
          apiKey: secondValue,
          keyCode: "team-key-2",
          userPlanCode: "team-user-plan-2",
        },
      ])
      assert.equal(result.requestedCount, 3)
      assert.equal(result.successCount, 2)
      assert.equal(result.partial, true)
      assert.deepEqual(result.warning, {
        retCode: 217000,
        message: "Only two team seats were available.",
      })
      assert.deepEqual(
        result.userPlans.map((plan) =>
          plan.keys.map((key) => ({ code: key.code, selected: key.selected }))
        ),
        [
          [{ code: "team-key-1", selected: true }],
          [{ code: "team-key-2", selected: false }],
        ]
      )
      assert.equal(invalidationCount, 1)
    })

    test("invalidates entitlements exactly once after every package mutation", async () => {
      controlHandler = async ({ params }) => {
        switch (params.Action) {
          case "UpdateOpenAPIKey":
            return {
              RetCode: 0,
              Key: {
                Code: params.KeyCode,
                Name: params.KeyName,
                UserPlanCode: "user-plan-mutations",
              },
            }
          case "DeleteOpenAPIKey":
            return { RetCode: 0 }
          case "GetOpenAPIUserPlanByKey":
            return {
              RetCode: 0,
              Key: {
                Code: params.KeyCode,
                Name: "Selected",
                APIKey: "fixture-selected-value-L1M2",
                UserPlanCode: "user-plan-mutations",
              },
              UserPlan: {
                Code: "user-plan-mutations",
                PlanCode: "plan-next",
              },
            }
          case "ListOpenAPIPlans":
            return {
              RetCode: 0,
              Plans: [
                {
                  Code: "plan-current",
                  Name: "Current",
                  Price: 189.05,
                  OriginalPrice: 199,
                  Status: 1,
                },
              ],
            }
          case "GetBalance":
            return {
              RetCode: 0,
              AccountInfo: {
                Amount: "0.00",
                AmountFree: "3735691.07",
                AmountFreeze: "0.00",
                AmountCredit: "0.00",
                AmountAvailable: "3735691.07",
              },
            }
          case "UpgradeOpenAPIUserPlan":
            return {
              RetCode: 0,
              UserPlan: {
                Code: params.UserPlanCode,
                PlanCode: params.NewPlanCode,
              },
            }
          case "CreateOpenAPIUserPlanRecharge":
            return { RetCode: 0, OrderNo: "fixture-order" }
          case "UpdateOpenAPIUserPlanDisplayName":
            return {
              RetCode: 0,
              UserPlanCode: params.UserPlanCode,
              DisplayName: params.DisplayName,
            }
          case "GetOpenAPIUserPlans":
            return {
              RetCode: 0,
              UserPlans: [
                {
                  Code: "user-plan-mutations",
                  PlanCode: "plan-current",
                  PlanName: "Current",
                  Status: 1,
                  ExpireAt: 1_800_000_000,
                },
                {
                  Code: "user-plan-delete",
                  Keys: [{ Code: "delete-key-a" }, { Code: "delete-key-b" }],
                },
              ],
            }
          case "DeleteOpenAPIUserPlan":
            return { RetCode: 0 }
          default:
            throw new Error(`Unexpected action: ${String(params.Action)}`)
        }
      }

      const assertOneMoreInvalidation = (before: number) => {
        assert.equal(invalidationCount, before + 1)
      }

      let before = invalidationCount
      await packages.renameCompShareKey("key-mutate", "Renamed")
      assertOneMoreInvalidation(before)

      before = invalidationCount
      await packages.deleteCompShareKey("key-mutate")
      assertOneMoreInvalidation(before)

      before = invalidationCount
      await packages.selectCompShareKey("key-selected")
      assertOneMoreInvalidation(before)

      before = invalidationCount
      packages.clearCompShareSelectedKey()
      assertOneMoreInvalidation(before)

      before = invalidationCount
      await packages.upgradeCompShareUserPlan({
        userPlanCode: "user-plan-mutations",
        newPlanCode: "plan-next",
      })
      assertOneMoreInvalidation(before)

      before = invalidationCount
      await packages.rechargeCompShareUserPlan({
        userPlanCode: "user-plan-mutations",
        expectedPrice: 189.05,
      })
      assertOneMoreInvalidation(before)

      before = invalidationCount
      await packages.renameCompShareUserPlan(
        "user-plan-mutations",
        "Renamed plan"
      )
      assertOneMoreInvalidation(before)

      selectedKey = {
        keyCode: "selected-outside-list",
        apiKey: "fixture-selected-value-N3P4",
        userPlanCode: "user-plan-delete",
        updatedAt: "fixture-time",
      }
      before = invalidationCount
      await packages.deleteCompShareUserPlan("user-plan-delete")
      assertOneMoreInvalidation(before)

      assert.equal(invalidationCount, 8)
      assert.deepEqual(
        controlRequests.map(({ params }) => params.Action),
        [
          "UpdateOpenAPIKey",
          "DeleteOpenAPIKey",
          "GetOpenAPIUserPlanByKey",
          "UpgradeOpenAPIUserPlan",
          "ListOpenAPIPlans",
          "GetOpenAPIUserPlans",
          "GetBalance",
          "CreateOpenAPIUserPlanRecharge",
          "UpdateOpenAPIUserPlanDisplayName",
          "GetOpenAPIUserPlans",
          "DeleteOpenAPIUserPlan",
        ]
      )
      assert.ok(storageEvents.includes("remove:delete-key-a"))
      assert.ok(storageEvents.includes("remove:delete-key-b"))
      assert.equal(selectedKey, null)
    })

    test("rechecks renewal price and balance before creating a billing order", async () => {
      controlHandler = async ({ params }) => {
        switch (params.Action) {
          case "ListOpenAPIPlans":
            return {
              RetCode: 0,
              Plans: [
                {
                  Code: "plan-renewal",
                  Name: "Renewal",
                  Price: 199,
                  OriginalPrice: 199,
                  Status: 1,
                },
              ],
            }
          case "GetOpenAPIUserPlans":
            return {
              RetCode: 0,
              UserPlans: [
                {
                  Code: "user-plan-renewal",
                  PlanCode: "plan-renewal",
                  PlanName: "Renewal",
                  Status: 1,
                },
              ],
            }
          case "GetBalance":
            return {
              RetCode: 0,
              AccountInfo: {
                AmountAvailable: "500.00",
              },
            }
          default:
            throw new Error(`Unexpected action: ${String(params.Action)}`)
        }
      }

      await assert.rejects(
        () =>
          packages.rechargeCompShareUserPlan({
            userPlanCode: "user-plan-renewal",
            expectedPrice: 189.05,
          }),
        (error: unknown) => {
          assert.ok(error instanceof packages.CompSharePackageError)
          assert.equal(error.code, "COMPSHARE_RECHARGE_PRICE_CHANGED")
          assert.equal(error.status, 409)
          return true
        }
      )
      assert.equal(
        controlRequests.some(
          ({ params }) => params.Action === "CreateOpenAPIUserPlanRecharge"
        ),
        false
      )
    })

    test("does not automatically retry a failed control-plane request", async () => {
      controlHandler = async () => {
        throw new Error("fixture transport failure")
      }

      await assert.rejects(
        () => packages.listCompSharePlans(),
        (error: unknown) => {
          assert.ok(error instanceof packages.CompSharePackageError)
          assert.equal(error.code, "COMPSHARE_REQUEST_FAILED")
          return true
        }
      )
      assert.equal(controlRequests.length, 1)
    })
  })
} else {
  test("passes the isolated CompShare package contract suite", () => {
    const result = spawnSync(
      process.execPath,
      ["test", fileURLToPath(import.meta.url)],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          COMPSHARE_PACKAGES_ISOLATED: "1",
        },
      }
    )

    assert.equal(result.status, 0, result.stderr || result.stdout)
  })
}
