import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { resolveCompShareApiKeyOptions } from "@/components/codebox/api-key-options"
import type { CompShareApiKeysResponse } from "@/components/codebox/types"

function key(
  code: string,
  options: {
    name?: string
    maskedApiKey?: string | null
    status?: number
    planCode?: string
  } = {}
) {
  return {
    code,
    name: options.name ?? code,
    maskedApiKey: options.maskedApiKey ?? null,
    status: options.status ?? 1,
    userPlanCode: `${code}-plan`,
    userPlan: {
      planCode: options.planCode ?? "cp-qefblm9qadmd5m0s",
    },
    selected: false,
  }
}

describe("CodeBox CompShare API key options", () => {
  test("combines ListOpenAPIKeys results and exposes the selected masked key", () => {
    const personal: CompShareApiKeysResponse = {
      totalCount: 1,
      selectedKeyCode: null,
      keys: [
        key("personal-key", {
          name: "Personal coding key",
          maskedApiKey: "sk-personal-****",
        }),
      ],
    }
    const team: CompShareApiKeysResponse = {
      totalCount: 2,
      selectedKeyCode: "team-key",
      keys: [
        key("personal-key", {
          name: "Personal coding key",
          maskedApiKey: "sk-personal-****",
        }),
        key("team-key", {
          name: "Team coding key",
          maskedApiKey: "sk-team-****",
        }),
      ],
    }

    const result = resolveCompShareApiKeyOptions([personal, team])

    assert.deepEqual(result.items, [
      {
        id: "personal-key",
        name: "Personal coding key · sk-personal-****",
        planCode: "cp-qefblm9qadmd5m0s",
      },
      {
        id: "team-key",
        name: "Team coding key · sk-team-****",
        planCode: "cp-qefblm9qadmd5m0s",
      },
    ])
    assert.deepEqual(result.selected, {
      id: "team-key",
      name: "Team coding key · sk-team-****",
      planCode: "cp-qefblm9qadmd5m0s",
    })
  })

  test("does not offer inactive keys for sandbox creation", () => {
    const response: CompShareApiKeysResponse = {
      totalCount: 1,
      selectedKeyCode: "inactive-key",
      keys: [key("inactive-key", { status: 0 })],
    }

    assert.deepEqual(resolveCompShareApiKeyOptions([response]), {
      items: [],
      selected: null,
    })
  })
})
