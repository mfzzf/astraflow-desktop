"use client"

import * as React from "react"

import {
  appShellStore,
  bottomPanelOpenAtom,
  rightPanelOpenAtom,
  setBottomPanelOpen,
  setRightPanelOpen,
} from "@/lib/app-shell/store"

import {
  RIGHT_PANEL_MODE_STORAGE_KEY,
  RIGHT_PANEL_OPEN_STORAGE_KEY,
  STATUS_PANEL_OPEN_STORAGE_KEY,
  TERMINAL_PANEL_OPEN_STORAGE_KEY,
} from "./constants"
import type { StudioRightPanelMode } from "./types"

export function readStoredBoolean(key: string, fallback: boolean) {
  if (typeof window === "undefined") {
    return fallback
  }

  const stored = window.localStorage.getItem(key)

  if (stored === "true") {
    return true
  }

  if (stored === "false") {
    return false
  }

  return fallback
}

export function isStudioRightPanelMode(
  value: string | null
): value is StudioRightPanelMode {
  return (
    value === "launcher" ||
    value === "files" ||
    value === "side-chat" ||
    value === "subagent" ||
    value === "browser" ||
    value === "browser-settings" ||
    value === "terminal" ||
    value === "review"
  )
}

export function readStoredRightPanelMode(): StudioRightPanelMode {
  if (typeof window === "undefined") {
    return "launcher"
  }

  const stored = window.localStorage.getItem(RIGHT_PANEL_MODE_STORAGE_KEY)

  return isStudioRightPanelMode(stored) ? stored : "launcher"
}

const statusPanelOpenListeners = new Set<() => void>()
const rightPanelModeListeners = new Set<() => void>()
let terminalPanelHydrated = false
let rightPanelHydrated = false
let rightPanelModeHydrated = false

function writeStoredBoolean(key: string, value: boolean) {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(key, String(value))
}

function hydrateTerminalPanelOpen() {
  if (terminalPanelHydrated || typeof window === "undefined") {
    return
  }

  terminalPanelHydrated = true
  setBottomPanelOpen(
    appShellStore,
    readStoredBoolean(TERMINAL_PANEL_OPEN_STORAGE_KEY, false)
  )
}

function hydrateRightPanelState() {
  if (typeof window === "undefined") {
    return
  }

  if (!rightPanelHydrated) {
    rightPanelHydrated = true
    setRightPanelOpen(
      appShellStore,
      readStoredBoolean(RIGHT_PANEL_OPEN_STORAGE_KEY, false)
    )
  }

  rightPanelModeHydrated = true
}

export function getStoredTerminalPanelOpen() {
  return terminalPanelHydrated
    ? appShellStore.get(bottomPanelOpenAtom)
    : readStoredBoolean(TERMINAL_PANEL_OPEN_STORAGE_KEY, false)
}

export function setStoredTerminalPanelOpen(open: boolean) {
  terminalPanelHydrated = true
  writeStoredBoolean(TERMINAL_PANEL_OPEN_STORAGE_KEY, open)
  setBottomPanelOpen(appShellStore, open)
}

export function subscribeTerminalPanelOpen(listener: () => void) {
  const unsubscribe = appShellStore.sub(bottomPanelOpenAtom, () => {
    writeStoredBoolean(
      TERMINAL_PANEL_OPEN_STORAGE_KEY,
      appShellStore.get(bottomPanelOpenAtom)
    )
    listener()
  })
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== TERMINAL_PANEL_OPEN_STORAGE_KEY) {
      return
    }

    terminalPanelHydrated = true
    setBottomPanelOpen(
      appShellStore,
      readStoredBoolean(TERMINAL_PANEL_OPEN_STORAGE_KEY, false)
    )
  }

  window.addEventListener("storage", handleStorage)

  if (!terminalPanelHydrated) {
    queueMicrotask(hydrateTerminalPanelOpen)
  }

  return () => {
    unsubscribe()
    window.removeEventListener("storage", handleStorage)
  }
}

function getHydratedTerminalPanelOpen() {
  return terminalPanelHydrated ? appShellStore.get(bottomPanelOpenAtom) : false
}

