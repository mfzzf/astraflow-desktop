"use client"

import { useSyncExternalStore } from "react"

const subscribeToDesktopRuntime = () => () => {}

export function useDesktopRuntime() {
  return useSyncExternalStore(
    subscribeToDesktopRuntime,
    () => window.astraflowDesktop != null,
    // Keep server output and the first hydration render desktop-safe. A
    // browser-only client can enable richer motion after hydration.
    () => true
  )
}
