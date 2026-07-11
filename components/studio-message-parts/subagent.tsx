import { TextShimmer } from "@/components/prompt-kit/text-shimmer"
import { useI18n } from "@/components/i18n-provider"
import { StudioAgentGlyph } from "@/components/studio-agent-glyph"
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
  ChainOfThoughtTrigger,
} from "@/components/ui/chain-of-thought"
import { MessageContent } from "@/components/ui/message"
import { cn } from "@/lib/utils"

import { AssistantPlan } from "./plan-todo"
import {
  assistantTraceContainerClassName,
  assistantTraceLabelClassName,
  assistantTraceTriggerClassName,
  isZhLocale,
  markdownClassName,
  streamingPulseDotClassName,
  useMessageRenderEnvironment,
} from "./shared"
import { AssistantActivity } from "./tool"
import { useLazyToolActivityDetails } from "./tool-output"
import type { StudioSubagentPart } from "./types"

function getSubagentLabel(
  part: StudioSubagentPart,
  t: ReturnType<typeof useI18n>["t"]
) {
  const isZh = isZhLocale(t)

  if (part.status === "running") {
    return isZh
      ? `正在运行子代理 ${part.name}`
      : `Running subagent ${part.name}`
  }

  if (part.status === "error") {
    return isZh ? `子代理失败 ${part.name}` : `Subagent failed ${part.name}`
  }

  if (part.status === "cancelled") {
    return isZh
      ? `已取消子代理 ${part.name}`
      : `Cancelled subagent ${part.name}`
  }

  return isZh ? `已完成子代理 ${part.name}` : `Completed subagent ${part.name}`
}

export function AssistantSubagent({ part }: { part: StudioSubagentPart }) {
  const { t } = useI18n()
  const environment = useMessageRenderEnvironment()
  const defaultOpen =
    part.status === "running" ||
    part.status === "error" ||
    part.activities.some((activity) => activity.status === "error")
  const { open, onOpenChange, shouldRenderDetails } =
    useLazyToolActivityDetails(defaultOpen, part.id)
  const body = part.summary?.trim() || part.content.trim()
  const error = part.error?.trim()

  return (
    <ChainOfThought
      className={cn(
        assistantTraceContainerClassName,
        part.parentTaskId && "ml-4 border-l border-border/60 pl-2"
      )}
    >
      <ChainOfThoughtStep
        key={`${part.id}-${part.status}`}
        open={open}
        onOpenChange={onOpenChange}
      >
        <ChainOfThoughtTrigger
          className={assistantTraceTriggerClassName}
          leftIcon={
            <StudioAgentGlyph
              identity={part.taskId || part.name}
              status={part.status}
              className="size-4"
            />
          }
        >
          <span className={assistantTraceLabelClassName}>
            {part.status === "running" ? (
              <TextShimmer as="span">{getSubagentLabel(part, t)}</TextShimmer>
            ) : (
              getSubagentLabel(part, t)
            )}
          </span>
        </ChainOfThoughtTrigger>

        <ChainOfThoughtContent>
          {shouldRenderDetails ? (
            <div className="flex flex-col gap-2 border-l pl-3">
              {part.taskInput.trim() ? (
                <pre className="max-h-28 overflow-auto rounded-xl bg-muted/45 px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap text-foreground">
                  {part.taskInput.trim()}
                </pre>
              ) : null}

              {part.todos.length > 0 ? (
                <AssistantPlan todos={part.todos} />
              ) : null}

              {part.activities.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {part.activities.map((activity) => (
                    <AssistantActivity key={activity.id} activity={activity} />
                  ))}
                </div>
              ) : null}

              {body ? (
                <MessageContent
                  markdown
                  openLinksInWorkspace={environment === "local"}
                  streaming={part.status === "running"}
                  className={cn(
                    "bg-transparent p-0",
                    markdownClassName,
                    part.status === "running" && streamingPulseDotClassName
                  )}
                >
                  {body}
                </MessageContent>
              ) : null}

              {error ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              ) : null}
            </div>
          ) : null}
        </ChainOfThoughtContent>
      </ChainOfThoughtStep>
    </ChainOfThought>
  )
}
