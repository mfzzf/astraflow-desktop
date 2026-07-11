import { TextShimmer } from "@/components/prompt-kit/text-shimmer"
import { useI18n } from "@/components/i18n-provider"
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/prompt-kit/reasoning"
import { cn } from "@/lib/utils"

import {
  assistantTraceContainerClassName,
  reasoningMarkdownClassName,
  useMessageRenderEnvironment,
} from "./shared"
import type { MessageRenderEnvironment } from "./types"

function formatReasoningDuration(locale: "en" | "zh", durationMs: number) {
  const seconds = Math.max(1, Math.round(durationMs / 1000))

  if (locale === "zh") {
    return `思考了 ${seconds} 秒`
  }

  if (seconds <= 3) {
    return "Thought for a few seconds"
  }

  return `Thought for ${seconds} seconds`
}

export function AssistantReasoning({
  content,
  isStreaming = false,
  durationMs,
  environment,
}: {
  content: string
  isStreaming?: boolean
  durationMs?: number | null
  environment?: MessageRenderEnvironment
}) {
  const { locale, t } = useI18n()
  const contextEnvironment = useMessageRenderEnvironment()
  const renderEnvironment = environment ?? contextEnvironment

  if (!content.trim()) {
    return null
  }

  const label =
    durationMs === null || durationMs === undefined
      ? "Reasoning"
      : formatReasoningDuration(locale, durationMs)

  return (
    <Reasoning
      isStreaming={isStreaming}
      className={cn(assistantTraceContainerClassName, "flex flex-col")}
    >
      <ReasoningTrigger
        className={cn(
          "min-h-7 w-fit max-w-full text-sm leading-6",
          "[&>span]:min-w-0 [&>span]:truncate"
        )}
      >
        {isStreaming ? (
          <TextShimmer as="span">{t.studioThinking}</TextShimmer>
        ) : (
          label
        )}
      </ReasoningTrigger>
      <ReasoningContent
        markdown
        streaming={isStreaming}
        openLinksInWorkspace={renderEnvironment === "local"}
        className="ml-1.75 border-l border-l-border/70 pb-1 pl-6"
        contentClassName={reasoningMarkdownClassName}
      >
        {content}
      </ReasoningContent>
    </Reasoning>
  )
}
