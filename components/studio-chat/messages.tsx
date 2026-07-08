"use client"

import * as React from "react"
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiFileCopyLine,
  RiRefreshLine,
  RiThumbDownLine,
  RiThumbUpLine,
} from "@remixicon/react"

import {
  AssistantReasoning,
  MessagePartsRenderer,
  hasRenderableReasoningParts,
} from "@/components/studio-message-parts-renderer"
import { Shimmer } from "@/components/ai-elements/shimmer"
import { useI18n } from "@/components/i18n-provider"
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "@/components/ui/message"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { CHAT_MODEL_OPTIONS } from "@/lib/chat-models"
import type { StudioMessage } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

import { getAttachmentRenderKey } from "./attachment-utils"
import { FileAttachmentChip } from "./composer-parts"
import { listMessageVersions } from "./api"
import { useChatEnvironment } from "./chat-preferences"

export const ChatMessageBubble = React.memo(function ChatMessageBubble({
  message,
  onRetry,
}: {
  message: StudioMessage
  onRetry: (message: StudioMessage) => void
}) {
  if (message.role === "user") {
    return (
      <Message className="justify-end" data-studio-message-id={message.id}>
        <div className="flex max-w-[70%] flex-col items-end gap-2">
          {message.attachments.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-2">
              {message.attachments.map((attachment) => {
                const attachmentKey = getAttachmentRenderKey(attachment)

                return attachment.type === "image" && attachment.dataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={attachmentKey}
                    src={attachment.dataUrl}
                    alt={attachment.name}
                    className="max-h-60 max-w-full rounded-2xl border object-contain"
                  />
                ) : (
                  <FileAttachmentChip
                    key={attachmentKey}
                    attachment={attachment}
                  />
                )
              })}
            </div>
          ) : null}
          {message.content ? (
            <MessageContent className="rounded-full bg-foreground px-5 py-3 text-base text-background">
              {message.content}
            </MessageContent>
          ) : null}
        </div>
      </Message>
    )
  }

  return (
    <div data-studio-message-id={message.id}>
      <AssistantMessage message={message} onRetry={onRetry} />
    </div>
  )
})

function getStoredChatModelLabel(model: string | null) {
  if (!model) {
    return ""
  }

  return (
    CHAT_MODEL_OPTIONS.find((option) => option.value === model)?.label ?? model
  )
}

