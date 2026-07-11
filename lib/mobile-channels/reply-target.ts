import type { MobileChannelOutboundTarget } from "./types"

type ActiveMobileRunTarget = {
  current: MobileChannelOutboundTarget
}

declare global {
  var astraflowActiveMobileRunTargets:
    | Map<string, ActiveMobileRunTarget>
    | undefined
}

function activeMobileRunTargets() {
  if (!globalThis.astraflowActiveMobileRunTargets) {
    globalThis.astraflowActiveMobileRunTargets = new Map()
  }

  return globalThis.astraflowActiveMobileRunTargets
}

export function registerActiveMobileRunTarget(
  sessionId: string,
  target: MobileChannelOutboundTarget,
  runId: string
) {
  const targetRef: ActiveMobileRunTarget = {
    current: { ...target, runId },
  }
  activeMobileRunTargets().set(sessionId, targetRef)

  return {
    current: () => targetRef.current,
    release: () => {
      const targets = activeMobileRunTargets()

      if (targets.get(sessionId) === targetRef) {
        targets.delete(sessionId)
      }
    },
  }
}

export function refreshActiveMobileRunTarget(
  sessionId: string,
  target: MobileChannelOutboundTarget
) {
  const activeTarget = activeMobileRunTargets().get(sessionId)

  if (!activeTarget) {
    return false
  }

  activeTarget.current = {
    ...target,
    runId: activeTarget.current.runId,
  }
  return true
}
