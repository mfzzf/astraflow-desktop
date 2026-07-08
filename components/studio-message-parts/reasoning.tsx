import { Shimmer } from "@/components/ai-elements/shimmer"
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
} from "./shared"

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
}: {
  content: string
  isStreaming?: boolean
  durationMs?: number | null
}) {
  const { locale, t } = useI18n()

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
        {isStreaming ? <Shimmer as="span">{t.studioThinking}</Shimmer> : label}
      </ReasoningTrigger>
      <ReasoningContent
        markdown
        streaming={isStreaming}
        className="ml-1.75 border-l border-l-border/70 pb-1 pl-6"
        contentClassName={reasoningMarkdownClassName}
      >
        {content}
      </ReasoningContent>
    </Reasoning>
  )
}
