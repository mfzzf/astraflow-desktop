"use client"

import * as React from "react"

import {
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  RIGHT_PANEL_MODE_STORAGE_KEY,
  RIGHT_PANEL_OPEN_STORAGE_KEY,
  RIGHT_PANEL_WIDTH_STORAGE_KEY,
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

export function clampRightPanelWidth(value: number) {
  if (!Number.isFinite(value)) {
    return RIGHT_PANEL_DEFAULT_WIDTH
  }

  const viewportMax =
    typeof window === "undefined"
      ? RIGHT_PANEL_MAX_WIDTH
      : Math.min(
          RIGHT_PANEL_MAX_WIDTH,
          Math.max(RIGHT_PANEL_MIN_WIDTH, window.innerWidth - 520)
        )

  return Math.min(viewportMax, Math.max(RIGHT_PANEL_MIN_WIDTH, value))
}

export function readStoredRightPanelWidth() {
  if (typeof window === "undefined") {
    return RIGHT_PANEL_DEFAULT_WIDTH
  }

  return clampRightPanelWidth(
    Number(window.localStorage.getItem(RIGHT_PANEL_WIDTH_STORAGE_KEY))
  )
}

const terminalPanelOpenListeners = new Set<() => void>()
const statusPanelOpenListeners = new Set<() => void>()
const rightPanelListeners = new Set<() => void>()
let rightPanelHydrated = false

export function getStoredTerminalPanelOpen() {
  return readStoredBoolean(TERMINAL_PANEL_OPEN_STORAGE_KEY, false)
}

export function setStoredTerminalPanelOpen(open: boolean) {
  window.localStorage.setItem(TERMINAL_PANEL_OPEN_STORAGE_KEY, String(open))
  terminalPanelOpenListeners.forEach((listener) => listener())
}

export function subscribeTerminalPanelOpen(listener: () => void) {
  terminalPanelOpenListeners.add(listener)
  window.addEventListener("storage", listener)

  return () => {
    terminalPanelOpenListeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

export function useTerminalPanelOpen() {
  const open = React.useSyncExternalStore(
    subscribeTerminalPanelOpen,
    getStoredTerminalPanelOpen,
    () => false
  )

  return [open, setStoredTerminalPanelOpen] as const
}

export function getStoredStatusPanelOpen() {
  return readStoredBoolean(STATUS_PANEL_OPEN_STORAGE_KEY, true)
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
    () => true
  )

  return [open, setStoredStatusPanelOpen] as const
}

export function notifyRightPanelListeners() {
  rightPanelListeners.forEach((listener) => listener())
}

export function subscribeRightPanel(listener: () => void) {
  rightPanelListeners.add(listener)
  window.addEventListener("storage", listener)

  if (!rightPanelHydrated) {
    queueMicrotask(() => {
      rightPanelHydrated = true
      notifyRightPanelListeners()
    })
  }

  return () => {
    rightPanelListeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

export function getStoredRightPanelOpen() {
  return readStoredBoolean(RIGHT_PANEL_OPEN_STORAGE_KEY, false)
}

export function setStoredRightPanelOpen(open: boolean) {
  rightPanelHydrated = true
  window.localStorage.setItem(RIGHT_PANEL_OPEN_STORAGE_KEY, String(open))
  notifyRightPanelListeners()
}

export function setStoredRightPanelMode(mode: StudioRightPanelMode) {
  rightPanelHydrated = true
  window.localStorage.setItem(RIGHT_PANEL_MODE_STORAGE_KEY, mode)
  notifyRightPanelListeners()
}

export function setStoredRightPanelWidth(width: number) {
  const nextWidth = clampRightPanelWidth(width)

  rightPanelHydrated = true
  window.localStorage.setItem(RIGHT_PANEL_WIDTH_STORAGE_KEY, String(nextWidth))
  notifyRightPanelListeners()
}

export function getHydratedRightPanelOpen() {
  return rightPanelHydrated ? getStoredRightPanelOpen() : false
}

export function getHydratedRightPanelMode() {
  return rightPanelHydrated ? readStoredRightPanelMode() : "launcher"
}

export function getHydratedRightPanelWidth() {
  return rightPanelHydrated
    ? readStoredRightPanelWidth()
    : RIGHT_PANEL_DEFAULT_WIDTH
}

export function useRightPanelOpen() {
  const open = React.useSyncExternalStore(
    subscribeRightPanel,
    getHydratedRightPanelOpen,
    () => false
  )

  return [open, setStoredRightPanelOpen] as const
}

export function useRightPanelMode() {
  const mode = React.useSyncExternalStore(
    subscribeRightPanel,
    getHydratedRightPanelMode,
    () => "launcher" as StudioRightPanelMode
  )

  return [mode, setStoredRightPanelMode] as const
}

export function useRightPanelWidth() {
  const width = React.useSyncExternalStore(
    subscribeRightPanel,
    getHydratedRightPanelWidth,
    () => RIGHT_PANEL_DEFAULT_WIDTH
  )

  return [width, setStoredRightPanelWidth] as const
}
