import * as React from "react"
import {
  RiArrowDownSLine,
  RiBookOpenLine,
  RiCheckLine,
  RiCloseLine,
  RiCodeLine,
  RiExternalLinkLine,
  RiFileTextLine,
  RiImageLine,
  RiSearchLine,
  RiSparklingLine,
  RiTerminalLine,
  RiVideoLine,
} from "@remixicon/react"

import {
  CodeBlock,
  CodeBlockCode,
  CodeBlockGroup,
} from "@/components/prompt-kit/code-block"
import { useI18n } from "@/components/i18n-provider"
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
  ChainOfThoughtTrigger,
} from "@/components/ui/chain-of-thought"
import { CollapsibleContent } from "@/components/ui/collapsible"
import { isMcpToolName } from "@/lib/mcp"
import type { StudioMessageActivity } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

import {
  FileDiffView,
  getWrittenFileInfo,
  isPreviewableWrittenFile,
  WrittenFileOpenCard,
} from "./file-output"
import {
  assistantTraceContainerClassName,
  assistantTraceTriggerClassName,
  commandToolNames,
  fileToolNames,
  getRunCodePayload,
  getRunCommandPayload,
  mediaToolNames,
  skillToolNames,
  SuppressWrittenFileOpenCardsContext,
  useMessageRenderEnvironment,
} from "./shared"
import { renderActivityInlineLabel } from "./tool-labels"
import {
  getActivityDetailOutput,
  getActivityFailureOutput,
  parseSandboxToolOutput,
  SandboxToolOutput,
  ToolActivityDetails,
  useLazyToolActivityDetails,
} from "./tool-output"

function InlineToolActivity({
  activity,
  leftIcon,
  renderDetails,
}: {
  activity: StudioMessageActivity
  leftIcon: React.ReactNode
  renderDetails?: (activity: StudioMessageActivity) => React.ReactNode
}) {
  const { t } = useI18n()
  const defaultOpen = activity.status === "error"
  const { open, onOpenChange, shouldRenderDetails } =
    useLazyToolActivityDetails(defaultOpen, `${activity.id}:${activity.status}`)

  return (
    <ChainOfThought className={assistantTraceContainerClassName}>
      <ChainOfThoughtStep
        key={`${activity.id}-${activity.status}`}
        open={open}
        onOpenChange={onOpenChange}
      >
        <ChainOfThoughtTrigger
          className={assistantTraceTriggerClassName}
          leftIcon={leftIcon}
        >
          {renderActivityInlineLabel(activity, t)}
        </ChainOfThoughtTrigger>
        <ChainOfThoughtContent>
          {shouldRenderDetails ? (
            renderDetails ? (
              renderDetails(activity)
            ) : (
              <ToolActivityDetails activity={activity} />
            )
          ) : null}
        </ChainOfThoughtContent>
      </ChainOfThoughtStep>
    </ChainOfThought>
  )
}

function FileToolActivity({ activity }: { activity: StudioMessageActivity }) {
  if (activity.toolName === "write_file" || activity.toolName === "edit_file") {
    return <FileWriteActivity activity={activity} />
  }

  return (
    <InlineToolActivity
      activity={activity}
      leftIcon={
        activity.status === "complete" ? (
          <RiCheckLine aria-hidden className="size-4" />
        ) : (
          <RiFileTextLine aria-hidden className="size-4" />
        )
      }
    />
  )
}

function FileWriteActivity({ activity }: { activity: StudioMessageActivity }) {
  const { t } = useI18n()
  const environment = useMessageRenderEnvironment()
  const suppressOpenCard = React.useContext(SuppressWrittenFileOpenCardsContext)
  const info = getWrittenFileInfo(activity)

  if (!info) {
    return (
      <InlineToolActivity
        activity={activity}
        leftIcon={
          activity.status === "complete" ? (
            <RiCheckLine aria-hidden className="size-4" />
          ) : (
            <RiFileTextLine aria-hidden className="size-4" />
          )
        }
      />
    )
  }

  const showOpenCard =
    environment === "local" &&
    !suppressOpenCard &&
    activity.status === "complete" &&
    isPreviewableWrittenFile(info.path)
  const failureOutput =
    activity.status === "error" ? getActivityDetailOutput(activity, t) : ""

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <InlineToolActivity
        activity={activity}
        leftIcon={
          activity.status === "complete" ? (
            <RiCheckLine aria-hidden className="size-4" />
          ) : (
            <RiFileTextLine aria-hidden className="size-4" />
          )
        }
        renderDetails={() => (
          <div className="space-y-2 border-l pl-3">
            <FileDiffView info={info} />
            {failureOutput ? (
              <>
                <div className="text-xs font-semibold text-destructive uppercase">
                  {t.studioToolError}
                </div>
                <SandboxToolOutput output={failureOutput} />
              </>
            ) : null}
          </div>
        )}
      />
      {showOpenCard ? <WrittenFileOpenCard info={info} /> : null}
    </div>
  )
}

