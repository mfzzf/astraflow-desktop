"use client"

import * as React from "react"

import type { StudioMode } from "@/lib/studio-types"

const STORAGE_PREFIX = "astraflow:studio:prompt-draft"
const FORM_STORAGE_PREFIX = "astraflow:studio:form-draft"
const DRAFT_CHANGE_EVENT = "astraflow:studio-prompt-draft-changed"
const memoryDrafts = new Map<string, string>()
const memoryFormDrafts = new Map<string, unknown>()

function getPromptDraftStorageKey(mode: StudioMode, sessionId: string) {
  return `${STORAGE_PREFIX}:${mode}:${sessionId || "new"}`
}

function getStudioFormDraftFieldStorageKey(
  mode: StudioMode,
  sessionId: string,
  field: string
) {
  return `${FORM_STORAGE_PREFIX}:${mode}:${sessionId || "new"}:${field}`
}

function readPromptDraft(storageKey: string) {
  if (typeof window === "undefined") {
    return ""
  }

  try {
    return (
      window.localStorage.getItem(storageKey) ??
      memoryDrafts.get(storageKey) ??
      ""
    )
  } catch {
    return memoryDrafts.get(storageKey) ?? ""
  }
}

function writePromptDraft(storageKey: string, prompt: string) {
  if (prompt) {
    memoryDrafts.set(storageKey, prompt)
  } else {
    memoryDrafts.delete(storageKey)
  }

  try {
    if (prompt) {
      window.localStorage.setItem(storageKey, prompt)
    } else {
      window.localStorage.removeItem(storageKey)
    }
  } catch {
    // The in-memory copy still preserves the draft for this app session.
  }

  window.dispatchEvent(
    new CustomEvent(DRAFT_CHANGE_EVENT, { detail: { storageKey } })
  )
}

function subscribeToPromptDraft(storageKey: string, onChange: () => void) {
  function handleStorage(event: StorageEvent) {
    if (event.key === storageKey) {
      memoryDrafts.delete(storageKey)
      memoryFormDrafts.delete(storageKey)
      onChange()
    }
  }

  function handleDraftChange(event: Event) {
    if (
      event instanceof CustomEvent &&
      event.detail?.storageKey === storageKey
    ) {
      onChange()
    }
  }

  window.addEventListener("storage", handleStorage)
  window.addEventListener(DRAFT_CHANGE_EVENT, handleDraftChange)

  return () => {
    window.removeEventListener("storage", handleStorage)
    window.removeEventListener(DRAFT_CHANGE_EVENT, handleDraftChange)
  }
}

function getServerPromptDraft() {
  return ""
}

function useStudioPromptDraft(mode: StudioMode, sessionId: string) {
  const storageKey = getPromptDraftStorageKey(mode, sessionId)
  const subscribe = React.useCallback(
    (onChange: () => void) => subscribeToPromptDraft(storageKey, onChange),
    [storageKey]
  )
  const getSnapshot = React.useCallback(
    () => readPromptDraft(storageKey),
    [storageKey]
  )
  const prompt = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerPromptDraft
  )
  const setPrompt = React.useCallback<
    React.Dispatch<React.SetStateAction<string>>
  >(
    (value) => {
      const previous = readPromptDraft(storageKey)
      const next = typeof value === "function" ? value(previous) : value
      writePromptDraft(storageKey, next)
    },
    [storageKey]
  )

  return [prompt, setPrompt] as const
}

function readStudioFormDraftField<T>(storageKey: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback
  }

  if (memoryFormDrafts.has(storageKey)) {
    return memoryFormDrafts.get(storageKey) as T
  }

  try {
    const stored = window.localStorage.getItem(storageKey)
    if (stored !== null) {
      const parsed = JSON.parse(stored) as T
      memoryFormDrafts.set(storageKey, parsed)
      return parsed
    }
  } catch {
    // Fall back to the in-memory value below.
  }

  memoryFormDrafts.set(storageKey, fallback)
  return fallback
}

function writeStudioFormDraftField<T>(
  storageKey: string,
  value: T,
  persist: boolean
) {
  memoryFormDrafts.set(storageKey, value)

  if (persist) {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value))
    } catch {
      // The in-memory draft still preserves the value while the app is open.
    }
  } else {
    try {
      window.localStorage.removeItem(storageKey)
    } catch {
      // The in-memory draft remains authoritative for this field.
    }
  }

  window.dispatchEvent(
    new CustomEvent(DRAFT_CHANGE_EVENT, { detail: { storageKey } })
  )
}

