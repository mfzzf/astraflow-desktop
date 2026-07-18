"use client"

import * as React from "react"

export const DOWNLOADABLE_AGENT_RUNTIME_IDS = [
  "codex",
  "claude-code",
  "opencode",
] as const

export type DownloadableAgentRuntimeId =
  (typeof DOWNLOADABLE_AGENT_RUNTIME_IDS)[number]

export function isDownloadableAgentRuntimeId(
  runtimeId: string
): runtimeId is DownloadableAgentRuntimeId {
  return DOWNLOADABLE_AGENT_RUNTIME_IDS.some((id) => id === runtimeId)
}

export function useAgentRuntimeInstallations() {
  const runtimeInstallerBridge =
    typeof window !== "undefined"
      ? (window.astraflowDesktop as Partial<AstraFlowDesktopBridge> | undefined)
      : undefined
  const desktopAvailable = Boolean(
    runtimeInstallerBridge?.getAgentRuntimeStatuses &&
    runtimeInstallerBridge.installAgentRuntime &&
    runtimeInstallerBridge.onAgentRuntimeStatusChanged
  )
  const [statuses, setStatuses] = React.useState<
    Partial<Record<DownloadableAgentRuntimeId, AstraFlowAgentRuntimeStatus>>
  >({})
  const [loading, setLoading] = React.useState(() => desktopAvailable)

  React.useEffect(() => {
    const bridge = window.astraflowDesktop as
      Partial<AstraFlowDesktopBridge> | undefined

    if (
      !bridge?.getAgentRuntimeStatuses ||
      !bridge.onAgentRuntimeStatusChanged
    ) {
      return
    }

    let active = true
    const dispose = bridge.onAgentRuntimeStatusChanged((status) => {
      if (!active) {
        return
      }

      setStatuses((current) => ({
        ...current,
        [status.runtimeId]: status,
      }))
    })

    void bridge
      .getAgentRuntimeStatuses()
      .then((runtimeStatuses) => {
        if (!active) {
          return
        }

        setStatuses(
          Object.fromEntries(
            runtimeStatuses.map((status) => [status.runtimeId, status])
          )
        )
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
      dispose()
    }
  }, [])

  const installRuntime = React.useCallback(
    async (runtimeId: DownloadableAgentRuntimeId) => {
      const install = (
        window.astraflowDesktop as Partial<AstraFlowDesktopBridge> | undefined
      )?.installAgentRuntime

      if (!install) {
        throw new Error(
          "Agent runtime installation is only available in AstraFlow Desktop."
        )
      }

      const status = await install(runtimeId)
      setStatuses((current) => ({ ...current, [runtimeId]: status }))
      return status
    },
    []
  )

  return {
    desktopAvailable,
    installRuntime,
    loading,
    statuses,
  }
}
