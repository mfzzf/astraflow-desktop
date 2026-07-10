"use client"

import * as React from "react"

import type { StudioMessage } from "@/lib/studio-types"

import type { StudioFileChangeSummary, StudioOutputFile } from "./types"

export function getMessageProgressScore(message: StudioMessage) {
  return (
    message.content.length +
    message.reasoningContent.length +
    message.activities.length +
    message.parts.length
  )
}

function reconcileMediaGenerationProgress(
  previousMessage: StudioMessage | undefined,
  message: StudioMessage
): StudioMessage {
  if (!previousMessage) {
    return message
  }

  let changed = false
  const parts = message.parts.map((part) => {
    if (part.type !== "media_generation") {
      return part
    }

    const previousPart = previousMessage.parts.find(
      (candidate) =>
        candidate.type === "media_generation" &&
        candidate.generationId === part.generationId
    )

    if (
      previousPart?.type !== "media_generation" ||
      typeof previousPart.progress !== "number" ||
      typeof part.progress !== "number" ||
      previousPart.progress <= part.progress
    ) {
      return part
    }

    changed = true

    return { ...part, progress: previousPart.progress }
  })

  return changed ? { ...message, parts } : message
}

export function mergeReloadedMessages(
  currentMessages: StudioMessage[],
  nextMessages: StudioMessage[]
) {
  const currentById = new Map(
    currentMessages.map((message) => [message.id, message])
  )

  return nextMessages.map((nextMessage) => {
    const currentMessage = currentById.get(nextMessage.id)

    if (
      currentMessage?.status === "streaming" &&
      nextMessage.status === "streaming" &&
      getMessageProgressScore(currentMessage) >
        getMessageProgressScore(nextMessage)
    ) {
      return currentMessage
    }

    return reconcileMediaGenerationProgress(currentMessage, nextMessage)
  })
}

export function mergeLiveMessage(
  currentMessages: StudioMessage[],
  liveMessage: StudioMessage
) {
  const existingIndex = currentMessages.findIndex(
    (message) => message.id === liveMessage.id
  )

  if (existingIndex >= 0) {
    return currentMessages.map((message, index) =>
      index === existingIndex
        ? reconcileMediaGenerationProgress(message, liveMessage)
        : message
    )
  }

  if (liveMessage.role !== "assistant" || !liveMessage.versionGroupId) {
    return [...currentMessages, liveMessage]
  }

  const replacementIndex = currentMessages.findIndex(
    (message) =>
      message.role === "assistant" &&
      message.versionGroupId === liveMessage.versionGroupId
  )

  if (replacementIndex < 0) {
    return [...currentMessages, liveMessage]
  }

  return [
    ...currentMessages.slice(0, replacementIndex),
    liveMessage,
    ...currentMessages.slice(replacementIndex + 1),
  ]
}

export function getStudioGreetingPeriod(date = new Date()) {
  const hour = date.getHours()

  if (hour < 5) {
    return "lateNight"
  }

  if (hour < 10) {
    return "morning"
  }

  if (hour < 12) {
    return "lateMorning"
  }

  if (hour < 14) {
    return "noon"
  }

  if (hour < 17) {
    return "afternoon"
  }

  if (hour < 19) {
    return "evening"
  }

  return "night"
}

export function useStudioGreetingPeriod() {
  const [period, setPeriod] = React.useState("anytime")

  React.useEffect(() => {
    const updatePeriod = () => setPeriod(getStudioGreetingPeriod())

    updatePeriod()

    const timer = window.setInterval(updatePeriod, 60_000)

    return () => window.clearInterval(timer)
  }, [])

  return period
}

export function getPendingPermissionPart(messages: StudioMessage[]) {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = messages[messageIndex]

    for (
      let partIndex = message.parts.length - 1;
      partIndex >= 0;
      partIndex -= 1
    ) {
      const part = message.parts[partIndex]

      if (part.type === "permission" && part.status === "pending") {
        return part
      }
    }
  }

  return null
}

export function getPendingUserInputPart(messages: StudioMessage[]) {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = messages[messageIndex]

    for (
      let partIndex = message.parts.length - 1;
      partIndex >= 0;
      partIndex -= 1
    ) {
      const part = message.parts[partIndex]

      if (part.type === "user_input" && part.status === "pending") {
        return part
      }
    }
  }

  return null
}

export function hasActiveMediaGenerationPart(messages: StudioMessage[]) {
  return messages.some((message) =>
    message.parts.some(
      (part) =>
        part.type === "media_generation" &&
        (part.status === "queued" ||
          part.status === "running" ||
          part.status === "polling")
    )
  )
}

export function parseToolJsonObject(input: string) {
  try {
    const parsed = JSON.parse(input) as unknown

    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export function getToolPathInput(input: string) {
  const parsed = parseToolJsonObject(input)

  if (!parsed) {
    return input.trim()
  }

  const keys = [
    "path",
    "file_path",
    "filePath",
    "absolute_path",
    "absolutePath",
  ]

  for (const key of keys) {
    const value = parsed[key]

    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }

  return ""
}

export function getOutputFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

export function getSessionOutputFiles(messages: StudioMessage[]) {
  const outputFiles = new Map<string, StudioOutputFile>()
  const writeToolNames = new Set([
    "write_file",
    "edit_file",
    "Write",
    "create_file",
  ])

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue
    }

    for (const part of message.parts) {
      let path = ""

      if (
        part.type === "file" &&
        part.status === "complete" &&
        part.kind !== "delete"
      ) {
        path = part.path
      } else if (
        part.type === "tool" &&
        part.activity.status === "complete" &&
        writeToolNames.has(part.activity.toolName)
      ) {
        path = getToolPathInput(part.activity.input)
      }

      const normalizedPath = path.trim()

      if (normalizedPath && !outputFiles.has(normalizedPath)) {
        outputFiles.set(normalizedPath, {
          path: normalizedPath,
          name: getOutputFileName(normalizedPath),
        })
      }
    }
  }

  return Array.from(outputFiles.values())
}

export function getSessionFileChanges(messages: StudioMessage[]) {
  const changes = new Map<string, StudioFileChangeSummary>()

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue
    }

    for (const part of message.parts) {
      if (part.type !== "file") {
        continue
      }

      const normalizedPath = part.path.trim()

      if (!normalizedPath) {
        continue
      }

      changes.set(normalizedPath, {
        path: normalizedPath,
        name: getOutputFileName(normalizedPath),
        kind: part.kind,
        additions: part.stats?.additions ?? 0,
        deletions: part.stats?.deletions ?? 0,
      })
    }
  }

  return Array.from(changes.values())
}

export function getUserMessageHistory(messages: StudioMessage[]) {
  const history: string[] = []

  for (const message of messages) {
    if (message.role !== "user" || message.content.trim().length === 0) {
      continue
    }

    if (history[history.length - 1] !== message.content) {
      history.push(message.content)
    }
  }

  return history
}
