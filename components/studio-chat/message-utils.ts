"use client"

import * as React from "react"

import {
  countUnifiedDiffChanges,
  synthesizeAdditionsDiff,
} from "@/components/studio-file-diff"
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

type LegacyPiWriteSnapshot = {
  content: string
  path: string
}

function normalizeFilePath(path: string) {
  return path
    .trim()
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "")
}

function normalizeSafeRelativePath(path: string) {
  const normalized = normalizeFilePath(path)

  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    return null
  }

  const segments = normalized.split("/").filter((segment) => segment !== ".")

  if (segments.some((segment) => !segment || segment === "..")) {
    return null
  }

  return segments.join("/")
}

function matchesLegacyPiWritePath({
  filePath,
  sessionId,
  toolPath,
}: {
  filePath: string
  sessionId: string
  toolPath: string
}) {
  const normalizedFilePath = normalizeFilePath(filePath)
  const normalizedToolPath = normalizeFilePath(toolPath)

  if (normalizedFilePath === normalizedToolPath) {
    return true
  }

  const relativeToolPath = normalizeSafeRelativePath(toolPath)

  return relativeToolPath
    ? normalizedFilePath.endsWith(
        `/sandbox-workspaces/${sessionId}/${relativeToolPath}`
      )
    : false
}

function restoreLegacyPiWriteDiffs(message: StudioMessage) {
  if (message.role !== "assistant" || message.environment === "remote") {
    return message
  }

  const snapshots = message.activities.flatMap<LegacyPiWriteSnapshot>(
    (activity) => {
      if (activity.toolName !== "write" || activity.status !== "complete") {
        return []
      }

      const input = parseToolJsonObject(activity.input)

      return typeof input?.path === "string" &&
        typeof input.content === "string"
        ? [{ path: input.path, content: input.content }]
        : []
    }
  )

  if (snapshots.length === 0) {
    return message
  }

  let changed = false
  const parts = message.parts.map((part) => {
    if (
      part.type !== "file" ||
      part.kind !== "create" ||
      part.status !== "complete" ||
      part.diff?.trim()
    ) {
      return part
    }

    const snapshot = [...snapshots]
      .reverse()
      .find((candidate) =>
        matchesLegacyPiWritePath({
          filePath: part.path,
          sessionId: message.sessionId,
          toolPath: candidate.path,
        })
      )
    const diff = snapshot
      ? synthesizeAdditionsDiff(
          normalizeFilePath(snapshot.path).replace(/^\/+/, ""),
          snapshot.content
        )
      : null

    if (!diff) {
      return part
    }

    changed = true
    return {
      ...part,
      diff,
      stats: countUnifiedDiffChanges(diff),
    }
  })

  return changed ? { ...message, parts } : message
}

