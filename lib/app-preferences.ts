"use client"

import * as React from "react"

export const APP_PREFERENCE_STORAGE_KEYS = {
  desktopNotifications: "astraflow:settings:desktop-notifications",
  notificationSounds: "astraflow:settings:notification-sounds",
  followLiveOutput: "astraflow:settings:follow-live-output",
  confirmDestructive: "astraflow:settings:confirm-destructive",
} as const

export type AppPreferenceName = keyof typeof APP_PREFERENCE_STORAGE_KEYS

const APP_PREFERENCE_DEFAULTS: Record<AppPreferenceName, boolean> = {
  desktopNotifications: true,
  notificationSounds: false,
  followLiveOutput: true,
  confirmDestructive: true,
}

const APP_PREFERENCES_CHANGED_EVENT = "astraflow:app-preferences-changed"

export function readAppPreference(name: AppPreferenceName) {
  if (typeof window === "undefined") return APP_PREFERENCE_DEFAULTS[name]

  try {
    const stored = window.localStorage.getItem(
      APP_PREFERENCE_STORAGE_KEYS[name]
    )

    if (stored === "true") return true
    if (stored === "false") return false
  } catch {
    // Locked-down browser contexts keep the documented default.
  }

  return APP_PREFERENCE_DEFAULTS[name]
}

export function writeAppPreference(name: AppPreferenceName, value: boolean) {
  if (typeof window === "undefined") return

  try {
    window.localStorage.setItem(
      APP_PREFERENCE_STORAGE_KEYS[name],
      String(value)
    )
  } catch {
    // The current document still receives the change event below.
  }

  window.dispatchEvent(
    new CustomEvent(APP_PREFERENCES_CHANGED_EVENT, { detail: { name, value } })
  )
}

function subscribeAppPreference(
  name: AppPreferenceName,
  listener: () => void
) {
  const handlePreferenceChange = (event: Event) => {
    const detail = (event as CustomEvent<{ name?: unknown }>).detail

    if (detail?.name === name) listener()
  }
  const handleStorage = (event: StorageEvent) => {
    if (event.key === APP_PREFERENCE_STORAGE_KEYS[name]) listener()
  }

  window.addEventListener(APP_PREFERENCES_CHANGED_EVENT, handlePreferenceChange)
  window.addEventListener("storage", handleStorage)

  return () => {
    window.removeEventListener(
      APP_PREFERENCES_CHANGED_EVENT,
      handlePreferenceChange
    )
    window.removeEventListener("storage", handleStorage)
  }
}

export function useAppPreference(name: AppPreferenceName) {
  const value = React.useSyncExternalStore(
    (listener) => subscribeAppPreference(name, listener),
    () => readAppPreference(name),
    () => APP_PREFERENCE_DEFAULTS[name]
  )
  const setValue = React.useCallback(
    (next: boolean) => writeAppPreference(name, next),
    [name]
  )

  return [value, setValue] as const
}