export function useTerminalPanelOpen() {
  const open = React.useSyncExternalStore(
    subscribeTerminalPanelOpen,
    getHydratedTerminalPanelOpen,
    () => false
  )

  return [open, setStoredTerminalPanelOpen] as const
}

export function getStoredStatusPanelOpen() {
  return readStoredBoolean(STATUS_PANEL_OPEN_STORAGE_KEY, false)
}

export function setStoredStatusPanelOpen(open: boolean) {
  window.localStorage.setItem(STATUS_PANEL_OPEN_STORAGE_KEY, String(open))
  statusPanelOpenListeners.forEach((listener) => listener())
}

export function subscribeStatusPanelOpen(listener: () => void) {
  statusPanelOpenListeners.add(listener)
  window.addEventListener("storage", listener)

  return () => {
    statusPanelOpenListeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

export function useStatusPanelOpen() {
  const open = React.useSyncExternalStore(
    subscribeStatusPanelOpen,
    getStoredStatusPanelOpen,
    () => false
  )

  return [open, setStoredStatusPanelOpen] as const
}

export function subscribeRightPanelOpen(listener: () => void) {
  const unsubscribe = appShellStore.sub(rightPanelOpenAtom, () => {
    writeStoredBoolean(
      RIGHT_PANEL_OPEN_STORAGE_KEY,
      appShellStore.get(rightPanelOpenAtom)
    )
    listener()
  })
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== RIGHT_PANEL_OPEN_STORAGE_KEY) {
      return
    }

    rightPanelHydrated = true
    setRightPanelOpen(
      appShellStore,
      readStoredBoolean(RIGHT_PANEL_OPEN_STORAGE_KEY, false)
    )
  }

  window.addEventListener("storage", handleStorage)

  if (!rightPanelHydrated) {
    queueMicrotask(hydrateRightPanelState)
  }

  return () => {
    unsubscribe()
    window.removeEventListener("storage", handleStorage)
  }
}

export function getStoredRightPanelOpen() {
  return rightPanelHydrated
    ? appShellStore.get(rightPanelOpenAtom)
    : readStoredBoolean(RIGHT_PANEL_OPEN_STORAGE_KEY, false)
}

export function setStoredRightPanelOpen(open: boolean) {
  rightPanelHydrated = true
  writeStoredBoolean(RIGHT_PANEL_OPEN_STORAGE_KEY, open)
  setRightPanelOpen(appShellStore, open)
}

export function setStoredRightPanelMode(mode: StudioRightPanelMode) {
  rightPanelModeHydrated = true
  window.localStorage.setItem(RIGHT_PANEL_MODE_STORAGE_KEY, mode)
  rightPanelModeListeners.forEach((listener) => listener())
}

export function getHydratedRightPanelOpen() {
  return rightPanelHydrated ? getStoredRightPanelOpen() : false
}

export function getHydratedRightPanelMode() {
  return rightPanelModeHydrated ? readStoredRightPanelMode() : "launcher"
}

export function useRightPanelOpen() {
  const open = React.useSyncExternalStore(
    subscribeRightPanelOpen,
    getHydratedRightPanelOpen,
    () => false
  )

  return [open, setStoredRightPanelOpen] as const
}

export function useRightPanelMode() {
  const subscribeRightPanelMode = React.useCallback((listener: () => void) => {
    rightPanelModeListeners.add(listener)

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== RIGHT_PANEL_MODE_STORAGE_KEY) {
        return
      }

      rightPanelModeHydrated = true
      listener()
    }

    window.addEventListener("storage", handleStorage)

    if (!rightPanelModeHydrated) {
      queueMicrotask(() => {
        hydrateRightPanelState()
        rightPanelModeListeners.forEach((currentListener) => currentListener())
      })
    }

    return () => {
      rightPanelModeListeners.delete(listener)
      window.removeEventListener("storage", handleStorage)
    }
  }, [])
  const mode = React.useSyncExternalStore(
    subscribeRightPanelMode,
    getHydratedRightPanelMode,
    () => "launcher" as StudioRightPanelMode
  )

  return [mode, setStoredRightPanelMode] as const
}
