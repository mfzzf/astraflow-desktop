import * as React from "react"

import { MessageContent } from "@/components/ui/message"
import type {
  StudioMessageActivity,
  StudioMessagePart,
} from "@/lib/studio-types"
import { cn } from "@/lib/utils"

import { TurnActivitySummary } from "./activity"
import {
  AssistantFileChangeGroup,
  StreamingEditedFilesSummary,
  TurnEditedFilesCard,
} from "./file-change"
import {
  getWrittenFileInfo,
  isPreviewableWrittenFile,
  MarkdownArtifactOpenCards,
  type WrittenFileInfo,
  WrittenFileOpenCard,
} from "./file-output"
import { AssistantMediaGeneration, createMediaUrlMap } from "./media-generation"
import { AssistantPlan, isAssistantPlanComplete } from "./plan-todo"
import { AssistantReasoning } from "./reasoning"
import {
  markdownClassName,
  MessageRenderEnvironmentContext,
  isCommandProcessResult,
  streamingPulseDotClassName,
} from "./shared"
import { AssistantSubagent } from "./subagent"
import { getRenderableMessageParts } from "./text"
import { AssistantActivity } from "./tool"
import type {
  MessageRenderEnvironment,
  RenderableStudioMessagePart,
} from "./types"

function isCollapsibleActivityPart(part: RenderableStudioMessagePart) {
  return (
    part.type === "tool" ||
    part.type === "reasoning" ||
    part.type === "plan" ||
    part.type === "file" ||
    part.type === "file_group"
  )
}

function isSettledCollapsibleActivityPart(part: RenderableStudioMessagePart) {
  if (!isCollapsibleActivityPart(part)) {
    return false
  }

  if (part.type === "tool") {
    return part.activity.status !== "running"
  }

  if (part.type === "reasoning") {
    return part.durationMs !== null
  }

  if (part.type === "plan") {
    return isAssistantPlanComplete(part.todos)
  }

  return true
}

export const MessagePartsRenderer = React.memo(function MessagePartsRenderer({
  content,
  activities,
  parts,
  sessionId,
  projectId,
  hideStreamingPlan = false,
  streaming = false,
  environment = "local",
}: {
  content: string
  activities: StudioMessageActivity[]
  parts: StudioMessagePart[]
  sessionId?: string | null
  projectId?: string | null
  workspaceRoot?: string | null
  hideStreamingPlan?: boolean
  streaming?: boolean
  environment?: MessageRenderEnvironment
}) {
  const allRenderableParts = getRenderableMessageParts({
    content,
    activities,
    parts,
  })
  const hasPlanPart = allRenderableParts.some((part) => part.type === "plan")
  const hasSubagentPart = allRenderableParts.some(
    (part) => part.type === "subagent"
  )
  // Successful file_change parts feed one turn-level summary instead of
  // repeating every file inside the activity trace. Error parts stay in the
  // trace so a failed write is always inspectable.

  const renderableParts = allRenderableParts.flatMap(
    (part): RenderableStudioMessagePart[] => {
      if (
        part.type === "tool" &&
        part.activity.status !== "error" &&
        ((part.activity.toolName === "update_plan" && hasPlanPart) ||
          (part.activity.toolName === "spawn_agent" && hasSubagentPart))
      ) {
        return []
      }

      if (part.type === "file") {
        if (part.status === "complete") {
          return []
        }

        return [part]
      }

      if (part.type === "file_group") {
        const errorFiles = part.files.filter((file) => file.status === "error")

        if (errorFiles.length === 0) {
          return []
        }

        return [
          errorFiles.length === part.files.length
            ? part
            : { ...part, files: errorFiles },
        ]
      }

      return [part]
    }
  )
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
  const turnFileParts = allRenderableParts.flatMap((part) =>
    part.type === "file_group" ? part.files : part.type === "file" ? [part] : []
  )
  const shouldCollapseActivityPart = streaming
    ? isSettledCollapsibleActivityPart
    : isCollapsibleActivityPart
  const collapsedParts = renderableParts.filter(shouldCollapseActivityPart)
  const firstCollapsedIndex = renderableParts.findIndex(
    shouldCollapseActivityPart
  )
  const collapsedDurationMs = collapsedParts.reduce(
    (sum, part) =>
      sum + (part.type === "reasoning" ? (part.durationMs ?? 0) : 0),
    0
  )
  const writtenFileCards: WrittenFileInfo[] = []
  const artifactMarkdown = allRenderableParts
    .flatMap((part) => (part.type === "text" ? [part.content] : []))
    .join("\n\n")

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
      if (streaming && hideStreamingPlan) {
        return null
      }

      return (
        <AssistantPlan
          key={part.id}
          todos={part.todos}
          partId={part.id}
        />
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
        openLinksInWorkspace={environment === "local"}
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
          // Keep finished activity compact while a turn is still streaming;
          // once the turn completes, every activity-like part joins the same
          // Codex-style summary at the position of the first one.
          if (shouldCollapseActivityPart(part)) {
            if (index !== firstCollapsedIndex) {
              return null
            }

            return (
              <TurnActivitySummary
                key="turn-activity-summary"
                stepCount={collapsedParts.length}
                durationMs={collapsedDurationMs}
                running={streaming}
                defaultOpen={collapsedParts.some(
                  (collapsedPart) =>
                    (collapsedPart.type === "tool" &&
                      collapsedPart.activity.status === "error" &&
                      !isCommandProcessResult(collapsedPart.activity)) ||
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
        {!streaming && environment === "local" && sessionId ? (
          <MarkdownArtifactOpenCards
            markdown={artifactMarkdown}
            sessionId={sessionId}
            excludedPaths={writtenFileCards.map((info) => info.path)}
          />
        ) : null}
        {streaming && turnFileParts.length > 0 ? (
          <StreamingEditedFilesSummary files={turnFileParts} />
        ) : null}
        {!streaming && turnFileParts.length > 0 ? (
          <TurnEditedFilesCard files={turnFileParts} projectId={projectId} />
        ) : null}
      </div>
    </MessageRenderEnvironmentContext.Provider>
  )
})