function GenericToolActivity({
  activity,
}: {
  activity: StudioMessageActivity
}) {
  const { t } = useI18n()
  const defaultOpen = activity.status === "error"
  const { open, onOpenChange, shouldRenderDetails } =
    useLazyToolActivityDetails(defaultOpen, `${activity.id}:${activity.status}`)

  return (
    <ChainOfThought className={assistantTraceContainerClassName}>
      <ChainOfThoughtStep
        key={`${activity.id}-${activity.status}`}
        open={open}
        onOpenChange={onOpenChange}
      >
        <ChainOfThoughtTrigger
          className={assistantTraceTriggerClassName}
          leftIcon={
            activity.status === "complete" ? (
              <RiCheckLine aria-hidden className="size-4" />
            ) : (
              <RiTerminalLine aria-hidden className="size-4" />
            )
          }
        >
          {renderActivityInlineLabel(activity, t)}
        </ChainOfThoughtTrigger>

        <ChainOfThoughtContent>
          {shouldRenderDetails ? (
            <ToolActivityDetails activity={activity} />
          ) : null}
        </ChainOfThoughtContent>
      </ChainOfThoughtStep>
    </ChainOfThought>
  )
}

function getCommandTranscriptOutput(output: string) {
  const parsed = parseSandboxToolOutput(output)
  const structuredOutput = [
    parsed.stdout,
    parsed.results,
    parsed.stderr,
    parsed.error,
  ]
    .map((section) => section.trim())
    .filter(Boolean)
    .join("\n\n")

  return (structuredOutput || output.trim())
    .replace(/^\[Command (?:succeeded|failed) with exit code \d+\]\s*/i, "")
    .replace(/\n+\[Command (?:succeeded|failed) with exit code \d+\]\s*$/i, "")
    .trim()
}

function ShellTranscriptCard({
  command,
  output,
  status,
}: {
  command: string
  output: string
  status: StudioMessageActivity["status"]
}) {
  const { t } = useI18n()
  const transcriptOutput = getCommandTranscriptOutput(output)
  const failed = status === "error"

  return (
    <div className="relative min-h-[92px] overflow-hidden rounded-[14px] bg-muted px-3.5 pt-2.5 pb-8 text-foreground/90">
      <div className="mb-3 text-xs leading-none text-muted-foreground">
        Shell
      </div>
      <pre className="m-0 overflow-x-auto font-mono text-[13px] leading-6 whitespace-pre-wrap">
        <span className="text-foreground">$</span>{" "}
        <span className="text-foreground">{command || "command"}</span>
        {transcriptOutput ? (
          <>
            {"\n"}
            <span className="text-muted-foreground">{transcriptOutput}</span>
          </>
        ) : null}
      </pre>
      {status === "running" ? null : (
        <div
          className={cn(
            "absolute right-3.5 bottom-2.5 flex items-center gap-1.5 text-xs font-medium",
            failed ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {failed ? (
            <RiCloseLine aria-hidden className="size-3.5" />
          ) : (
            <RiCheckLine aria-hidden className="size-3.5" />
          )}
          <span>{failed ? t.studioToolFailed : t.studioToolSucceeded}</span>
        </div>
      )}
    </div>
  )
}

function RunCommandActivity({ activity }: { activity: StudioMessageActivity }) {
  const { t } = useI18n()
  const payload = getRunCommandPayload(activity.input)
  const output =
    activity.status === "error"
      ? getActivityFailureOutput(activity, t)
      : activity.output.trim()
  // Auto-expand while the command is running and streaming output, so live
  // stdout is visible without a click; collapse again once it settles.
  const defaultOpen =
    activity.status === "error" ||
    (activity.status === "running" && Boolean(output))
  const { open, onOpenChange, shouldRenderDetails } = useLazyToolActivityDetails(
    defaultOpen,
    `${activity.id}:${activity.status}:${output ? "output" : "empty"}`
  )

  return (
    <ChainOfThought className={assistantTraceContainerClassName}>
      <ChainOfThoughtStep
        key={`${activity.id}-${activity.status}`}
        open={open}
        onOpenChange={onOpenChange}
      >
        <ChainOfThoughtTrigger
          className={cn(assistantTraceTriggerClassName, "w-fit")}
          leftIcon={<RiTerminalLine aria-hidden className="size-4" />}
          swapIconOnHover={false}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {renderActivityInlineLabel(activity, t)}
            <RiArrowDownSLine
              aria-hidden
              className="size-4 shrink-0 text-current transition-transform group-data-[state=open]:rotate-180"
            />
          </span>
        </ChainOfThoughtTrigger>

        <CollapsibleContent className="mt-3 overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          {shouldRenderDetails ? (
            <ShellTranscriptCard
              command={payload.command}
              output={output}
              status={activity.status}
            />
          ) : null}
        </CollapsibleContent>
      </ChainOfThoughtStep>
    </ChainOfThought>
  )
}

