import type {
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
  SessionModeState,
} from "@agentclientprotocol/sdk"

export const CLAUDE_MODE_CONFIG_ID = "mode"
export const CLAUDE_MODEL_CONFIG_ID = "model"
export const CLAUDE_EFFORT_CONFIG_ID = "effort"
export const CLAUDE_AGENT_CONFIG_ID = "agent"
export const CLAUDE_FAST_MODE_CONFIG_ID = "fast"

export const CLAUDE_DEFAULT_MODE = "default"
export const CLAUDE_PLAN_MODE = "plan"

const CLAUDE_MODE_CYCLE = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
  "auto",
] as const

export type ClaudeSelectOption = SessionConfigSelectOption & {
  groupId?: string
  groupName?: string
}

function isSelectGroup(
  value: SessionConfigSelectOption | SessionConfigSelectGroup
): value is SessionConfigSelectGroup {
  return "group" in value
}

export function findClaudeConfigOption(
  options: readonly SessionConfigOption[],
  id: string
) {
  return options.find((option) => option.id === id) ?? null
}

export function getClaudeSelectOptions(
  option: SessionConfigOption | null | undefined
): ClaudeSelectOption[] {
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

export function getClaudeConfigValue(
  options: readonly SessionConfigOption[],
  id: string
) {
  return findClaudeConfigOption(options, id)?.currentValue ?? null
}

export function getClaudeCurrentMode(
  options: readonly SessionConfigOption[],
  modes?: SessionModeState | null
) {
  const configured = getClaudeConfigValue(options, CLAUDE_MODE_CONFIG_ID)

  return typeof configured === "string"
    ? configured
    : modes?.currentModeId ?? CLAUDE_DEFAULT_MODE
}

export function getClaudeFastMode(options: readonly SessionConfigOption[]) {
  const option = findClaudeConfigOption(options, CLAUDE_FAST_MODE_CONFIG_ID)

  if (!option) {
    return { available: false, active: false }
  }

  return {
    available: true,
    active:
      option.type === "boolean"
        ? option.currentValue
        : option.currentValue === "on",
  }
}

export function getClaudePlanMode(
  options: readonly SessionConfigOption[],
  modes?: SessionModeState | null
) {
  const currentMode = getClaudeCurrentMode(options, modes)
  const modeOption = findClaudeConfigOption(options, CLAUDE_MODE_CONFIG_ID)
  const available =
    getClaudeSelectOptions(modeOption).some(
      (option) => option.value === CLAUDE_PLAN_MODE
    ) ||
    Boolean(
      modes?.availableModes.some((mode) => mode.id === CLAUDE_PLAN_MODE)
    )

  return {
    active: currentMode === CLAUDE_PLAN_MODE,
    available,
    currentMode,
  }
}

export function getClaudeModeCycle(
  options: readonly SessionConfigOption[],
  modes?: SessionModeState | null
) {
  const modeOption = findClaudeConfigOption(options, CLAUDE_MODE_CONFIG_ID)
  const available = new Set([
    ...getClaudeSelectOptions(modeOption).map((option) => option.value),
    ...(modes?.availableModes.map((mode) => mode.id) ?? []),
  ])

  return CLAUDE_MODE_CYCLE.filter((mode) => available.has(mode))
}

export function getNextClaudeMode(
  options: readonly SessionConfigOption[],
  modes?: SessionModeState | null
) {
  const cycle = getClaudeModeCycle(options, modes)

  if (cycle.length === 0) {
    return null
  }

  const current = getClaudeCurrentMode(options, modes)
  const currentIndex = cycle.indexOf(
    current as (typeof CLAUDE_MODE_CYCLE)[number]
  )

  return cycle[(currentIndex + 1) % cycle.length]
}
