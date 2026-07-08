"use client"

import { atom, createStore, type Atom } from "jotai"

export type AppShellStore = ReturnType<typeof createStore>

export type FocusArea = "main" | "sidebar" | "right-panel" | "bottom-panel"

export type RightPanelWidthMode = "regular" | "full"

export const appShellStore = createStore()

export const SIDEBAR_MIN_WIDTH = 240
export const SIDEBAR_MAX_WIDTH = 520
export const SIDEBAR_DEFAULT_WIDTH = 300
export const SIDEBAR_RESIZE_COLLAPSE = 240
export const SIDEBAR_WIDTH_STORAGE_KEY = "app-shell:left-panel-width"

export const RIGHT_PANEL_MIN_WIDTH = 320
export const RIGHT_PANEL_OFFSET = 352
export const RIGHT_PANEL_DEFAULT_RATIO = 0.33
export const RIGHT_PANEL_WIDTH_RATIO_STORAGE_KEY = "app-shell:right-panel-width:v2"

export const RIGHT_PANEL_PANEL_TICK_INTERVAL_MS = 16

export const sidebarOpenAtom = atom(true)
export const sidebarWidthAtom = atom(SIDEBAR_DEFAULT_WIDTH)
export const sidebarAnimationAtom = atom(true)

export const rightPanelOpenAtom = atom(false)
export const rightPanelWidthRatioAtom = atom(RIGHT_PANEL_DEFAULT_RATIO)
export const rightPanelFullWidthAtom = atom(false)

export const bottomPanelOpenAtom = atom(false)
export const bottomPanelHeightRatioAtom = atom(0)

export const fullWidthPanelAtom = atom(false)
export const focusAreaAtom = atom<FocusArea>("main")
export const floatingSidebarVisibleAtom = atom(false)

export const sidebarWidthRangeAtom = atom(() => {
  const viewportWidth = windowSizeForStorage()
  return getSidebarWidthBounds(viewportWidth)
})

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function windowSizeForStorage() {
  if (typeof window === "undefined") {
    return SIDEBAR_DEFAULT_WIDTH
  }

  return Math.max(1, window.innerWidth)
}

function readLocalStorageNumber(key: string) {
  if (typeof window === "undefined") {
    return null
  }

  const raw = window.localStorage.getItem(key)

  if (raw == null) {
    return null
  }

  const value = Number.parseFloat(raw)

  return Number.isFinite(value) ? value : null
}

function writeLocalStorageNumber(key: string, value: number) {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(key, String(value))
}

export function getSidebarWidthBounds(viewportWidth = windowSizeForStorage()) {
  return {
    minimum: SIDEBAR_MIN_WIDTH,
    maximum: Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, viewportWidth - 320)),
  }
}

export function clampSidebarWidth(width: number, viewportWidth = windowSizeForStorage()) {
  const bounds = getSidebarWidthBounds(viewportWidth)
  return clamp(width, bounds.minimum, bounds.maximum)
}

export function getRightPanelWidthMode(fullWidth: boolean): RightPanelWidthMode {
  return fullWidth ? "full" : "regular"
}

export function getRightPanelMinimumWidth(
  mode: RightPanelWidthMode,
  mainContentWidth: number,
) {
  if (mainContentWidth <= 0) {
    return RIGHT_PANEL_MIN_WIDTH
  }

  if (mode === "full") {
    return RIGHT_PANEL_MIN_WIDTH
  }

  return Math.min(RIGHT_PANEL_MIN_WIDTH, Math.max(0, mainContentWidth - RIGHT_PANEL_OFFSET))
}

export function getRightPanelMaximumWidth(
  mode: RightPanelWidthMode,
  mainContentWidth: number,
) {
  if (mainContentWidth <= 0) {
    return RIGHT_PANEL_MIN_WIDTH
  }

  if (mode === "full") {
    return Math.max(RIGHT_PANEL_MIN_WIDTH, mainContentWidth)
  }

  return Math.max(RIGHT_PANEL_MIN_WIDTH, mainContentWidth - RIGHT_PANEL_OFFSET)
}

export function getRightPanelWidthBounds(
  mainContentWidth: number,
  mode: RightPanelWidthMode,
) {
  return {
    minimum: getRightPanelMinimumWidth(mode, mainContentWidth),
    maximum: getRightPanelMaximumWidth(mode, mainContentWidth),
  }
}

export function getRightPanelWidthFromRatio(
  ratio: number,
  mainContentWidth: number,
  fullWidthMode: boolean,
) {
  return getRightPanelWidth(
    ratio,
    mainContentWidth,
    getRightPanelWidthMode(fullWidthMode),
  )
}

export function getRightPanelWidthToPixels(
  ratio: number,
  mainContentWidth: number,
  fullWidthMode: boolean,
) {
  return getRightPanelWidth(
    ratio,
    mainContentWidth,
    getRightPanelWidthMode(fullWidthMode),
  )
}

