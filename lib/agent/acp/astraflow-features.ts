import type {
  SessionConfigOption,
  SessionModeState,
} from "@agentclientprotocol/sdk"

export const ASTRAFLOW_MODE_CONFIG_ID = "mode"
export const ASTRAFLOW_DEFAULT_MODE = "default"
export const ASTRAFLOW_PLAN_MODE = "plan"

export function getAstraFlowPlanMode(
  options: readonly SessionConfigOption[],
  modes?: SessionModeState | null
) {
  const option =
    options.find((candidate) => candidate.id === ASTRAFLOW_MODE_CONFIG_ID) ??
    null
  const optionModes =
    option?.type === "select"
      ? option.options.flatMap((candidate) =>
          "group" in candidate ? candidate.options : [candidate]
        )
      : []
  const currentMode =
    option?.type === "select"
      ? option.currentValue
      : modes?.currentModeId ?? ASTRAFLOW_DEFAULT_MODE

  return {
    active: currentMode === ASTRAFLOW_PLAN_MODE,
    available:
      optionModes.some((candidate) => candidate.value === ASTRAFLOW_PLAN_MODE) ||
      Boolean(
        modes?.availableModes.some((mode) => mode.id === ASTRAFLOW_PLAN_MODE)
      ),
  }
}
