import * as React from "react"

import { MessageContent } from "@/components/ui/message"
import type { StudioMessageActivity, StudioMessagePart } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

import { TurnActivitySummary } from "./activity"
import { AssistantFileChangeGroup, TurnEditedFilesCard } from "./file-change"
import {
  getWrittenFileInfo,
  isPreviewableWrittenFile,
  type WrittenFileInfo,
  WrittenFileOpenCard,
} from "./file-output"
import {
  AssistantMediaGeneration,
  createMediaUrlMap,
} from "./media-generation"
import { AssistantPlan } from "./plan-todo"
import { AssistantReasoning } from "./reasoning"
import {
  markdownClassName,
  MessageRenderEnvironmentContext,
  streamingPulseDotClassName,
} from "./shared"
import { AssistantSubagent } from "./subagent"
import { getRenderableMessageParts } from "./text"
import { AssistantActivity } from "./tool"
import type { MessageRenderEnvironment, RenderableStudioMessagePart } from "./types"

function isCollapsibleActivityPart(part: RenderableStudioMessagePart) {
  return (
    part.type === "tool" ||
    part.type === "reasoning" ||
    part.type === "plan" ||
    part.type === "subagent" ||
    part.type === "file" ||
    part.type === "file_group"
  )
}

export const MessagePartsRenderer = React.memo(function MessagePartsRenderer({
  content,
  activities,
  parts,
  sessionId,
  streaming = false,
  environment = "local",
}: {
  content: string
  activities: StudioMessageActivity[]
  parts: StudioMessagePart[]
  sessionId?: string | null
  streaming?: boolean
  environment?: MessageRenderEnvironment
}) {
  const renderableParts = getRenderableMessageParts({
    content,
    activities,
    parts,
  })
  const lastTextPartIndex = renderableParts.findLastIndex(
    (part) => part.type === "text" && part.content.trim()
  )
  const lastReasoningPartIndex = renderableParts.findLastIndex(
    (part) => part.type === "reasoning" && part.content.trim()
  )
  const mediaUrlMap = React.useMemo(
    () => createMediaUrlMap(renderableParts),
    [renderableParts]
  )
  const turnFileParts = renderableParts.flatMap((part) =>
    part.type === "file_group" ? part.files : part.type === "file" ? [part] : []
  )
  const collapsedParts = streaming
    ? []
    : renderableParts.filter(isCollapsibleActivityPart)
  const firstCollapsedIndex = streaming
    ? -1
    : renderableParts.findIndex(isCollapsibleActivityPart)
  const collapsedDurationMs = collapsedParts.reduce(
    (sum, part) =>
      sum + (part.type === "reasoning" ? (part.durationMs ?? 0) : 0),
    0
  )
  const writtenFileCards: WrittenFileInfo[] = []

  if (!streaming && environment === "local") {
    const cardsByPath = new Map<string, WrittenFileInfo>()

    for (const part of renderableParts) {
      if (part.type !== "tool" || part.activity.status !== "complete") {
        continue
      }

      const info = getWrittenFileInfo(part.activity)

      if (info && isPreviewableWrittenFile(info.path)) {
        cardsByPath.set(info.path, info)
      }
    }

    writtenFileCards.push(...cardsByPath.values())
  }

  function renderPart(part: RenderableStudioMessagePart, index: number) {
    if (part.type === "tool") {
      return <AssistantActivity key={part.id} activity={part.activity} />
    }

    if (part.type === "reasoning") {
      return (
        <AssistantReasoning
          key={part.id}
          content={part.content}
          durationMs={part.durationMs}
          isStreaming={
            streaming &&
            index === lastReasoningPartIndex &&
            part.durationMs === null
          }
        />
      )
    }

    if (part.type === "plan") {
      return (
        <div key={part.id} data-studio-message-part-id={part.id}>
          <AssistantPlan todos={part.todos} />
        </div>
      )
    }

    if (part.type === "permission") {
      return null
    }

    if (part.type === "user_input") {
      return null
    }

    if (part.type === "subagent") {
      return (
        <div key={part.id} data-studio-message-part-id={part.id}>
          <AssistantSubagent part={part} />
        </div>
      )
    }

    if (part.type === "file_group") {
      return <AssistantFileChangeGroup key={part.id} files={part.files} />
    }

    if (part.type === "file") {
      return <AssistantFileChangeGroup key={part.id} files={[part]} />
    }

    if (part.type === "media_generation") {
      return <AssistantMediaGeneration key={part.id} part={part} />
    }

    if (!part.content.trim()) {
      return null
    }

    return (
      <MessageContent
        key={part.id}
        markdown
        mediaSaveSessionId={sessionId}
        mediaUrlMap={mediaUrlMap}
        streaming={streaming && index === lastTextPartIndex}
        className={cn(
          "bg-transparent p-0",
          markdownClassName,
          streaming && index === lastTextPartIndex && streamingPulseDotClassName
        )}
      >
        {part.content}
      </MessageContent>
    )
  }

  return (
    <MessageRenderEnvironmentContext.Provider value={environment}>
      <div className="flex w-full min-w-0 flex-col gap-1.5">
        {renderableParts.map((part, index) => {
          // Once the turn completes, all activity-like parts collapse into a
          // single Codex-style "Worked for Ns" summary at the position of the
          // first one.
          if (!streaming && isCollapsibleActivityPart(part)) {
            if (index !== firstCollapsedIndex) {
              return null
            }

            return (
              <TurnActivitySummary
                key="turn-activity-summary"
                stepCount={collapsedParts.length}
                durationMs={collapsedDurationMs}
                defaultOpen={collapsedParts.some(
                  (collapsedPart) =>
                    (collapsedPart.type === "tool" &&
                      collapsedPart.activity.status === "error") ||
                    (collapsedPart.type === "file" &&
                      collapsedPart.status === "error") ||
                    (collapsedPart.type === "file_group" &&
                      collapsedPart.files.some(
                        (file) => file.status === "error"
                      ))
                )}
              >
                {collapsedParts.map((collapsedPart) =>
                  renderPart(collapsedPart, -1)
                )}
              </TurnActivitySummary>
            )
          }

          return renderPart(part, index)
        })}
        {writtenFileCards.map((info) => (
          <WrittenFileOpenCard key={info.path} info={info} />
        ))}
        {!streaming && turnFileParts.length > 0 ? (
          <TurnEditedFilesCard files={turnFileParts} />
        ) : null}
      </div>
    </MessageRenderEnvironmentContext.Provider>
  )
})