function useStudioFormDraftField<T>(
  mode: StudioMode,
  sessionId: string,
  field: string,
  initialValue: T,
  options: { persist?: boolean } = {}
) {
  const persist = options.persist !== false
  const storageKey = getStudioFormDraftFieldStorageKey(mode, sessionId, field)
  const serverSnapshot = React.useRef(initialValue).current
  const subscribe = React.useCallback(
    (onChange: () => void) => subscribeToPromptDraft(storageKey, onChange),
    [storageKey]
  )
  const getSnapshot = React.useCallback(
    () => readStudioFormDraftField(storageKey, serverSnapshot),
    [serverSnapshot, storageKey]
  )
  const getServerSnapshot = React.useCallback(
    () => serverSnapshot,
    [serverSnapshot]
  )
  const value = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  )
  const setValue = React.useCallback<React.Dispatch<React.SetStateAction<T>>>(
    (nextValue) => {
      const previous = readStudioFormDraftField(storageKey, serverSnapshot)
      const next =
        typeof nextValue === "function"
          ? (nextValue as (current: T) => T)(previous)
          : nextValue

      if (Object.is(previous, next)) {
        return
      }

      writeStudioFormDraftField(storageKey, next, persist)
    },
    [persist, serverSnapshot, storageKey]
  )

  return [value, setValue] as const
}

function useStudioFormDraftReady(sessionId: string) {
  const [readySessionId, setReadySessionId] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) {
        setReadySessionId(sessionId)
      }
    })

    return () => {
      cancelled = true
    }
  }, [sessionId])

  return readySessionId === sessionId
}

function moveStorageEntry(sourceKey: string, destinationKey: string) {
  if (memoryDrafts.has(sourceKey)) {
    const value = memoryDrafts.get(sourceKey) ?? ""
    memoryDrafts.set(destinationKey, value)
    memoryDrafts.delete(sourceKey)
  }

  if (memoryFormDrafts.has(sourceKey)) {
    memoryFormDrafts.set(destinationKey, memoryFormDrafts.get(sourceKey))
    memoryFormDrafts.delete(sourceKey)
  }

  try {
    const stored = window.localStorage.getItem(sourceKey)
    if (stored !== null) {
      window.localStorage.setItem(destinationKey, stored)
      window.localStorage.removeItem(sourceKey)
    }
  } catch {
    // The in-memory copy above remains available when persistence is blocked.
  }

  window.dispatchEvent(
    new CustomEvent(DRAFT_CHANGE_EVENT, {
      detail: { storageKey: sourceKey },
    })
  )
  window.dispatchEvent(
    new CustomEvent(DRAFT_CHANGE_EVENT, {
      detail: { storageKey: destinationKey },
    })
  )
}

function moveStudioFormDraft(
  mode: StudioMode,
  sourceSessionId: string,
  destinationSessionId: string
) {
  if (
    typeof window === "undefined" ||
    sourceSessionId === destinationSessionId
  ) {
    return
  }

  moveStorageEntry(
    getPromptDraftStorageKey(mode, sourceSessionId),
    getPromptDraftStorageKey(mode, destinationSessionId)
  )

  const sourcePrefix = `${FORM_STORAGE_PREFIX}:${mode}:${
    sourceSessionId || "new"
  }:`
  const destinationPrefix = `${FORM_STORAGE_PREFIX}:${mode}:${
    destinationSessionId || "new"
  }:`
  const fieldNames = new Set<string>()

  for (const key of memoryFormDrafts.keys()) {
    if (key.startsWith(sourcePrefix)) {
      fieldNames.add(key.slice(sourcePrefix.length))
    }
  }

  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key?.startsWith(sourcePrefix)) {
        fieldNames.add(key.slice(sourcePrefix.length))
      }
    }
  } catch {
    // In-memory fields collected above are sufficient for this app session.
  }

  for (const fieldName of fieldNames) {
    moveStorageEntry(
      `${sourcePrefix}${fieldName}`,
      `${destinationPrefix}${fieldName}`
    )
  }
}

export {
  getPromptDraftStorageKey,
  getStudioFormDraftFieldStorageKey,
  moveStudioFormDraft,
  useStudioFormDraftField,
  useStudioFormDraftReady,
  useStudioPromptDraft,
}
