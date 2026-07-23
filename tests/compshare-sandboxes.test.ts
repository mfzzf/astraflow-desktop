import assert from "node:assert/strict"
// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { beforeEach, describe, mock, test } from "bun:test"

const credentials = {
  publicKey: "fixture-public-key",
  privateKey: "fixture-private-key",
}
const requests: Array<{
  credentials: typeof credentials
  params: Record<string, unknown>
}> = []
let deleteMissing = false

class TestCompShareApiError extends Error {
  readonly retCode?: number
  readonly status: number

  constructor(
    message: string,
    options?: { retCode?: number; status?: number }
  ) {
    super(message)
    this.name = "CompShareApiError"
    this.retCode = options?.retCode
    this.status = options?.status ?? 502
  }
}

mock.module("server-only", () => ({}))
mock.module("@/lib/studio-db", () => ({
  deleteCodeBoxSandboxRecord: () => undefined,
  getCodeBoxGithubTokens: () => null,
  getCodeBoxSandboxRecord: () => null,
  getCodeBoxSandboxEnvdAccessToken: () => null,
  getCompShareControlCredentials: () => credentials,
  getStudioModelverseApiKey: () => null,
  getStudioOAuthTokens: () => null,
  listCodeBoxSandboxRecords: () => [],
  touchCodeBoxSandboxRecord: () => null,
  updateCodeBoxSandboxNameRecord: () => null,
  updateCodeBoxSandboxEnvdAccessTokenRecord: () => false,
  upsertCodeBoxSandboxRecord: () => null,
}))
mock.module("@/lib/compshare/account", () => ({
  getCompShareAccount: async () => ({
    nickname: "Sandbox operator",
    companyId: 66_391_350,
    level: 2,
  }),
}))
mock.module("@/lib/compshare/control-plane", () => ({
  CompShareApiError: TestCompShareApiError,
  callCompShareAction: async (input: (typeof requests)[number]) => {
    requests.push(input)

    switch (input.params.Action) {
      case "CreateSandbox":
        return {
          SandboxId: "sandbox-created",
          Status: "Created",
          EnvdAccessToken: "envd-token-created",
        }
      case "SetSandboxTimeout":
        return { SandboxId: input.params.SandboxId }
      case "DeleteSandbox":
        if (deleteMissing) {
          throw new TestCompShareApiError("sandbox does not exist", {
            retCode: 8039,
            status: 400,
          })
        }
        return { SandboxId: input.params.SandboxId, Status: "Deleted" }
      case "DescribeSandbox": {
        const offset = Number(input.params.Offset)
        const allRecords = Array.from({ length: 101 }, (_, index) => ({
          SandboxId: `sandbox-${index}`,
          TemplateId: "astraflow-code",
          EnvdAccessToken: `envd-token-${index}`,
          Status: "Created",
          UserEmail: index === 0 ? "owner@example.com" : "",
          CreateTime: 1_784_686_233 + index,
          UpdateTime: 1_784_686_300 + index,
          EndAt: 1_784_690_000 + index,
        }))
        const requestedSandboxId = String(input.params.SandboxId || "")
        const selectedRecords = requestedSandboxId
          ? allRecords.filter(
              (record) => record.SandboxId === requestedSandboxId
            )
          : allRecords
        return {
          TotalCount: selectedRecords.length,
          SandboxSet: selectedRecords.slice(offset, offset + 100),
        }
      }
      default:
        throw new Error(`Unexpected action: ${String(input.params.Action)}`)
    }
  },
}))

const {
  createCompShareSandbox,
  deleteCompShareSandbox,
  describeCompShareSandbox,
  describeCompShareSandboxes,
  setCompShareSandboxTimeout,
} = await import("@/lib/compshare/sandboxes")

beforeEach(() => {
  requests.length = 0
  deleteMissing = false
})

describe("CompShare sandbox lifecycle contract", () => {
  test("creates a sandbox in the signed-in account organization", async () => {
    const result = await createCompShareSandbox({
      templateId: " astraflow-code ",
      userEmail: " owner@example.com ",
    })

    assert.deepEqual(result, {
      sandboxId: "sandbox-created",
      status: "Created",
      envdAccessToken: "envd-token-created",
    })
    assert.deepEqual(requests, [
      {
        credentials,
        params: {
          Action: "CreateSandbox",
          top_organization_id: 66_391_350,
          TemplateId: "astraflow-code",
          user_email: "owner@example.com",
        },
      },
    ])
  })

  test("deletes a sandbox and treats an already-removed record as idempotent", async () => {
    assert.deepEqual(await deleteCompShareSandbox(" sandbox-created "), {
      deleted: true,
      sandboxId: "sandbox-created",
    })

    deleteMissing = true
    assert.deepEqual(await deleteCompShareSandbox("sandbox-missing"), {
      deleted: false,
      sandboxId: "sandbox-missing",
    })
    assert.deepEqual(
      requests.map((request) => request.params),
      [
        {
          Action: "DeleteSandbox",
          top_organization_id: 66_391_350,
          SandboxId: "sandbox-created",
        },
        {
          Action: "DeleteSandbox",
          top_organization_id: 66_391_350,
          SandboxId: "sandbox-missing",
        },
      ]
    )
  })

  test("paginates DescribeSandbox and maps documented record fields", async () => {
    const result = await describeCompShareSandboxes()

    assert.equal(result.length, 101)
    assert.deepEqual(result[0], {
      sandboxId: "sandbox-0",
      templateId: "astraflow-code",
      status: "Created",
      envdAccessToken: "envd-token-0",
      userEmail: "owner@example.com",
      createTime: 1_784_686_233,
      updateTime: 1_784_686_300,
      endAt: 1_784_690_000,
    })
    assert.deepEqual(
      requests.map((request) => request.params),
      [
        {
          Action: "DescribeSandbox",
          top_organization_id: 66_391_350,
          Offset: 0,
          Limit: 100,
        },
        {
          Action: "DescribeSandbox",
          top_organization_id: 66_391_350,
          Offset: 100,
          Limit: 100,
        },
      ]
    )
  })

  test("queries one sandbox token and sets its timeout through the control plane", async () => {
    const sandbox = await describeCompShareSandbox(" sandbox-2 ")
    assert.equal(sandbox?.envdAccessToken, "envd-token-2")

    assert.deepEqual(
      await setCompShareSandboxTimeout(" sandbox-2 ", 7_200),
      {
        sandboxId: "sandbox-2",
        timeoutSeconds: 7_200,
      }
    )
    assert.deepEqual(
      requests.map((request) => request.params),
      [
        {
          Action: "DescribeSandbox",
          top_organization_id: 66_391_350,
          SandboxId: "sandbox-2",
          Offset: 0,
          Limit: 100,
        },
        {
          Action: "SetSandboxTimeout",
          top_organization_id: 66_391_350,
          SandboxId: "sandbox-2",
          TimeoutSeconds: 7_200,
        },
      ]
    )
  })
})
