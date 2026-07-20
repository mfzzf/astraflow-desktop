import * as React from "react"

import { Shimmer } from "@/components/ai-elements/shimmer"
import { useI18n } from "@/components/i18n-provider"
import { StudioFileWorkspaceContext } from "@/components/studio-file-workspace-context"
import type { StudioWorkspaceTransport } from "@/components/studio-chat/workspace-transport"
import { MessageContent } from "@/components/ui/message"
import type {
  StudioMessageActivity,
  StudioMessagePart,
} from "@/lib/studio-types"
import { agentContentBlockText } from "@/lib/agent/structured-content"
import { isStudioFileWorkspaceTargetForEnvironment } from "@/lib/studio-file-workspace"
import {
  extractToolOutputArtifactPaths,
  normalizeLocalArtifactPath,
  resolveStudioWorkspaceArtifact,
} from "@/lib/studio-markdown-artifacts"
import { cn } from "@/lib/utils"
import { shouldShowStreamingThinking } from "@/lib/studio-streaming-state"

import { TurnActivitySummary, TurnWorkingHeader } from "./activity"
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
import { AssistantPlan } from "./plan-todo"
import { AssistantReasoning } from "./reasoning"
import {
  markdownClassName,
  MessageRenderEnvironmentContext,
  isCommandProcessResult,
  planToolNames,
  subagentToolNames,
} from "./shared"
import { AssistantSubagent } from "./subagent"
import { StructuredContentBlock } from "./structured-content"
import { getRenderableMessageParts } from "./text"
import { AssistantActivity } from "./tool"
import type {
  MessageRenderEnvironment,
  RenderableStudioMessagePart,
} from "./types"

function isFinalAnswerPart(part: RenderableStudioMessagePart) {
  return (
    (part.type === "text" && part.phase === "final_answer") ||
    (part.type === "content" &&
      (part.channel ?? "message") === "message" &&
      part.phase === "final_answer")
  )
}

function isFallbackAnswerCandidate(part: RenderableStudioMessagePart) {
  return (
    (part.type === "text" && part.content.trim().length > 0) ||
    (part.type === "content" &&
      (part.channel ?? "message") === "message" &&
      (part.content.type !== "text" || part.content.text.trim().length > 0))
  )
}

