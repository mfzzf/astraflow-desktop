// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  getHoursUntilCompShareQuotaReset,
  summarizeCompShareQuota,
} from "@/lib/compshare/quota"
import type { CompShareUserPlan } from "@/lib/compshare/packages"

function plan(overrides: Partial<CompShareUserPlan> = {}): CompShareUserPlan {
  return {
    code: "personal-plan",
    planCode: "plan-basic",
    planName: "Basic",
    displayName: "Basic",
    limitPer5h: 1_200,
    limitPerWeek: 3_000,
    limitPerMonth: 7_600,
    concurrencyLimit: 1,
    usagePer5h: 55,
    usagePerWeek: 723,
    usagePerMonth: 729,
    usagePer5hUpdatedAt: "2026-07-22T02:00:00.000Z",
    usagePerWeekUpdatedAt: "2026-07-19T16:00:00.000Z",
    usagePerMonthUpdatedAt: "2026-07-18T13:41:58.000Z",
    usagePer5hResetAt: null,
    usagePerWeekResetAt: null,
    usagePerMonthResetAt: null,
    isTeam: false,
    status: 1,
    createdAt: "2026-07-18T13:41:58.000Z",
    expireAt: "2027-07-18T13:41:58.000Z",
    keys: [],
    ...overrides,
  }
}

describe("CompShare quota windows", () => {
  test("reports usage, limits, and the next reset for all three windows", () => {
    const quota = summarizeCompShareQuota(
      [plan()],
      Date.parse("2026-07-22T06:00:00.000Z")
    )

    expect(quota).toEqual({
      limit: 7_600,
      remaining: 6_871,
      windows: {
        fiveHour: {
          used: 55,
          limit: 1_200,
          resetAt: "2026-07-22T07:00:00.000Z",
        },
        weekly: {
          used: 723,
          limit: 3_000,
          resetAt: "2026-07-26T16:00:00.000Z",
        },
        monthly: {
          used: 729,
          limit: 7_600,
          resetAt: "2026-08-18T13:41:58.000Z",
        },
      },
    })
  })

  test("aggregates active plans and uses the earliest applicable reset", () => {
    const quota = summarizeCompShareQuota(
      [
        plan(),
        plan({
          code: "second-plan",
          limitPer5h: 100,
          limitPerWeek: 200,
          limitPerMonth: 300,
          usagePer5h: 10,
          usagePerWeek: 20,
          usagePerMonth: 30,
          usagePer5hResetAt: "2026-07-22T06:30:00.000Z",
          usagePerWeekResetAt: "2026-07-25T16:00:00.000Z",
          usagePerMonthResetAt: "2026-08-01T16:00:00.000Z",
        }),
        plan({ code: "deleted-plan", status: 0, usagePerMonth: 9_999 }),
      ],
      Date.parse("2026-07-22T06:00:00.000Z")
    )

    expect(quota?.windows.fiveHour).toEqual({
      used: 65,
      limit: 1_300,
      resetAt: "2026-07-22T06:30:00.000Z",
    })
    expect(quota?.windows.weekly.resetAt).toBe("2026-07-25T16:00:00.000Z")
    expect(quota?.windows.monthly).toEqual({
      used: 759,
      limit: 7_900,
      resetAt: "2026-08-01T16:00:00.000Z",
    })
    expect(quota?.remaining).toBe(7_141)
  })

  test("rounds reset countdowns up to the next whole hour", () => {
    const now = Date.parse("2026-07-22T06:00:00.000Z")

    expect(
      getHoursUntilCompShareQuotaReset("2026-07-22T07:00:01.000Z", now)
    ).toBe(2)
    expect(
      getHoursUntilCompShareQuotaReset("2026-07-22T07:00:00.000Z", now)
    ).toBe(1)
    expect(
      getHoursUntilCompShareQuotaReset("2026-07-22T05:00:00.000Z", now)
    ).toBe(0)
  })
})
