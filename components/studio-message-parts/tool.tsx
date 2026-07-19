import * as React from "react"
import {
  IconArrowRight,
  IconArrowsExchange,
  IconBook2,
  IconCheck,
  IconClock,
  IconCode,
  IconExternalLink,
  IconFileText,
  IconPencil,
  IconPhoto,
  IconSearch,
  IconSparkles,
  IconTerminal2,
  IconTrash,
  IconVideo,
  IconX,
} from "@tabler/icons-react"

import { CentralIcon } from "@/components/central-icon"
import { Shimmer } from "@/components/ai-elements/shimmer"
import { SynaraCodeBlock } from "@/components/synara-code-block"
import { useI18n } from "@/components/i18n-provider"
import { DisclosureChevron } from "@/components/ui/disclosure-chevron"
import {
  SynaraCollapsible,
  SynaraCollapsiblePanel,
  SynaraCollapsibleTrigger,
} from "@/components/ui/synara-collapsible"
import {
  SynaraTooltip,
  SynaraTooltipPopup,
  SynaraTooltipTrigger,
} from "@/components/ui/synara-tooltip"
import { isMcpToolName } from "@/lib/mcp"
import {
  deriveSynaraReadableCommandDisplay,
  resolveSynaraCommandVisualKind,
} from "@/lib/synara-tool-call-label"
import type { StudioMessageActivity } from "@/lib/studio-types"

import {
  FileDiffView,
  getWrittenFileInfo,
  isPreviewableWrittenFile,
  WrittenFileOpenCard,
} from "./file-output"
import {
  commandToolNames,
  fileToolNames,
  getRunCommandActivityResult,
  getRunCodePayload,
  getRunCommandPayload,
  isCommandProcessResult,
  mediaToolNames,
  skillToolNames,
  SuppressWrittenFileOpenCardsContext,
  useMessageRenderEnvironment,
} from "./shared"
import {
  getActivityLabel,
  isMcpToolActivity,
  renderActivityInlineLabel,
} from "./tool-labels"
import {
  getActivityDetailOutput,
  getActivityFailureOutput,
  SandboxToolOutput,
  ToolActivityDetails,
  useLazyToolActivityDetails,
} from "./tool-output"