export function MessageVersionsDialog({
  message,
  open,
  onOpenChange,
}: {
  message: StudioMessage
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  const [versions, setVersions] = React.useState<StudioMessage[]>([message])
  const [activeIndex, setActiveIndex] = React.useState(0)
  const [chatEnvironment] = useChatEnvironment()

  React.useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    const versionGroupId = message.versionGroupId ?? message.id

    void listMessageVersions(message.sessionId, versionGroupId)
      .then((nextVersions) => {
        if (cancelled) {
          return
        }

        const effectiveVersions =
          nextVersions.length > 0 ? nextVersions : [message]
        const nextIndex = effectiveVersions.findIndex(
          (version) => version.id === message.id
        )

        setVersions(effectiveVersions)
        setActiveIndex(
          nextIndex >= 0 ? nextIndex : effectiveVersions.length - 1
        )
      })
      .catch(() => {
        if (!cancelled) {
          setVersions([message])
          setActiveIndex(0)
        }
      })

    return () => {
      cancelled = true
    }
  }, [message, open])

  const activeVersion = versions[activeIndex] ?? message
  const modelLabel = getStoredChatModelLabel(activeVersion.model)
  const showTopLevelReasoning = !hasRenderableReasoningParts(
    activeVersion.parts
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader className="items-center">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              disabled={activeIndex <= 0}
              onClick={() =>
                setActiveIndex((current) => Math.max(0, current - 1))
              }
            >
              <RiArrowLeftSLine aria-hidden />
            </Button>
            <DialogTitle>
              {t.studioVersionTitle(activeVersion.versionIndex)}
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              disabled={activeIndex >= versions.length - 1}
              onClick={() =>
                setActiveIndex((current) =>
                  Math.min(versions.length - 1, current + 1)
                )
              }
            >
              <RiArrowRightSLine aria-hidden />
            </Button>
          </div>
          {modelLabel ? (
            <p className="text-xs text-muted-foreground">
              {t.studioUsedModel(modelLabel)}
            </p>
          ) : null}
        </DialogHeader>

        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          {showTopLevelReasoning ? (
            <AssistantReasoning
              content={activeVersion.reasoningContent}
              durationMs={activeVersion.reasoningDurationMs}
            />
          ) : null}
          <MessagePartsRenderer
            content={activeVersion.content}
            activities={activeVersion.activities}
            parts={activeVersion.parts}
            sessionId={activeVersion.sessionId}
            environment={chatEnvironment}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

export const AssistantMessage = React.memo(function AssistantMessage({
  message,
  onRetry,
}: {
  message: StudioMessage
  onRetry: (message: StudioMessage) => void
}) {
  const { t } = useI18n()
  const [liked, setLiked] = React.useState<boolean | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [versionsOpen, setVersionsOpen] = React.useState(false)
  const [chatEnvironment] = useChatEnvironment()
  const copyableContent = message.content || message.reasoningContent
  const modelLabel = getStoredChatModelLabel(message.model)
  const showTopLevelReasoning = !hasRenderableReasoningParts(message.parts)
  const isStreaming = message.status === "streaming"
  const hasStreamingContent =
    message.content.trim().length > 0 ||
    message.reasoningContent.trim().length > 0 ||
    message.activities.length > 0 ||
    message.parts.length > 0

  function handleCopy() {
    void navigator.clipboard.writeText(copyableContent)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Message className="justify-start">
      <div className="flex w-full flex-col gap-2">
        {showTopLevelReasoning ? (
          <AssistantReasoning
            content={message.reasoningContent}
            durationMs={message.reasoningDurationMs}
            isStreaming={isStreaming && message.reasoningDurationMs === null}
          />
        ) : null}
        {isStreaming && !hasStreamingContent ? (
          <Shimmer className="text-sm">{t.studioThinking}</Shimmer>
        ) : (
          <MessagePartsRenderer
            content={message.content}
            activities={message.activities}
            parts={message.parts}
            sessionId={message.sessionId}
            streaming={isStreaming}
            environment={chatEnvironment}
          />
        )}
        {!isStreaming ? (
          <MessageActions className="gap-1.5">
            {message.versionCount > 1 ? (
              <MessageAction tooltip={t.studioViewVersions}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 rounded-xl px-2"
                  onClick={() => setVersionsOpen(true)}
                >
                  <span className="text-sm font-medium">
                    {message.versionCount}
                  </span>
                  <RiRefreshLine className="size-4" aria-hidden />
                </Button>
              </MessageAction>
            ) : null}

            <MessageAction
              tooltip={
                <span className="flex flex-col items-center gap-0.5">
                  <span>{t.studioRetry}</span>
                  {modelLabel ? (
                    <span className="text-[11px] text-background/70">
                      {t.studioUsedModel(modelLabel)}
                    </span>
                  ) : null}
                </span>
              }
            >
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-full"
                onClick={() => onRetry(message)}
              >
                <RiRefreshLine aria-hidden />
              </Button>
            </MessageAction>

            <MessageAction tooltip={copied ? t.copied : t.studioCopy}>
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-full"
                onClick={handleCopy}
              >
                <RiFileCopyLine
                  className={cn(copied && "text-primary")}
                  aria-hidden
                />
              </Button>
            </MessageAction>

            <MessageAction tooltip="Helpful">
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "rounded-full",
                  liked === true && "bg-primary/10 text-primary"
                )}
                onClick={() => setLiked(true)}
              >
                <RiThumbUpLine aria-hidden />
              </Button>
            </MessageAction>

            <MessageAction tooltip="Not helpful">
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "rounded-full",
                  liked === false && "bg-red-50 text-red-600"
                )}
                onClick={() => setLiked(false)}
              >
                <RiThumbDownLine aria-hidden />
              </Button>
            </MessageAction>
          </MessageActions>
        ) : null}
        <MessageVersionsDialog
          message={message}
          open={versionsOpen}
          onOpenChange={setVersionsOpen}
        />
      </div>
    </Message>
  )
})