export function getRightPanelWidthFromPixels(
  width: number,
  mainContentWidth: number,
  fullWidthMode: boolean,
) {
  return getRightPanelRatio(
    width,
    mainContentWidth,
    getRightPanelWidthMode(fullWidthMode),
  )
}

export function getRightPanelWidthToRatio(
  width: number,
  mainContentWidth: number,
  fullWidthMode: boolean,
) {
  return getRightPanelRatio(
    width,
    mainContentWidth,
    getRightPanelWidthMode(fullWidthMode),
  )
}

export function getRightPanelWidth(
  ratio: number,
  mainContentWidth: number,
  mode: RightPanelWidthMode,
) {
  const { minimum, maximum } = getRightPanelWidthBounds(mainContentWidth, mode)
  const span = Math.max(0, maximum - minimum)

  if (span === 0) {
    return minimum
  }

  return minimum + clamp01(ratio) * span
}

export function getRightPanelRatio(
  width: number,
  mainContentWidth: number,
  mode: RightPanelWidthMode,
) {
  const { minimum, maximum } = getRightPanelWidthBounds(mainContentWidth, mode)
  const span = Math.max(0, maximum - minimum)

  if (span === 0) {
    return 0
  }

  return clamp01((width - minimum) / span)
}

export function setSidebarWidth(
  store: AppShellStore,
  width: number,
  options: { persist?: boolean; viewportWidth?: number } = {},
) {
  const nextWidth = clampSidebarWidth(width, options.viewportWidth)
  store.set(sidebarWidthAtom, nextWidth)

  if (options.persist !== false) {
    writeLocalStorageNumber(SIDEBAR_WIDTH_STORAGE_KEY, nextWidth)
  }
}

export function setSidebarOpen(
  store: AppShellStore,
  open: boolean,
  options: { animate?: boolean } = {},
) {
  const doAnimate = options.animate !== false

  store.set(sidebarAnimationAtom, doAnimate)
  store.set(sidebarOpenAtom, open)

  if (!open) {
    store.set(floatingSidebarVisibleAtom, false)
  }
}

export function toggleSidebar(store: AppShellStore, source?: string) {
  const next = !store.get(sidebarOpenAtom)
  setSidebarOpen(store, next, { animate: source !== "pointer" })
}

export function setRightPanelWidthRatio(
  store: AppShellStore,
  ratio: number,
) {
  const clampedRatio = clamp01(ratio)
  store.set(rightPanelWidthRatioAtom, clampedRatio)
  writeLocalStorageNumber(RIGHT_PANEL_WIDTH_RATIO_STORAGE_KEY, clampedRatio)
}

export function setRightPanelOpen(store: AppShellStore, open: boolean) {
  store.set(rightPanelOpenAtom, open)
}

export function setBottomPanelOpen(store: AppShellStore, open: boolean) {
  store.set(bottomPanelOpenAtom, open)
}

export function setBottomPanelHeightRatio(store: AppShellStore, ratio: number) {
  store.set(bottomPanelHeightRatioAtom, clamp01(ratio))
}

export function setFullWidthPanel(store: AppShellStore, fullWidth: boolean) {
  store.set(fullWidthPanelAtom, fullWidth)
  store.set(rightPanelFullWidthAtom, fullWidth)
}

export function setFocusArea(store: AppShellStore, area: FocusArea) {
  store.set(focusAreaAtom, area)
}

export function setFloatingSidebarVisible(store: AppShellStore, visible: boolean) {
  store.set(floatingSidebarVisibleAtom, visible)
}

export function resolveSidebarWidthFromStorage() {
  const stored = readLocalStorageNumber(SIDEBAR_WIDTH_STORAGE_KEY)

  if (stored == null) {
    return SIDEBAR_DEFAULT_WIDTH
  }

  return clampSidebarWidth(stored)
}

export function resolveRightPanelRatioFromStorage() {
  const stored = readLocalStorageNumber(RIGHT_PANEL_WIDTH_RATIO_STORAGE_KEY)

  if (stored == null) {
    return RIGHT_PANEL_DEFAULT_RATIO
  }

  return clamp01(stored)
}

export function initializeStoreDefaults() {
  appShellStore.set(sidebarWidthAtom, resolveSidebarWidthFromStorage())
  appShellStore.set(rightPanelWidthRatioAtom, resolveRightPanelRatioFromStorage())
  appShellStore.set(sidebarOpenAtom, true)
  appShellStore.set(fullWidthPanelAtom, false)
  appShellStore.set(rightPanelFullWidthAtom, false)
  appShellStore.set(bottomPanelOpenAtom, false)
  appShellStore.set(focusAreaAtom, "main")
}

if (typeof window !== "undefined") {
  initializeStoreDefaults()
}

export type StoreAtom<T> = Atom<T>