function stringifyToolCall(value: unknown) {
  if (typeof value === "string") return value.trim()
  if (value === null || value === undefined) return ""

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function activityRawCall(activity: StudioMessageActivity) {
  if (commandToolNames.has(activity.toolName)) {
    return getRunCommandPayload(activity.input).command
  }

  return (
    stringifyToolCall(activity.rawInput) ||
    stringifyToolCall(activity.input) ||
    activity.toolName
  )
}

function SynaraToolDisclosure({
  activity,
  leftIcon,
  renderDetails,
  autoOpenWhileRunning = false,
  defaultOpen: defaultOpenOverride,
  summary: summaryOverride,
  rawCall: rawCallOverride,
}: {
  activity: StudioMessageActivity
  leftIcon: React.ReactNode
  renderDetails?: (activity: StudioMessageActivity) => React.ReactNode
  autoOpenWhileRunning?: boolean
  defaultOpen?: boolean
  summary?: string
  rawCall?: string
}) {
  const { t } = useI18n()
  const hasInput = Boolean(activity.input.trim())
  const defaultOpen =
    defaultOpenOverride ??
    (activity.status === "error" ||
      (autoOpenWhileRunning && activity.status === "running" && hasInput))
  const resetKey = [
    activity.id,
    activity.status,
    autoOpenWhileRunning ? (hasInput ? "input" : "empty") : "static",
  ].join(":")
  const { open, onOpenChange, shouldRenderDetails } =
    useLazyToolActivityDetails(defaultOpen, resetKey)
  const summary = summaryOverride ?? getActivityLabel(activity, t)
  const rawCall = rawCallOverride ?? activityRawCall(activity)

  return (
    <div className="not-prose py-0.5 text-muted-foreground">
      <SynaraCollapsible
        open={open}
        onOpenChange={onOpenChange}
        className="group/tool-details min-w-0"
      >
        <SynaraTooltip>
          <SynaraTooltipTrigger
            render={
              <SynaraCollapsibleTrigger className="group/tool-row flex w-fit max-w-full items-center gap-1.5 text-left text-sm leading-5 text-muted-foreground/70 transition-colors duration-200 hover:text-foreground focus-visible:text-foreground focus-visible:outline-none" />
            }
          >
            <span className="inline-flex size-4 shrink-0 items-center justify-center">
              {leftIcon}
            </span>
            <span className="min-w-0 truncate">
              {summaryOverride ? (
                activity.status === "running" ? (
                  <Shimmer as="span">{summary}</Shimmer>
                ) : (
                  summary
                )
              ) : (
                renderActivityInlineLabel(activity, t)
              )}
            </span>
            <DisclosureChevron
              open={open}
              className="text-muted-foreground/45 group-hover/tool-row:text-foreground"
            />
          </SynaraTooltipTrigger>
          <SynaraTooltipPopup
            side="top"
            align="start"
            className="max-w-96 whitespace-normal"
          >
            <div className="max-w-96 space-y-2 whitespace-pre-wrap leading-tight">
              <div className="space-y-0.5">
                <div className="text-muted-foreground/70">Summary</div>
                <div>{summary}</div>
              </div>
              {rawCall ? (
                <div className="space-y-0.5">
                  <div className="text-muted-foreground/70">Raw call</div>
                  <code className="block whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/92">
                    {rawCall}
                  </code>
                </div>
              ) : null}
            </div>
          </SynaraTooltipPopup>
        </SynaraTooltip>

        <SynaraCollapsiblePanel>
          <div className="min-w-0 pt-2 pl-5">
            {shouldRenderDetails
              ? renderDetails?.(activity) ?? (
                  <ToolActivityDetails activity={activity} />
                )
              : null}
          </div>
        </SynaraCollapsiblePanel>
      </SynaraCollapsible>
    </div>
  )
}

function InlineToolActivity({
  activity,
  leftIcon,
  renderDetails,
  autoOpenWhileRunning = false,
}: {
  activity: StudioMessageActivity
  leftIcon: React.ReactNode
  renderDetails?: (activity: StudioMessageActivity) => React.ReactNode
  autoOpenWhileRunning?: boolean
}) {
  return (
    <SynaraToolDisclosure
      activity={activity}
      autoOpenWhileRunning={autoOpenWhileRunning}
      leftIcon={leftIcon}
      renderDetails={renderDetails}
    />
  )
}

// Write-like tools produce long streamed arguments (file contents); their
// activity rows auto-expand while the model is still generating the input.
const STREAMING_INPUT_FILE_TOOL_NAMES = new Set([
  "write",
  "edit",
  "write_file",
  "edit_file",
])

function isStreamingInputFileTool(toolName: string) {
  return STREAMING_INPUT_FILE_TOOL_NAMES.has(toolName)
}

function FileToolActivity({ activity }: { activity: StudioMessageActivity }) {
  if (activity.toolName === "write_file" || activity.toolName === "edit_file") {
    return <FileWriteActivity activity={activity} />
  }

  return (
    <InlineToolActivity
      activity={activity}
      autoOpenWhileRunning={isStreamingInputFileTool(activity.toolName)}
      leftIcon={
        activity.status === "complete" ? (
          <IconCheck aria-hidden className="size-4" />
        ) : (
          <IconFileText aria-hidden className="size-4" />
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
        autoOpenWhileRunning={isStreamingInputFileTool(activity.toolName)}
        leftIcon={
          activity.status === "complete" ? (
            <IconCheck aria-hidden className="size-4" />
          ) : (
            <IconFileText aria-hidden className="size-4" />
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
            <IconCheck aria-hidden className="size-4" />
          ) : (
            <IconFileText aria-hidden className="size-4" />
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
  return (
    <SynaraToolDisclosure
      activity={activity}
      leftIcon={<ProtocolToolStatusIcon activity={activity} />}
    />
  )
}

export function getProtocolToolIconName(activity: StudioMessageActivity) {
  if (isMcpToolActivity(activity)) {
    return "mcp"
  }

  return activity.kind ?? "other"
}

export function getProtocolToolStatusIconName(
  activity: StudioMessageActivity
) {
  if (activity.status === "complete") {
    return "complete"
  }

  if (activity.status === "error") {
    return "error"
  }

  if (activity.acpStatus === "pending") {
    return "pending"
  }

  return getProtocolToolIconName(activity)
}

function ProtocolToolStatusIcon({
  activity,
}: {
  activity: StudioMessageActivity
}) {
  const statusIcon = getProtocolToolStatusIconName(activity)

  if (statusIcon === "complete") {
    return <IconCheck aria-hidden className="size-4" />
  }

  if (statusIcon === "error") {
    return <IconX aria-hidden className="size-4" />
  }

  if (statusIcon === "pending") {
    return (
      <IconClock
        aria-hidden
        className="size-4 text-amber-600 dark:text-amber-400"
      />
    )
  }

  return <ProtocolToolKindIcon activity={activity} />
}

function ProtocolToolKindIcon({
  activity,
}: {
  activity: StudioMessageActivity
}) {
  const iconClassName = "size-4"

  switch (getProtocolToolIconName(activity)) {
    case "mcp":
    case "fetch":
      return <IconExternalLink aria-hidden className={iconClassName} />
    case "read":
      return <IconBook2 aria-hidden className={iconClassName} />
    case "edit":
      return <IconPencil aria-hidden className={iconClassName} />
    case "delete":
      return <IconTrash aria-hidden className={iconClassName} />
    case "move":
      return <IconArrowRight aria-hidden className={iconClassName} />
    case "search":
      return <IconSearch aria-hidden className={iconClassName} />
    case "execute":
      return <IconTerminal2 aria-hidden className={iconClassName} />
    case "think":
      return <IconSparkles aria-hidden className={iconClassName} />
    case "switch_mode":
      return <IconArrowsExchange aria-hidden className={iconClassName} />
    default:
      return <IconCode aria-hidden className={iconClassName} />
  }
}

function commandTranscript(command: string, output: string) {
  return [`$ ${command || "command"}`, output.trim()]
    .filter(Boolean)
    .join("\n")
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
  const commandDisplay = deriveSynaraReadableCommandDisplay(
    payload.command,
    displayActivity.status === "running"
  )
  const displayText = `${commandDisplay.verb} ${commandDisplay.target}`
  const visualKind = resolveSynaraCommandVisualKind(payload.command)
  const iconName = visualKind === "inspect" ? "magnifying-glass" : "console"

  return (
    <SynaraToolDisclosure
      activity={displayActivity}
      defaultOpen={
        commandResult.failed ||
        displayActivity.status === "error" ||
        (displayActivity.status === "running" && Boolean(output))
      }
      leftIcon={<CentralIcon name={iconName} className="size-4" />}
      rawCall={payload.command}
      summary={displayText}
      renderDetails={() => (
        <SynaraCodeBlock
          code={commandTranscript(payload.command, output)}
          language="bash"
        />
      )}
    />
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

  return (
    <SynaraToolDisclosure
      activity={activity}
      defaultOpen={defaultOpen}
      leftIcon={
        activity.status === "complete" ? (
          <IconCheck aria-hidden className="size-4" />
        ) : (
          <IconCode aria-hidden className="size-4" />
        )
      }
      renderDetails={() => (
        <div className="flex min-w-0 flex-col gap-2">
          {lifecycleLabel || payload.sandboxId ? (
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {lifecycleLabel ? <span>{lifecycleLabel}</span> : null}
              {payload.sandboxId ? <span>{payload.sandboxId}</span> : null}
            </div>
          ) : null}
          <SynaraCodeBlock code={payload.code} language={payload.language} />
          {activity.status === "running" ? null : output ? (
            <SynaraCodeBlock code={output} language="text" />
          ) : (
            <div className="text-sm text-muted-foreground">
              {t.studioToolNoOutput}
            </div>
          )}
        </div>
      )}
    />
  )
}

function SandboxHostActivity({
  activity,
}: {
  activity: StudioMessageActivity
}) {
  const defaultOpen = activity.status === "error"

  return (
    <SynaraToolDisclosure
      activity={activity}
      defaultOpen={defaultOpen}
      leftIcon={
        activity.status === "complete" ? (
          <IconExternalLink aria-hidden className="size-4" />
        ) : (
          <IconTerminal2 aria-hidden className="size-4" />
        )
      }
      renderDetails={() => (
        <ToolActivityDetails
          activity={activity}
          inputIcon={
            <IconTerminal2
              aria-hidden
              className="size-4 text-muted-foreground"
            />
          }
        />
      )}
    />
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
    <IconCheck aria-hidden className="size-4" />
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
          <IconSparkles aria-hidden className="size-4" />
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
          <IconBook2 aria-hidden className="size-4" />
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
            <IconPhoto aria-hidden className="size-4" />
          ) : activity.toolName === "studio_generate_video" ? (
            <IconVideo aria-hidden className="size-4" />
          ) : (
            <IconSparkles aria-hidden className="size-4" />
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
          <IconExternalLink aria-hidden className="size-4" />
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
            <IconFileText aria-hidden className="size-4" />
          ) : (
            <IconSearch aria-hidden className="size-4" />
          )
        )}
      />
    ),
  },
]

export function AssistantActivity({
  activity,
}: {
  activity: StudioMessageActivity
}) {
  const hasProtocolDetails =
    Boolean(activity.content?.length) ||
    Boolean(activity.locations?.length) ||
    activity.rawInput !== undefined ||
    activity.rawOutput !== undefined

  if (hasProtocolDetails) {
    return <GenericToolActivity activity={activity} />
  }

  const renderer = toolActivityRendererRegistry.find((entry) =>
    entry.matches(activity.toolName)
  )

  return renderer ? (
    renderer.render(activity)
  ) : (
    <GenericToolActivity activity={activity} />
  )
}
