import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { resolveCompSharePlanLabel } from "@/lib/compshare/plan-display"

const catalogPlans = [
  { code: "basic", name: "Basic 基础版" },
  { code: "pro", name: "Pro 增强版" },
]

describe("CompShare upgraded plan labels", () => {
  test("replaces the stale previous-plan default name after an upgrade", () => {
    assert.equal(
      resolveCompSharePlanLabel(
        {
          code: "user-plan",
          planCode: "pro",
          planName: "Pro 增强版",
          displayName: "Basic 基础版",
        },
        catalogPlans
      ),
      "Pro 增强版"
    )
  })

  test("preserves a genuinely custom package name", () => {
    assert.equal(
      resolveCompSharePlanLabel(
        {
          code: "user-plan",
          planCode: "pro",
          planName: "Pro 增强版",
          displayName: "个人主套餐",
        },
        catalogPlans
      ),
      "个人主套餐"
    )
  })
})
