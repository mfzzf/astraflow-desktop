export type CodeBoxSandboxProfile = {
  tier: "basic" | "pro" | "legacy" | "standard"
  label: string
  cpuCount: number
  memoryMB: number
  templateId: string
}

export const COMPSHARE_CODEBOX_SIZES = ["2c4g", "8c8g"] as const
export type CompShareCodeBoxSize = (typeof COMPSHARE_CODEBOX_SIZES)[number]

export type CompShareCodeBoxAccess = {
  allowedSizes: readonly CompShareCodeBoxSize[]
  defaultSize: CompShareCodeBoxSize
}


export type CompShareCodeBoxPlan = {
  code: string
}

export const COMPSHARE_BASIC_CODEBOX_PROFILE = Object.freeze({
  tier: "basic",
  label: "Basic",
  cpuCount: 2,
  memoryMB: 4096,
  templateId: "i21vxo1qnl9gmk8nqakj",
} satisfies CodeBoxSandboxProfile)

export const COMPSHARE_PRO_CODEBOX_PROFILE = Object.freeze({
  tier: "pro",
  label: "Pro+",
  cpuCount: 8,
  memoryMB: 8192,
  templateId: "79a9c0uxquw17scu698u",
} satisfies CodeBoxSandboxProfile)

const COMPSHARE_BASIC_PLAN_CODE = "cp-qefblm9qadmd5m0s"
const COMPSHARE_PRO_PLAN_CODES: Record<string, true> = {
  "cp-us783egxorxbcoxd": true,
  "cp-umtvqmhllyfdnhgf": true,
  "cp-ed7xwzitoiyd4nuk": true,
}
const COMPSHARE_BASIC_CODEBOX_ACCESS = Object.freeze({
  allowedSizes: Object.freeze(["2c4g"]),
  defaultSize: "2c4g",
} satisfies CompShareCodeBoxAccess)
const COMPSHARE_PRO_CODEBOX_ACCESS = Object.freeze({
  allowedSizes: Object.freeze(["2c4g", "8c8g"]),
  defaultSize: "8c8g",
} satisfies CompShareCodeBoxAccess)
const COMPSHARE_CODEBOX_PROFILES: Record<
  CompShareCodeBoxSize,
  CodeBoxSandboxProfile
> = {
  "2c4g": COMPSHARE_BASIC_CODEBOX_PROFILE,
  "8c8g": COMPSHARE_PRO_CODEBOX_PROFILE,
}

const LEGACY_COMPSHARE_BASIC_CODEBOX_PROFILE = Object.freeze({
  tier: "legacy",
  label: "Legacy Basic",
  cpuCount: 2,
  memoryMB: 4096,
  templateId: "mi9v6px083eqo0yl09fr",
} satisfies CodeBoxSandboxProfile)

const LEGACY_COMPSHARE_CODEBOX_PROFILE = Object.freeze({
  tier: "legacy",
  label: "Legacy",
  cpuCount: 4,
  memoryMB: 8192,
  templateId: "e7e2rzpb46lwm1lv57y4",
} satisfies CodeBoxSandboxProfile)

const STANDARD_CODEBOX_PROFILE = Object.freeze({
  tier: "standard",
  label: "Standard",
  cpuCount: 8,
  memoryMB: 8192,
  templateId: "yeyb5hbs2kweus6ku07l",
} satisfies CodeBoxSandboxProfile)

export function getCompShareCodeBoxAccess(
  planCode: string | null | undefined
): CompShareCodeBoxAccess | null {
  const normalizedPlanCode = planCode?.trim()
  if (!normalizedPlanCode) return null

  if (normalizedPlanCode === COMPSHARE_BASIC_PLAN_CODE) {
    return COMPSHARE_BASIC_CODEBOX_ACCESS
  }

  return COMPSHARE_PRO_PLAN_CODES[normalizedPlanCode]
    ? COMPSHARE_PRO_CODEBOX_ACCESS
    : null
}

export function resolveCompShareCodeBoxProfile(
  plan: CompShareCodeBoxPlan,
  requestedSize?: CompShareCodeBoxSize
) {
  const access = getCompShareCodeBoxAccess(plan.code)
  if (!access) {
    throw new Error(
      "The selected CompShare package does not include a CodeBox sandbox."
    )
  }

  const size = requestedSize ?? access.defaultSize
  if (!access.allowedSizes.includes(size)) {
    throw new Error(
      "The selected CompShare package does not include the 8C8G CodeBox configuration."
    )
  }

  return COMPSHARE_CODEBOX_PROFILES[size]
}

const CODEBOX_PROFILES = [
  COMPSHARE_BASIC_CODEBOX_PROFILE,
  COMPSHARE_PRO_CODEBOX_PROFILE,
  LEGACY_COMPSHARE_BASIC_CODEBOX_PROFILE,
  LEGACY_COMPSHARE_CODEBOX_PROFILE,
  STANDARD_CODEBOX_PROFILE,
] as const


export function getCodeBoxSandboxProfile(templateId: string) {
  return (
    CODEBOX_PROFILES.find((profile) => profile.templateId === templateId) ?? null
  )
}

export function isKnownCompShareCodeBoxTemplate(templateId: string) {
  return getCodeBoxSandboxProfile(templateId) !== null
}