function RunCodeActivity({ activity }: { activity: StudioMessageActivity }) {
  const { t } = useI18n()
  const payload = getRunCodePayload(activity.input)
  const output =
    activity.status === "error"
      ? getActivityFailureOutput(activity, t)
      : activity.output.trim()
  const lifecycleLabel =
    payload.autoPause === null
      ? null
      : payload.autoPause
        ? t.studioToolAutoPause
        : t.studioToolKillAfterRun
  const defaultOpen = activity.status === "error"
  const { open, onOpenChange, shouldRenderDetails } =
    useLazyToolActivityDetails(defaultOpen, `${activity.id}:${activity.status}`)

  return (
    <ChainOfThought className={assistantTraceContainerClassName}>
      <ChainOfThoughtStep
        key={`${activity.id}-${activity.status}`}
        open={open}
        onOpenChange={onOpenChange}
      >
        <ChainOfThoughtTrigger
          className={assistantTraceTriggerClassName}
          leftIcon={
            activity.status === "complete" ? (
              <RiCheckLine aria-hidden className="size-4" />
            ) : (
              <RiCodeLine aria-hidden className="size-4" />
            )
          }
        >
          {renderActivityInlineLabel(activity, t)}
        </ChainOfThoughtTrigger>

        <ChainOfThoughtContent>
          {shouldRenderDetails ? (
            <>
              <CodeBlock className="rounded-2xl shadow-sm">
                <CodeBlockGroup className="gap-3 border-b bg-muted/40 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <RiCodeLine
                      aria-hidden
                      className="size-4 text-muted-foreground"
                    />
                    <span className="truncate text-sm font-medium">
                      {t.input} · {payload.language}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {lifecycleLabel ? <span>{lifecycleLabel}</span> : null}
                    {payload.sandboxId ? (
                      <span className="max-w-40 truncate">
                        {payload.sandboxId}
                      </span>
                    ) : null}
                  </div>
                </CodeBlockGroup>
                <CodeBlockCode
                  code={payload.code}
                  language={payload.language}
                />
              </CodeBlock>

              {activity.status === "running" ? null : (
                <div className="space-y-2 border-l pl-3">
                  <div
                    className={cn(
                      "text-xs font-semibold uppercase",
                      activity.status === "error"
                        ? "text-destructive"
                        : "text-muted-foreground"
                    )}
                  >
                    {activity.status === "error" ? t.studioToolError : t.output}
                  </div>
                  {output ? (
                    <SandboxToolOutput output={output} />
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      {t.studioToolNoOutput}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}
        </ChainOfThoughtContent>
      </ChainOfThoughtStep>
    </ChainOfThought>
  )
}

function SandboxHostActivity({
  activity,
}: {
  activity: StudioMessageActivity
}) {
  const { t } = useI18n()
  const defaultOpen = activity.status === "error"
  const { open, onOpenChange, shouldRenderDetails } =
    useLazyToolActivityDetails(defaultOpen, `${activity.id}:${activity.status}`)

  return (
    <ChainOfThought className={assistantTraceContainerClassName}>
      <ChainOfThoughtStep
        key={`${activity.id}-${activity.status}`}
        open={open}
        onOpenChange={onOpenChange}
      >
        <ChainOfThoughtTrigger
          className={assistantTraceTriggerClassName}
          leftIcon={
            activity.status === "complete" ? (
              <RiExternalLinkLine aria-hidden className="size-4" />
            ) : (
              <RiTerminalLine aria-hidden className="size-4" />
            )
          }
        >
          {renderActivityInlineLabel(activity, t)}
        </ChainOfThoughtTrigger>

        <ChainOfThoughtContent>
          {shouldRenderDetails ? (
            <ToolActivityDetails
              activity={activity}
              inputIcon={
                <RiTerminalLine
                  aria-hidden
                  className="size-4 text-muted-foreground"
                />
              }
            />
          ) : null}
        </ChainOfThoughtContent>
      </ChainOfThoughtStep>
    </ChainOfThought>
  )
}

type ToolActivityRendererEntry = {
  matches: (toolName: string) => boolean
  render: (activity: StudioMessageActivity) => React.ReactNode
}

function getCompletedAwareToolIcon(
  activity: StudioMessageActivity,
  pendingIcon: React.ReactNode
) {
  return activity.status === "complete" ? (
    <RiCheckLine aria-hidden className="size-4" />
  ) : (
    pendingIcon
  )
}

const toolActivityRendererRegistry: ToolActivityRendererEntry[] = [
  {
    matches: (toolName) => toolName === "run_code",
    render: (activity) => <RunCodeActivity activity={activity} />,
  },
  {
    matches: (toolName) => commandToolNames.has(toolName),
    render: (activity) => <RunCommandActivity activity={activity} />,
  },
  {
    matches: (toolName) => toolName === "sandbox_get_host",
    render: (activity) => <SandboxHostActivity activity={activity} />,
  },
  {
    matches: (toolName) => fileToolNames.has(toolName),
    render: (activity) => <FileToolActivity activity={activity} />,
  },
  {
    matches: (toolName) => skillToolNames.has(toolName),
    render: (activity) => (
      <InlineToolActivity
        activity={activity}
        leftIcon={getCompletedAwareToolIcon(
          activity,
          <RiBookOpenLine aria-hidden className="size-4" />
        )}
      />
    ),
  },
  {
    matches: (toolName) => mediaToolNames.has(toolName),
    render: (activity) => (
      <InlineToolActivity
        activity={activity}
        leftIcon={getCompletedAwareToolIcon(
          activity,
          activity.toolName === "studio_generate_image" ? (
            <RiImageLine aria-hidden className="size-4" />
          ) : activity.toolName === "studio_generate_video" ? (
            <RiVideoLine aria-hidden className="size-4" />
          ) : (
            <RiSparklingLine aria-hidden className="size-4" />
          )
        )}
      />
    ),
  },
  {
    matches: isMcpToolName,
    render: (activity) => (
      <InlineToolActivity
        activity={activity}
        leftIcon={getCompletedAwareToolIcon(
          activity,
          <RiExternalLinkLine aria-hidden className="size-4" />
        )}
      />
    ),
  },
  {
    matches: (toolName) =>
      toolName === "web_search" || toolName === "web_fetch",
    render: (activity) => (
      <InlineToolActivity
        activity={activity}
        leftIcon={getCompletedAwareToolIcon(
          activity,
          activity.toolName === "web_fetch" ? (
            <RiFileTextLine aria-hidden className="size-4" />
          ) : (
            <RiSearchLine aria-hidden className="size-4" />
          )
        )}
      />
    ),
  },
]

export function AssistantActivity({ activity }: { activity: StudioMessageActivity }) {
  const renderer = toolActivityRendererRegistry.find((entry) =>
    entry.matches(activity.toolName)
  )

  return renderer ? (
    renderer.render(activity)
  ) : (
    <GenericToolActivity activity={activity} />
  )
}
