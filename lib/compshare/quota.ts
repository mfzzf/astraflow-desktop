import type { CompShareUserPlan } from "@/lib/compshare/packages"

const HOUR_MS = 60 * 60 * 1_000
const DAY_MS = 24 * HOUR_MS
const CHINA_OFFSET_MS = 8 * HOUR_MS

type QuotaWindow = {
  used: number
  limit: number
  resetAt: string | null
}

export type CompShareQuotaSummary = {
  limit: number
  remaining: number
  windows: {
    fiveHour: QuotaWindow
    weekly: QuotaWindow
    monthly: QuotaWindow
  }
}

function timestampMs(value: string | number | null) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null
    return value > 10_000_000_000 ? value : value * 1_000
  }

  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function getHoursUntilCompShareQuotaReset(
  value: string | number | null,
  nowMs = Date.now()
) {
  const resetAt = timestampMs(value)
  if (resetAt === null) return null
  return Math.max(0, Math.ceil((resetAt - nowMs) / HOUR_MS))
}

function toIsoTimestamp(value: number | null) {
  return value === null ? null : new Date(value).toISOString()
}

function nextFiveHourBoundary(nowMs: number) {
  const shiftedNow = nowMs + CHINA_OFFSET_MS
  const dayStart = Math.floor(shiftedNow / DAY_MS) * DAY_MS
  const elapsed = shiftedNow - dayStart
  const nextBoundary = Math.min(
    (Math.floor(elapsed / (5 * HOUR_MS)) + 1) * 5 * HOUR_MS,
    DAY_MS
  )
  return dayStart + nextBoundary - CHINA_OFFSET_MS
}

function nextWeeklyBoundary(nowMs: number) {
  const shiftedNow = new Date(nowMs + CHINA_OFFSET_MS)
  const dayStart = Date.UTC(
    shiftedNow.getUTCFullYear(),
    shiftedNow.getUTCMonth(),
    shiftedNow.getUTCDate()
  )
  const daysSinceMonday = (shiftedNow.getUTCDay() + 6) % 7
  return dayStart + (7 - daysSinceMonday) * DAY_MS - CHINA_OFFSET_MS
}

function addChinaCalendarMonth(timestamp: number) {
  const shifted = new Date(timestamp + CHINA_OFFSET_MS)
  const year = shifted.getUTCFullYear()
  const month = shifted.getUTCMonth()
  const day = shifted.getUTCDate()
  const targetMonthStart = Date.UTC(year, month + 1, 1)
  const targetMonth = new Date(targetMonthStart)
  const lastDay = new Date(
    Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)
  ).getUTCDate()

  return (
    Date.UTC(
      targetMonth.getUTCFullYear(),
      targetMonth.getUTCMonth(),
      Math.min(day, lastDay),
      shifted.getUTCHours(),
      shifted.getUTCMinutes(),
      shifted.getUTCSeconds(),
      shifted.getUTCMilliseconds()
    ) - CHINA_OFFSET_MS
  )
}

function nextMonthlyBoundary(plan: CompShareUserPlan, nowMs: number) {
  let candidate = timestampMs(plan.usagePerMonthResetAt)
  if (candidate !== null && candidate > nowMs) return candidate

  candidate = timestampMs(plan.usagePerMonthUpdatedAt)
  if (candidate === null) candidate = timestampMs(plan.createdAt)
  if (candidate === null) return addChinaCalendarMonth(nowMs)

  do {
    candidate = addChinaCalendarMonth(candidate)
  } while (candidate <= nowMs)

  return candidate
}

function nextDurationBoundary(
  directResetAt: string | number | null,
  updatedAt: string | number | null,
  durationMs: number,
  nowMs: number,
  fallback: (nowMs: number) => number
) {
  const direct = timestampMs(directResetAt)
  if (direct !== null && direct > nowMs) return direct

  let candidate = timestampMs(updatedAt)
  if (candidate === null) return fallback(nowMs)

  do {
    candidate += durationMs
  } while (candidate <= nowMs)

  return candidate
}

function earliest(values: number[]) {
  return values.length > 0 ? Math.min(...values) : null
}

export function summarizeCompShareQuota(
  plans: CompShareUserPlan[],
  nowMs = Date.now()
): CompShareQuotaSummary | null {
  const activePlans = plans.filter((plan) => plan.status === 1)
  if (activePlans.length === 0) return null

  const summarizeWindow = (
    usage: (plan: CompShareUserPlan) => number,
    limit: (plan: CompShareUserPlan) => number,
    reset: (plan: CompShareUserPlan) => number
  ): QuotaWindow => ({
    used: activePlans.reduce(
      (total, plan) => total + Math.max(0, usage(plan)),
      0
    ),
    limit: activePlans.reduce(
      (total, plan) => total + Math.max(0, limit(plan)),
      0
    ),
    resetAt: toIsoTimestamp(earliest(activePlans.map(reset))),
  })

  const fiveHour = summarizeWindow(
    (plan) => plan.usagePer5h,
    (plan) => plan.limitPer5h,
    (plan) =>
      nextDurationBoundary(
        plan.usagePer5hResetAt,
        plan.usagePer5hUpdatedAt,
        5 * HOUR_MS,
        nowMs,
        nextFiveHourBoundary
      )
  )
  const weekly = summarizeWindow(
    (plan) => plan.usagePerWeek,
    (plan) => plan.limitPerWeek,
    (plan) =>
      nextDurationBoundary(
        plan.usagePerWeekResetAt,
        plan.usagePerWeekUpdatedAt,
        7 * DAY_MS,
        nowMs,
        nextWeeklyBoundary
      )
  )
  const monthly = summarizeWindow(
    (plan) => plan.usagePerMonth,
    (plan) => plan.limitPerMonth,
    (plan) => nextMonthlyBoundary(plan, nowMs)
  )

  return {
    limit: monthly.limit,
    remaining: Math.max(0, monthly.limit - monthly.used),
    windows: { fiveHour, weekly, monthly },
  }
}
