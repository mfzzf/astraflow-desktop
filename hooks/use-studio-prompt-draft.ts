"use client"

import * as React from "react"

import type { StudioMode } from "@/lib/studio-types"

const STORAGE_PREFIX = "astraflow:studio:prompt-draft"
const DRAFT_CHANGE_EVENT = "astraflow:studio-prompt-draft-changed"
const memoryDrafts = new Map<string, string>()

function getPromptDraftStorageKey(mode: StudioMode, sessionId: string) {
  return `${STORAGE_PREFIX}:${mode}:${sessionId || "new"}`
}

function readPromptDraft(storageKey: string) {
  if (typeof window === "undefined") {
    return ""
  }

  try {
    return window.localStorage.getItem(storageKey) ?? memoryDrafts.get(storageKey) ?? ""
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
  const setPrompt = React.useCallback<React.Dispatch<React.SetStateAction<string>>>(
    (value) => {
      const previous = readPromptDraft(storageKey)
      const next = typeof value === "function" ? value(previous) : value
      writePromptDraft(storageKey, next)
    },
    [storageKey]
  )

  return [prompt, setPrompt] as const
}

export { getPromptDraftStorageKey, useStudioPromptDraft }