function isTransparentMessagePart(part: RenderableStudioMessagePart) {
  return part.type === "permission" || part.type === "user_input"
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
  reasoningContent = "",
  reasoningDurationMs = null,
  startedAt,
  completedAt = null,
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
  reasoningContent?: string
  reasoningDurationMs?: number | null
  startedAt: string
  completedAt?: string | null
}) {
  const { t } = useI18n()
  const fileWorkspace =
    workspace &&
    isStudioFileWorkspaceTargetForEnvironment(workspace, environment)
      ? workspace
      : null
  const baseRenderableParts = getRenderableMessageParts({
    content,
    activities,
    parts,
  })
  const hasStructuredReasoning = baseRenderableParts.some(
    (part) =>
      part.type === "reasoning" ||
      (part.type === "content" && part.channel === "thought")
  )
  const partsWithReasoning: RenderableStudioMessagePart[] =
    reasoningContent.trim() && !hasStructuredReasoning
      ? [
          {
            id: "fallback-reasoning",
            type: "reasoning",
            content: reasoningContent,
            durationMs: reasoningDurationMs,
          },
          ...baseRenderableParts,
        ]
      : baseRenderableParts
  const hasMessageAnswer = partsWithReasoning.some(isFallbackAnswerCandidate)
  const allRenderableParts: RenderableStudioMessagePart[] =
    !hasMessageAnswer && content.trim()
      ? [
          ...partsWithReasoning,
          {
            id: "fallback-content",
            type: "text",
            content,
            phase: "final_answer",
          },
        ]
      : partsWithReasoning
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
  const lastContentPartIndex = renderableParts.findLastIndex(
    (part) =>
      part.type === "content" &&
      part.content.type === "text" &&
      part.content.text.trim()
  )
  const mediaUrlMap = React.useMemo(
    () => createMediaUrlMap(renderableParts),
    [renderableParts]
  )
  const turnFileParts = allRenderableParts.flatMap((part) =>
    part.type === "file_group" ? part.files : part.type === "file" ? [part] : []
  )
  const showStreamingThinking = shouldShowStreamingThinking({
    streaming,
    renderablePartCount: renderableParts.length,
    filePartCount: turnFileParts.length,
  })
  const explicitFinalAnswerIndexes = new Set(
    renderableParts.flatMap((part, index) =>
      isFinalAnswerPart(part) ? [index] : []
    )
  )
  const fallbackFinalAnswerIndex =
    explicitFinalAnswerIndexes.size > 0
      ? -1
      : renderableParts.findLastIndex(isFallbackAnswerCandidate)
  const finalAnswerIndexes =
    explicitFinalAnswerIndexes.size > 0
      ? explicitFinalAnswerIndexes
      : new Set(fallbackFinalAnswerIndex >= 0 ? [fallbackFinalAnswerIndex] : [])
  const workParts = renderableParts.filter(
    (part, index) =>
      !finalAnswerIndexes.has(index) && !isTransparentMessagePart(part)
  )
  const finalAnswerParts = renderableParts.filter((_part, index) =>
    finalAnswerIndexes.has(index)
  )
  const artifactFileCards = new Map<
    string,
    { path: string; source: "tool" | "generated" }
  >()
  const artifactMarkdown = allRenderableParts
    .flatMap((part) =>
      part.type === "text"
        ? [part.content]
        : part.type === "content" && (part.channel ?? "message") === "message"
          ? [agentContentBlockText(part.content)]
          : []
    )
    .join("\n\n")

  if (!streaming && fileWorkspace) {
    const getArtifactKey = (path: string) => {
      const resolution = resolveStudioWorkspaceArtifact({
        reference: path,
        source: "tool",
        workspace: fileWorkspace,
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
          content={part.content}
          variant={part.variant}
          uri={part.uri}
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
      return (
        <AssistantFileChangeGroup
          key={part.id}
          files={part.files}
          workspace={fileWorkspace}
        />
      )
    }

    if (part.type === "file") {
      return (
        <AssistantFileChangeGroup
          key={part.id}
          files={[part]}
          workspace={fileWorkspace}
        />
      )
    }

    if (part.type === "media_generation") {
      return <AssistantMediaGeneration key={part.id} part={part} />
    }

    if (part.type === "content") {
      return (
        <div
          key={part.id}
          className={cn(
            part.channel === "thought" && "text-muted-foreground opacity-90",
            part.phase === "commentary" && "text-muted-foreground"
          )}
          data-studio-message-part-id={part.id}
          data-content-channel={part.channel ?? "message"}
          data-message-phase={part.phase ?? undefined}
        >
          <StructuredContentBlock
            content={part.content}
            mediaSaveSessionId={sessionId}
            openLinksInWorkspace={Boolean(fileWorkspace)}
            streaming={streaming && index === lastContentPartIndex}
          />
        </div>
      )
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
        openLinksInWorkspace={Boolean(fileWorkspace)}
        streaming={streaming && index === lastTextPartIndex}
        className={cn(
          "bg-transparent p-0",
          markdownClassName,
          part.phase === "commentary" && "text-muted-foreground",
          streaming && index === lastTextPartIndex && "is-streaming"
        )}
        data-message-phase={part.phase ?? undefined}
      >
        {part.content}
      </MessageContent>
    )
  }

  const fallbackDurationMs = workParts.reduce(
    (sum, part) =>
      sum + (part.type === "reasoning" ? (part.durationMs ?? 0) : 0),
    0
  )
  const workHasError = workParts.some(
    (part) =>
      (part.type === "tool" &&
        part.activity.status === "error" &&
        !isCommandProcessResult(part.activity)) ||
      (part.type === "file" && part.status === "error") ||
      (part.type === "file_group" &&
        part.files.some((file) => file.status === "error")) ||
      (part.type === "media_generation" && part.status === "error")
  )

  return (
    <MessageRenderEnvironmentContext.Provider value={environment}>
      <StudioFileWorkspaceContext.Provider value={fileWorkspace}>
        <div className="flex w-full min-w-0 flex-col gap-1.5">
          {streaming ? (
            <>
              <TurnWorkingHeader startedAt={startedAt} />
              {renderableParts.map((part, index) => renderPart(part, index))}
              {showStreamingThinking ? (
                <Shimmer className="pt-0.5 text-sm text-muted-foreground/70">
                  {t.studioThinking}
                </Shimmer>
              ) : null}
            </>
          ) : (
            <>
              {workParts.length > 0 ? (
                <TurnActivitySummary
                  key={`completed-work:${completedAt ?? startedAt}`}
                  startedAt={startedAt}
                  completedAt={completedAt}
                  durationMs={fallbackDurationMs}
                  hasError={workHasError}
                >
                  {workParts.map((part) => renderPart(part, -1))}
                </TurnActivitySummary>
              ) : null}
              {finalAnswerParts.map((part) => renderPart(part, -1))}
            </>
          )}
          {fileWorkspace
            ? writtenFileCards.map((info) => (
                <WrittenFileOpenCard
                  key={info.path}
                  info={info}
                  source={info.source}
                  workspace={fileWorkspace}
                />
              ))
            : null}
          {!streaming && fileWorkspace ? (
            <MarkdownArtifactOpenCards
              markdown={artifactMarkdown}
              excludedPaths={writtenFileCards.map((info) => info.path)}
              workspace={fileWorkspace}
            />
          ) : null}
          {streaming && turnFileParts.length > 0 ? (
            <StreamingEditedFilesSummary files={turnFileParts} />
          ) : null}
          {!streaming && turnFileParts.length > 0 ? (
            <TurnEditedFilesCard
              files={turnFileParts}
              projectId={projectId}
              workspace={fileWorkspace}
            />
          ) : null}
        </div>
      </StudioFileWorkspaceContext.Provider>
    </MessageRenderEnvironmentContext.Provider>
  )
})
