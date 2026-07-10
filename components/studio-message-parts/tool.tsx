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
  getRunCommandActivityResult,
  getRunCodePayload,
  getRunCommandPayload,
  getRunCommandResult,
  isCommandProcessResult,
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
  const result = getRunCommandResult(output)
  const parsed = parseSandboxToolOutput(result.output)
  const structuredOutput = [
    parsed.stdout,
    parsed.results,
    parsed.stderr,
    parsed.error,
  ]
    .map((section) => section.trim())
    .filter(Boolean)
    .join("\n\n")

  return {
    output: (structuredOutput || result.output.trim())
      .replace(/^\[Command (?:succeeded|failed) with exit code \d+\]\s*/i, "")
      .replace(
        /\n+\[Command (?:succeeded|failed) with exit code \d+\]\s*$/i,
        ""
      )
      .trim(),
  }
}

function ShellTranscriptCard({
  command,
  cwd,
  exitCode,
  failed,
  output,
  status,
}: {
  command: string
  cwd: string | null
  exitCode: number | null
  failed: boolean
  output: string
  status: StudioMessageActivity["status"]
}) {
  const { t } = useI18n()
  const transcript = getCommandTranscriptOutput(output)
  const didFail =
    failed || status === "error" || (exitCode !== null && exitCode !== 0)
  const statusLabel =
    exitCode !== null && exitCode !== 0
      ? t.studioToolExitCode(exitCode)
      : didFail
        ? t.studioToolFailed
        : t.studioToolSucceeded

  return (
    <div className="relative min-h-[92px] overflow-hidden rounded-[14px] bg-muted px-3.5 pt-2.5 pb-8 text-foreground/90">
      <div className="mb-3 flex min-w-0 items-center justify-between gap-3 text-xs leading-none text-muted-foreground">
        <span>Shell</span>
        {cwd ? (
          <span className="min-w-0 truncate font-mono" title={cwd}>
            {cwd}
          </span>
        ) : null}
      </div>
      <pre className="m-0 max-h-[140px] overflow-auto font-mono text-[13px] leading-6 whitespace-pre-wrap">
        <span className="text-foreground">$</span>{" "}
        <span className="text-foreground">{command || "command"}</span>
        {transcript.output ? (
          <>
            {"\n"}
            <span className="text-muted-foreground">{transcript.output}</span>
          </>
        ) : null}
      </pre>
      {status === "running" ? null : (
        <div
          className={cn(
            "absolute right-3.5 bottom-2.5 flex items-center gap-1.5 text-xs font-medium",
            didFail ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {didFail ? (
            <RiCloseLine aria-hidden className="size-3.5" />
          ) : (
            <RiCheckLine aria-hidden className="size-3.5" />
          )}
          <span>{statusLabel}</span>
        </div>
      )}
    </div>
  )
}

function RunCommandActivity({ activity }: { activity: StudioMessageActivity }) {
  const { t } = useI18n()
  const payload = getRunCommandPayload(activity.input)
  const commandResult = getRunCommandActivityResult(activity)
  const isProcessResult = isCommandProcessResult(activity)
  const displayActivity: StudioMessageActivity = isProcessResult
    ? {
        ...activity,
        status: "complete",
        output: commandResult.rawOutput,
        error: null,
      }
    : activity
  const output = isProcessResult
    ? commandResult.output
    : activity.status === "error"
      ? getActivityFailureOutput(activity, t)
      : activity.output.trim()
  // Auto-expand while the command is running and streaming output, so live
  // stdout is visible without a click; collapse again once it settles.
  const defaultOpen =
    commandResult.failed ||
    displayActivity.status === "error" ||
    (displayActivity.status === "running" && Boolean(output))
  const { open, onOpenChange, shouldRenderDetails } =
    useLazyToolActivityDetails(
      defaultOpen,
      `${activity.id}:${displayActivity.status}:${output ? "output" : "empty"}`
    )

  return (
    <ChainOfThought className={assistantTraceContainerClassName}>
      <ChainOfThoughtStep
        key={`${activity.id}-${displayActivity.status}`}
        open={open}
        onOpenChange={onOpenChange}
      >
        <ChainOfThoughtTrigger
          className={cn(assistantTraceTriggerClassName, "w-fit")}
          leftIcon={<RiTerminalLine aria-hidden className="size-4" />}
          swapIconOnHover={false}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {renderActivityInlineLabel(displayActivity, t)}
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
              cwd={payload.cwd}
              exitCode={commandResult.exitCode}
              failed={commandResult.failed}
              output={output}
              status={commandResult.failed ? "error" : displayActivity.status}
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
    matches: (toolName) =>
      toolName === "spawn_agent" || toolName === "update_plan",
    render: (activity) => (
      <InlineToolActivity
        activity={activity}
        leftIcon={getCompletedAwareToolIcon(
          activity,
          <RiSparklingLine aria-hidden className="size-4" />
        )}
      />
    ),
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
