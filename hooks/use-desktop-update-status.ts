"use client"

import * as React from "react"

function useDesktopUpdateStatus() {
  const [status, setStatus] =
    React.useState<AstraFlowDesktopUpdateStatus | null>(null)

  React.useEffect(() => {
    const bridge = window.astraflowDesktop

    if (!bridge?.getUpdateStatus || !bridge.onUpdateStatusChanged) {
      return
    }

    let disposed = false
    const dispose = bridge.onUpdateStatusChanged((nextStatus) => {
      if (!disposed) {
        setStatus(nextStatus)
      }
    })

    void bridge
      .getUpdateStatus()
      .then((nextStatus) => {
        if (!disposed) {
          setStatus(nextStatus)
        }
      })
      .catch(() => undefined)

    return () => {
      disposed = true
      dispose()
    }
  }, [])

  return status
}

export { useDesktopUpdateStatus }
