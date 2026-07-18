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

export type AgentRuntimeSelectionAction =
  | "install"
  | "select"
  | "unavailable"
  | "wait"

export function resolveAgentRuntimeSelectionAction({
  desktopAvailable,
  loading,
  runtimeId,
  status,
}: {
  desktopAvailable: boolean
  loading: boolean
  runtimeId: string
  status?: AstraFlowAgentRuntimeStatus
}): AgentRuntimeSelectionAction {
  if (!isDownloadableAgentRuntimeId(runtimeId)) {
    return "select"
  }

  if (!desktopAvailable) {
    return "unavailable"
  }

  if (loading) {
    return "wait"
  }

  if (!status) {
    return "install"
  }

  if (status.ready) {
    return "select"
  }

  return status.phase === "downloading" || status.phase === "installing"
    ? "wait"
    : "install"
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

        setStatuses((current) => {
          const next = Object.fromEntries(
            runtimeStatuses.map((status) => [status.runtimeId, status])
          )

          for (const runtimeId of DOWNLOADABLE_AGENT_RUNTIME_IDS) {
            const currentStatus = current[runtimeId]
            const nextStatus = next[runtimeId]

            if (
              currentStatus &&
              (currentStatus.phase === "downloading" ||
                currentStatus.phase === "installing") &&
              nextStatus?.phase === "idle"
            ) {
              next[runtimeId] = currentStatus
            }
          }

          return next
        })
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

      setStatuses((current) => {
        const status = current[runtimeId]

        return status
          ? {
              ...current,
              [runtimeId]: {
                ...status,
                phase: "downloading",
                ready: false,
                needsInstall: true,
                percent: 0,
                transferred: 0,
                total: null,
                bytesPerSecond: 0,
                message: null,
              },
            }
          : current
      })

      try {
        const status = await install(runtimeId)

        setStatuses((current) => ({ ...current, [runtimeId]: status }))
        return status
      } catch (error) {
        setStatuses((current) => {
          const status = current[runtimeId]

          return status
            ? {
                ...current,
                [runtimeId]: {
                  ...status,
                  phase: "error",
                  ready: false,
                  needsInstall: true,
                  bytesPerSecond: null,
                  message:
                    error instanceof Error ? error.message : String(error),
                },
              }
            : current
        })
        throw error
      }
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
