import type {
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
} from "@agentclientprotocol/sdk"

export const OPENCODE_MODEL_CONFIG_ID = "model"
export const OPENCODE_EFFORT_CONFIG_ID = "effort"
export const OPENCODE_MODE_CONFIG_ID = "mode"
export const OPENCODE_BUILD_MODE = "build"
export const OPENCODE_PLAN_MODE = "plan"

export type OpenCodeSelectOption = SessionConfigSelectOption & {
  groupId?: string
  groupName?: string
}

function isSelectGroup(
  value: SessionConfigSelectOption | SessionConfigSelectGroup
): value is SessionConfigSelectGroup {
  return "group" in value
}

export function findOpenCodeConfigOption(
  options: readonly SessionConfigOption[],
  id: string
) {
  return options.find((option) => option.id === id) ?? null
}

export function getOpenCodeSelectOptions(
  option: SessionConfigOption | null | undefined
): OpenCodeSelectOption[] {
  if (!option || option.type !== "select") {
    return []
  }

  return option.options.flatMap((candidate) => {
    if (!isSelectGroup(candidate)) {
      return [candidate]
    }

    return candidate.options.map((child) => ({
      ...child,
      groupId: candidate.group,
      groupName: candidate.name,
    }))
  })
}

export function getOpenCodePlanMode(
  options: readonly SessionConfigOption[]
) {
  const modeOption = findOpenCodeConfigOption(
    options,
    OPENCODE_MODE_CONFIG_ID
  )
  const availableModes = getOpenCodeSelectOptions(modeOption)
  const currentMode =
    modeOption?.type === "select" ? modeOption.currentValue : null

  return {
    active: currentMode === OPENCODE_PLAN_MODE,
    available: availableModes.some(
      (option) => option.value === OPENCODE_PLAN_MODE
    ),
    currentMode,
    defaultMode:
      availableModes.find((option) => option.value === OPENCODE_BUILD_MODE)
        ?.value ??
      availableModes.find((option) => option.value !== OPENCODE_PLAN_MODE)
        ?.value ??
      null,
  }
}
