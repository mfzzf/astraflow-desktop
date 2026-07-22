import assert from "node:assert/strict"
// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { beforeEach, describe, mock, test } from "bun:test"

const requests: Array<{
  credentials: { publicKey: string; privateKey: string }
  params: Record<string, unknown>
}> = []

mock.module("server-only", () => ({}))
mock.module("@/lib/compshare/control-plane", () => ({
  callCompShareAction: async (input: (typeof requests)[number]) => {
    requests.push(input)
    return {
      RetCode: 0,
      Message: "success",
      Account: {
        Nickname: "CC仔",
        ReferralCode: "Csp7r9VjkhGFRR8W8KjbAj",
        CompanyId: 66_391_350,
        Level: 2,
        ReferralTotal: 1,
      },
    }
  },
}))

const { getCompShareAccount } = await import("@/lib/compshare/account")

beforeEach(() => {
  requests.length = 0
})

describe("CompShare account contract", () => {
  test("uses GetCompShareAccount and maps the nested account payload", async () => {
    const credentials = {
      publicKey: "fixture-public-key",
      privateKey: "fixture-private-key",
    }

    const account = await getCompShareAccount(credentials)

    assert.deepEqual(requests, [
      {
        credentials,
        params: { Action: "GetCompShareAccount" },
      },
    ])
    assert.deepEqual(account, {
      nickname: "CC仔",
      companyId: 66_391_350,
      level: 2,
    })
  })
})