export function mergeReloadedMessages(
  currentMessages: StudioMessage[],
  nextMessages: StudioMessage[]
) {
  const restoredNextMessages = nextMessages.map(restoreLegacyPiWriteDiffs)
  const currentById = new Map(
    currentMessages.map((message) => [message.id, message])
  )

  return restoredNextMessages.map((nextMessage) => {
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
  const restoredLiveMessage = restoreLegacyPiWriteDiffs(liveMessage)
  const existingIndex = currentMessages.findIndex(
    (message) => message.id === restoredLiveMessage.id
  )

  if (existingIndex >= 0) {
    return currentMessages.map((message, index) =>
      index === existingIndex
        ? reconcileMediaGenerationProgress(message, restoredLiveMessage)
        : message
    )
  }

  if (
    restoredLiveMessage.role !== "assistant" ||
    !restoredLiveMessage.versionGroupId
  ) {
    return [...currentMessages, restoredLiveMessage]
  }

  const replacementIndex = currentMessages.findIndex(
    (message) =>
      message.role === "assistant" &&
      message.versionGroupId === restoredLiveMessage.versionGroupId
  )

  if (replacementIndex < 0) {
    return [...currentMessages, restoredLiveMessage]
  }

  return [
    ...currentMessages.slice(0, replacementIndex),
    restoredLiveMessage,
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

function getCanonicalFileToolName(toolName: string) {
  const segments = toolName.trim().toLowerCase().split("__").filter(Boolean)
  const isMcp = segments[0] === "mcp"
  const serverSegments = isMcp ? segments.slice(1, -1) : []

  return {
    name: segments.at(-1) ?? "",
    local:
      !isMcp ||
      serverSegments.some((segment) =>
        /(?:^|[-_])(filesystem|local[-_]?files|fs)(?:$|[-_])/.test(segment)
      ),
  }
}

export function getSessionOutputFiles(
  messages: StudioMessage[],
  fallbackEnvironment: StudioOutputFile["environment"] = "local"
) {
  const outputFiles = new Map<string, StudioOutputFile>()
  const writeToolNames = new Set([
    "write_file",
    "edit_file",
    "write",
    "create_file",
  ])
  const readToolNames = new Set([
    "read_file",
    "read",
    "read_text_file",
    "get_file_contents",
    "view_image",
    "open_file",
  ])
  const deleteToolNames = new Set([
    "delete_file",
    "remove_file",
    "unlink_file",
  ])

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue
    }

    const environment = message.environment ?? fallbackEnvironment

    for (const part of message.parts) {
      if (
        part.type === "file" &&
        part.status === "complete" &&
        part.kind === "delete"
      ) {
        outputFiles.delete(`${environment}\0${part.path.trim()}`)
        continue
      }

      let path = ""
      let sourceKind: StudioOutputFile["sourceKind"] = "updated"
      const tool =
        part.type === "tool"
          ? getCanonicalFileToolName(part.activity.toolName)
          : { name: "", local: false }

      if (
        part.type === "tool" &&
        part.activity.status === "complete" &&
        tool.local &&
        deleteToolNames.has(tool.name)
      ) {
        const deletedPath = getToolPathInput(part.activity.input).trim()

        if (deletedPath) {
          outputFiles.delete(`${environment}\0${deletedPath}`)
        }
        continue
      }

      if (
        part.type === "file" &&
        part.status === "complete" &&
        part.kind !== "delete"
      ) {
        path = part.path
      } else if (
        part.type === "tool" &&
        part.activity.status === "complete" &&
        tool.local &&
        writeToolNames.has(tool.name)
      ) {
        path = getToolPathInput(part.activity.input)
      } else if (
        part.type === "tool" &&
        part.activity.status === "complete" &&
        tool.local &&
        readToolNames.has(tool.name)
      ) {
        path = getToolPathInput(part.activity.input)
        sourceKind = "read"
      }

      const normalizedPath = path.trim()

      if (normalizedPath) {
        const outputKey = `${environment}\0${normalizedPath}`
        const existing = outputFiles.get(outputKey)

        outputFiles.set(outputKey, {
          path: normalizedPath,
          name: getOutputFileName(normalizedPath),
          environment,
          sourceKind:
            existing?.sourceKind === "updated" ? "updated" : sourceKind,
        })
      }
    }
  }

  return Array.from(outputFiles.values())
}

export function getSessionFileChanges(
  messages: StudioMessage[],
  fallbackEnvironment: StudioFileChangeSummary["environment"] = "local"
) {
  const changes = new Map<string, StudioFileChangeSummary>()

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue
    }

    const environment = message.environment ?? fallbackEnvironment

    for (const part of message.parts) {
      if (part.type !== "file" || part.status === "error") {
        continue
      }

      const normalizedPath = part.path.trim()

      if (!normalizedPath) {
        continue
      }

      const hasRealDiff = Boolean(part.diff?.trim())
      const stats =
        part.stats ??
        (hasRealDiff
          ? countUnifiedDiffChanges(part.diff ?? "")
          : { additions: 0, deletions: 0 })
      const changeKey = `${environment}\0${normalizedPath}`
      const existing = changes.get(changeKey)

      if (!existing) {
        changes.set(changeKey, {
          path: normalizedPath,
          name: getOutputFileName(normalizedPath),
          kind: part.kind,
          additions: stats.additions,
          deletions: stats.deletions,
          environment,
        })
        continue
      }

      existing.kind = part.kind === "create" ? existing.kind : part.kind

      if (hasRealDiff) {
        existing.additions += stats.additions
        existing.deletions += stats.deletions
      }
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
