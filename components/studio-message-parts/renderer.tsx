import * as React from "react"

import type { StudioWorkspaceTransport } from "@/components/studio-chat/workspace-transport"
import { MessageContent } from "@/components/ui/message"
import type {
  StudioMessageActivity,
  StudioMessagePart,
} from "@/lib/studio-types"
import {
  extractToolOutputArtifactPaths,
  normalizeLocalArtifactPath,
  resolveStudioWorkspaceArtifact,
} from "@/lib/studio-markdown-artifacts"
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
  WrittenFileOpenCard,
} from "./file-output"
import { AssistantMediaGeneration, createMediaUrlMap } from "./media-generation"
import { AssistantPlan, isAssistantPlanComplete } from "./plan-todo"
import { AssistantReasoning } from "./reasoning"
import {
  arrangeMessagePartsForDisplay,
  isCollapsibleActivityPart,
} from "./render-order"
import {
  markdownClassName,
  MessageRenderEnvironmentContext,
  isCommandProcessResult,
  planToolNames,
  streamingPulseDotClassName,
  subagentToolNames,
} from "./shared"
import { AssistantSubagent } from "./subagent"
import { getRenderableMessageParts } from "./text"
import { AssistantActivity } from "./tool"
import type {
  MessageRenderEnvironment,
  RenderableStudioMessagePart,
} from "./types"

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

  if (part.type === "media_generation") {
    return (
      part.status === "complete" ||
      part.status === "partial" ||
      part.status === "error" ||
      part.status === "cancelled"
    )
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
  workspace = null,
}: {
  content: string
  activities: StudioMessageActivity[]
  parts: StudioMessagePart[]
  sessionId?: string | null
  projectId?: string | null
  workspace?: StudioWorkspaceTransport | null
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
  const hasImageGenerationPart = allRenderableParts.some(
    (part) => part.type === "media_generation" && part.kind === "image"
  )
  const hasVideoGenerationPart = allRenderableParts.some(
    (part) => part.type === "media_generation" && part.kind === "video"
  )
  // Successful file_change parts feed one turn-level summary instead of
  // repeating every file inside the activity trace. Error parts stay in the
  // trace so a failed write is always inspectable.

  const renderableParts = allRenderableParts.flatMap(
    (part): RenderableStudioMessagePart[] => {
      if (
        part.type === "tool" &&
        part.activity.status !== "error" &&
        ((planToolNames.has(part.activity.toolName) && hasPlanPart) ||
          (subagentToolNames.has(part.activity.toolName) && hasSubagentPart) ||
          (part.activity.toolName === "studio_generate_image" &&
            hasImageGenerationPart) ||
          (part.activity.toolName === "studio_generate_video" &&
            hasVideoGenerationPart))
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
    ? (part: RenderableStudioMessagePart) =>
        part.type === "media_generation" ||
        isSettledCollapsibleActivityPart(part)
    : isCollapsibleActivityPart
  const renderItems = arrangeMessagePartsForDisplay(
    renderableParts,
    shouldCollapseActivityPart
  )
  const artifactFileCards = new Map<
    string,
    { path: string; source: "tool" | "generated" }
  >()
  const artifactMarkdown = allRenderableParts
    .flatMap((part) => (part.type === "text" ? [part.content] : []))
    .join("\n\n")

  if (!streaming && workspace) {
    const getArtifactKey = (path: string) => {
      const resolution = resolveStudioWorkspaceArtifact({
        reference: path,
        source: "tool",
        workspace,
      })

      return normalizeLocalArtifactPath(
        resolution.status === "available"
          ? resolution.artifact.path
          : resolution.path
      )
    }

    for (const activity of activities) {
      if (activity.status !== "complete") {
        continue
      }

      const info = getWrittenFileInfo(activity)

      if (info && isPreviewableWrittenFile(info.path)) {
        artifactFileCards.set(getArtifactKey(info.path), {
          path: info.path,
          source: "tool",
        })
      }

      for (const path of extractToolOutputArtifactPaths(activity)) {
        const key = getArtifactKey(path)

        if (!artifactFileCards.has(key)) {
          artifactFileCards.set(key, { path, source: "generated" })
        }
      }
    }
  }

  const writtenFileCards = [...artifactFileCards.values()]

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
          inline={index < 0}
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
        openLinksInWorkspace={Boolean(workspace)}
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
        {renderItems.map((item) => {
          if (item.type === "part") {
            return renderPart(item.part, item.sourceIndex)
          }

          const durationMs = item.parts.reduce(
            (sum, part) =>
              sum + (part.type === "reasoning" ? (part.durationMs ?? 0) : 0),
            0
          )

          return (
            <TurnActivitySummary
              key={item.id}
              stepCount={item.parts.length}
              durationMs={durationMs}
              running={
                streaming &&
                (item.anchorTextIndex === null ||
                  item.anchorTextIndex === lastTextPartIndex)
              }
              defaultOpen={item.parts.some(
                (part) =>
                  (part.type === "tool" &&
                    part.activity.status === "error" &&
                    !isCommandProcessResult(part.activity)) ||
                  (part.type === "file" && part.status === "error") ||
                  (part.type === "file_group" &&
                    part.files.some((file) => file.status === "error")) ||
                  (part.type === "media_generation" &&
                    part.status === "error")
              )}
            >
              {item.parts.map((part) => renderPart(part, -1))}
            </TurnActivitySummary>
          )
        })}
        {workspace
          ? writtenFileCards.map((info) => (
              <WrittenFileOpenCard
                key={info.path}
                info={info}
                source={info.source}
                workspace={workspace}
              />
            ))
          : null}
        {!streaming && workspace ? (
          <MarkdownArtifactOpenCards
            markdown={artifactMarkdown}
            excludedPaths={writtenFileCards.map((info) => info.path)}
            workspace={workspace}
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
