import type { PromptMention } from "@/lib/agent/composer-types"
import { getStudioSession, listStudioMessages } from "@/lib/studio-db"
import type { StudioMessage } from "@/lib/studio-types"

const REFERENCED_SESSION_CONTEXT_LIMIT = 8_000
const REFERENCED_SESSION_TRUNCATION_NOTICE = "[earlier messages truncated]"

type SessionPromptMention = Extract<PromptMention, { kind: "session" }>

type ReferencedSessionSource = {
  messages: StudioMessage[]
  title: string
}

export type ReferencedSessionResolver = (
  mention: SessionPromptMention
) => ReferencedSessionSource | null

export function studioMessageTextForPrompt(message: StudioMessage) {
  if (message.role === "assistant") {
    const textParts = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.content.trim())
      .filter(Boolean)

    if (textParts.length > 0) {
      return textParts.join("\n").trim()
    }
  }

  return message.content.trim()
}

function transcriptLineForMessage(message: StudioMessage) {
  const text = studioMessageTextForPrompt(message)

  if (!text) {
    return null
  }

  return `${message.role === "assistant" ? "Assistant" : "User"}: ${text}`
}

function truncateTranscriptLine(line: string, maxLength: number) {
  if (line.length <= maxLength) {
    return line
  }

  if (maxLength <= 3) {
    return line.slice(0, maxLength)
  }

  return `${line.slice(0, maxLength - 3)}...`
}

export function formatReferencedSessionTranscript({
  maxLength,
  messages,
  title,
}: {
  maxLength: number
  messages: StudioMessage[]
  title: string
}) {
  const header = `--- Referenced conversation: ${title} ---`
  const lines = messages
    .map(transcriptLineForMessage)
    .filter((line): line is string => Boolean(line))

  if (lines.length === 0 || maxLength < header.length) {
    return ""
  }

  const fullTranscript = [header, ...lines].join("\n")

  if (fullTranscript.length <= maxLength) {
    return fullTranscript
  }

  const prefix = [header, REFERENCED_SESSION_TRUNCATION_NOTICE]
  const prefixLength = prefix.join("\n").length

  if (prefixLength >= maxLength) {
    return prefix.join("\n").slice(0, maxLength)
  }

  const keptLines: string[] = []
  let usedLength = prefixLength

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const separatorLength = 1
    const available = maxLength - usedLength - separatorLength

    if (available <= 0) {
      break
    }

    const line = lines[index]
    const truncatedLine = truncateTranscriptLine(line, available)

    keptLines.unshift(truncatedLine)
    usedLength += separatorLength + truncatedLine.length

    if (truncatedLine.length < line.length) {
      break
    }
  }

  return [header, REFERENCED_SESSION_TRUNCATION_NOTICE, ...keptLines]
    .join("\n")
    .slice(0, maxLength)
}

function defaultReferencedSessionResolver(
  mention: SessionPromptMention
): ReferencedSessionSource | null {
  const referencedSession = getStudioSession(mention.sessionId)

  if (!referencedSession || referencedSession.mode !== "chat") {
    return null
  }

  const messages = listStudioMessages(mention.sessionId)

  return messages.length > 0
    ? {
        messages,
        title: referencedSession.title || mention.title,
      }
    : null
}

export function hasUnsnapshottedSessionPromptMentions(
  mentions: PromptMention[] | undefined
) {
  return (mentions ?? []).some(
    (mention) =>
      mention.kind === "session" && typeof mention.promptContext !== "string"
  )
}

export function snapshotSessionPromptMentions({
  currentSessionId,
  mentions,
  resolveReferencedSession = defaultReferencedSessionResolver,
}: {
  currentSessionId: string
  mentions: PromptMention[]
  resolveReferencedSession?: ReferencedSessionResolver
}) {
  const seenSessionIds = new Set<string>()
  let usedLength = 0

  return mentions.map((mention): PromptMention => {
    if (mention.kind !== "session") {
      return mention
    }

    const separatorLength = usedLength > 0 ? 2 : 0

    if (typeof mention.promptContext === "string") {
      seenSessionIds.add(mention.sessionId)

      if (mention.promptContext) {
        usedLength += separatorLength + mention.promptContext.length
      }

      return mention
    }

    if (
      mention.sessionId === currentSessionId ||
      seenSessionIds.has(mention.sessionId)
    ) {
      return { ...mention, promptContext: "" }
    }

    seenSessionIds.add(mention.sessionId)

    const remaining =
      REFERENCED_SESSION_CONTEXT_LIMIT - usedLength - separatorLength
    const source = remaining > 0 ? resolveReferencedSession(mention) : null
    const promptContext = source
      ? formatReferencedSessionTranscript({
          maxLength: remaining,
          messages: source.messages,
          title: source.title,
        })
      : ""

    if (promptContext) {
      usedLength += separatorLength + promptContext.length
    }

    return { ...mention, promptContext }
  })
}

export function getSessionPromptContext(mentions: PromptMention[] | undefined) {
  return (mentions ?? [])
    .flatMap((mention) =>
      mention.kind === "session" && mention.promptContext
        ? [mention.promptContext]
        : []
    )
    .join("\n\n")
}
