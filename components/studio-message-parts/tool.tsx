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
  IconLoader2,
  IconLogs,
  IconPencil,
  IconPlayerStop,
  IconPhoto,
  IconSearch,
  IconSparkles,
  IconTerminal2,
  IconTrash,
  IconVideo,
  IconX,
} from "@tabler/icons-react"
import { toast } from "sonner"

import { CentralIcon } from "@/components/central-icon"
import { Shimmer } from "@/components/ai-elements/shimmer"
import { SynaraCodeBlock } from "@/components/synara-code-block"
import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
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
  formatClaudeHookTitle,
  getClaudeHookTarget,
} from "@/lib/agent/claude-hook"
import {
  deriveSynaraReadableCommandDisplay,
  resolveSynaraCommandVisualKind,
} from "@/lib/synara-tool-call-label"
import type { StudioMessageActivity } from "@/lib/studio-types"
import {
  STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
  type StudioOpenMarkdownTargetDetail,
} from "@/lib/studio-markdown-open"
import {
  getStudioWorkspaceServiceResult,
  isStudioWorkspaceServiceResultForContext,
} from "@/lib/studio-workspace-service-result"

import {
  FileDiffView,
  getWrittenFileInfo,
  isPreviewableWrittenFile,
  WrittenFileOpenCard,
} from "./file-output"
import {
  commandToolNames,
  fileToolNames,
  getActivityInputText,
  getRunCommandActivityResult,
  getRunCodePayload,
  getRunCommandPayload,
  isCommandProcessResult,
  mediaToolNames,
  skillToolNames,
  SuppressWrittenFileOpenCardsContext,
  useMessageRenderEnvironment,
  useStudioWorkspaceServiceContext,
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

function isEmptyToolInput(value: string) {
  const normalized = value.trim()

  return (
    !normalized ||
    normalized === "{}" ||
    normalized === "[]" ||
    normalized === "null"
  )
}

function isGenericCommandLabel(value: string, toolName: string) {
  const normalized = value.trim().toLowerCase()

  return new Set([
    "bash",
    "execute",
    "run_command",
    "shell",
    "tool",
    toolName.trim().toLowerCase(),
  ]).has(normalized)
}

function getActivityCommandPayload(activity: StudioMessageActivity) {
  const inputCandidates = [
    getActivityInputText(activity),
    activity.input.trim(),
  ]

  for (const input of inputCandidates) {
    if (isEmptyToolInput(input)) continue

    const payload = getRunCommandPayload(input)

    if (
      payload.command.trim() &&
      !isGenericCommandLabel(payload.command, activity.toolName)
    ) {
      return payload
    }
  }

  const title = activity.title?.trim() ?? ""

  if (title && !isGenericCommandLabel(title, activity.toolName)) {
    return { command: title, cwd: null }
  }

  return getRunCommandPayload(getActivityInputText(activity))
}

function activityRawCall(activity: StudioMessageActivity) {
  if (commandToolNames.has(activity.toolName)) {
    return getActivityCommandPayload(activity).command
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
            <div className="max-w-96 space-y-2 leading-tight whitespace-pre-wrap">
              <div className="space-y-0.5">
                <div className="text-muted-foreground/70">
                  {t.studioToolSummary}
                </div>
                <div>{summary}</div>
              </div>
              {rawCall ? (
                <div className="space-y-0.5">
                  <div className="text-muted-foreground/70">
                    {t.studioToolRawCall}
                  </div>
                  <code className="block font-mono text-[11px] break-words whitespace-pre-wrap text-foreground/92">
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
              ? (renderDetails?.(activity) ?? (
                  <ToolActivityDetails activity={activity} />
                ))
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
        autoOpenWhileRunning={false}
        leftIcon={
          activity.status === "complete" ? (
            <IconCheck aria-hidden className="size-4" />
          ) : (
            <IconFileText aria-hidden className="size-4" />
          )
        }
        renderDetails={activity.status === "running" ? () => null : undefined}
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
        autoOpenWhileRunning={isStreamingInputFileTool(activity.toolName)}
        leftIcon={
          activity.status === "complete" ? (
            <IconCheck aria-hidden className="size-4" />
          ) : (
            <IconFileText aria-hidden className="size-4" />
          )
        }
        renderDetails={() => (
          <div className="space-y-2">
            <FileDiffView
              info={info}
              streaming={activity.status === "running"}
            />
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

function ContextCompactionActivity({
  activity,
}: {
  activity: StudioMessageActivity
}) {
  const { t } = useI18n()
  const label = getActivityLabel(activity, t)

  return (
    <div
      role="status"
      aria-live="polite"
      className="not-prose py-0.5 text-muted-foreground"
    >
      <div className="flex w-fit max-w-full items-start gap-1.5 text-sm leading-5 text-muted-foreground/70">
        <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center">
          {activity.status === "running" ? (
            <IconLoader2 aria-hidden className="size-4 animate-spin" />
          ) : activity.status === "complete" ? (
            <IconCheck aria-hidden className="size-4" />
          ) : (
            <IconX aria-hidden className="size-4 text-destructive" />
          )}
        </span>
        <span className="min-w-0">
          {activity.status === "running" ? (
            <Shimmer as="span">{label}</Shimmer>
          ) : (
            label
          )}
          {activity.status === "running" ? (
            <span
              aria-hidden
              className="mt-1.5 block h-0.5 w-40 max-w-full overflow-hidden rounded-full bg-muted"
            >
              <span className="block h-full w-full animate-pulse bg-gradient-to-r from-transparent via-foreground/45 to-transparent" />
            </span>
          ) : null}
        </span>
      </div>
    </div>
  )
}

export function getProtocolToolIconName(activity: StudioMessageActivity) {
  if (isMcpToolActivity(activity)) {
    return "mcp"
  }

  return activity.kind ?? "other"
}

export function getProtocolToolStatusIconName(activity: StudioMessageActivity) {
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
  return [`$ ${command || "command"}`, output.trim()].filter(Boolean).join("\n")
}

function RunCommandActivity({ activity }: { activity: StudioMessageActivity }) {
  const { t } = useI18n()
  const payload = getActivityCommandPayload(activity)
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
  const output = commandResult.isProcessResult
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

function getClaudeHookDetails(activity: StudioMessageActivity) {
  const input = getActivityInputText(activity)
  let hookEvent = "Hook"
  let hookName = activity.title?.trim() || "Hook"

  try {
    const parsed = JSON.parse(input) as {
      event?: unknown
      name?: unknown
    }

    if (typeof parsed.event === "string" && parsed.event.trim()) {
      hookEvent = parsed.event.trim()
    }
    if (typeof parsed.name === "string" && parsed.name.trim()) {
      hookName = parsed.name.trim()
    }
  } catch {
    // Older saved hook activities can contain plain-text input.
  }

  const target = getClaudeHookTarget(hookEvent, hookName)

  return {
    hookEvent,
    hookName,
    target,
    title: formatClaudeHookTitle(hookEvent, hookName),
  }
}

function ClaudeHookActivity({ activity }: { activity: StudioMessageActivity }) {
  const { t } = useI18n()
  const isZh = t.studioThinking === "正在思考"
  const details = getClaudeHookDetails(activity)
  const output = getActivityDetailOutput(activity, t)
  const status =
    activity.status === "running"
      ? isZh
        ? "运行中"
        : "Running"
      : activity.status === "error"
        ? isZh
          ? "失败"
          : "Failed"
        : isZh
          ? "已完成"
          : "Completed"

  return (
    <SynaraToolDisclosure
      activity={activity}
      leftIcon={<ProtocolToolStatusIcon activity={activity} />}
      rawCall=""
      summary={details.title}
      renderDetails={() => (
        <div className="flex min-w-0 flex-col gap-3 border-l pl-3">
          <dl className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-muted-foreground">
                {isZh ? "触发时机" : "Lifecycle event"}
              </dt>
              <dd className="truncate font-mono text-foreground">
                {details.hookEvent}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground">
                {isZh ? "匹配器" : "Matcher"}
              </dt>
              <dd className="truncate font-mono text-foreground">
                {details.target || details.hookName}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground">
                {isZh ? "状态" : "Status"}
              </dt>
              <dd className="text-foreground">{status}</dd>
            </div>
          </dl>
          {output ? (
            <div className="min-w-0">
              <div className="mb-1 text-xs text-muted-foreground">
                {activity.status === "error" ? t.studioToolError : t.output}
              </div>
              <SynaraCodeBlock code={output} language="text" />
            </div>
          ) : null}
        </div>
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

function SandboxServiceActivity({
  activity,
}: {
  activity: StudioMessageActivity
}) {
  const { t } = useI18n()
  const serviceContext = useStudioWorkspaceServiceContext()
  const service =
    getStudioWorkspaceServiceResult(activity.rawOutput) ??
    getStudioWorkspaceServiceResult(activity.meta)
  const [logs, setLogs] = React.useState<string | null>(null)
  const [logsLoading, setLogsLoading] = React.useState(false)
  const [stopping, setStopping] = React.useState(false)
  const [stopped, setStopped] = React.useState(false)

  if (!service) {
    return (
      <InlineToolActivity
        activity={activity}
        leftIcon={getCompletedAwareToolIcon(
          activity,
          <IconTerminal2 aria-hidden className="size-4" />
        )}
      />
    )
  }

  const resolvedService = service
  const serviceIdentityVerified = isStudioWorkspaceServiceResultForContext(
    resolvedService,
    serviceContext
  )
  const effectiveStatus = stopped ? "stopped" : service.status
  const effectiveStatusLabel =
    t.studioSandboxServiceStatusValue(effectiveStatus)
  const summary =
    activity.status === "running"
      ? t.studioSandboxServiceStarting(service.name)
      : effectiveStatus === "healthy"
        ? t.studioSandboxServiceReady(service.name)
        : t.studioSandboxServiceSummary(service.name, effectiveStatusLabel)
  const serviceFailed =
    activity.status === "error" ||
    (activity.status !== "running" &&
      !["healthy", "stopped"].includes(effectiveStatus))

  function openPreview() {
    if (
      !serviceIdentityVerified ||
      !service?.publicUrl ||
      effectiveStatus !== "healthy"
    ) {
      return
    }

    window.dispatchEvent(
      new CustomEvent<StudioOpenMarkdownTargetDetail>(
        STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
        {
          detail: {
            href: service.publicUrl,
            source: "link",
            intent: "preview",
            serviceId: service.serviceId,
            artifactKey: service.artifactKey,
            entryPath: service.entryPath,
            revision:
              service.specRevision ??
              service.specFingerprint ??
              service.serviceId,
            activate: true,
          },
        }
      )
    )
  }

  async function loadLogs() {
    if (
      !resolvedService.sessionId ||
      !resolvedService.serviceId ||
      !serviceIdentityVerified ||
      logsLoading
    ) {
      return
    }

    setLogsLoading(true)
    try {
      const response = await fetch(
        `/api/studio/sessions/${encodeURIComponent(
          resolvedService.sessionId
        )}/services/${encodeURIComponent(resolvedService.serviceId)}/logs`,
        { cache: "no-store" }
      )
      const payload = (await response.json()) as {
        ok?: boolean
        data?: { text?: string }
        error?: string
      }

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || t.requestFailed)
      }

      setLogs(payload.data?.text ?? "")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.requestFailed)
    } finally {
      setLogsLoading(false)
    }
  }

  async function stopService() {
    if (
      !resolvedService.sessionId ||
      !resolvedService.serviceId ||
      !serviceIdentityVerified ||
      stopping
    ) {
      return
    }

    setStopping(true)
    try {
      const response = await fetch(
        `/api/studio/sessions/${encodeURIComponent(
          resolvedService.sessionId
        )}/services/${encodeURIComponent(resolvedService.serviceId)}`,
        { method: "DELETE" }
      )
      const payload = (await response.json()) as {
        ok?: boolean
        data?: { service?: { status?: string } }
        error?: string
      }

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || t.requestFailed)
      }

      setStopped(payload.data?.service?.status === "stopped")
      toast.success(t.studioSandboxServiceStopped)
      await loadLogs()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.requestFailed)
    } finally {
      setStopping(false)
    }
  }

  return (
    <SynaraToolDisclosure
      activity={activity}
      defaultOpen={activity.status === "error" || effectiveStatus !== "healthy"}
      summary={summary}
      leftIcon={
        serviceFailed ? (
          <IconX aria-hidden className="size-4 text-destructive" />
        ) : (
          getCompletedAwareToolIcon(
            activity,
            <IconTerminal2 aria-hidden className="size-4" />
          )
        )
      }
      renderDetails={() => (
        <div className="space-y-3 border-l pl-3 text-sm">
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-muted-foreground">
                {t.studioSandboxServiceStatus}
              </dt>
              <dd className="font-medium text-foreground">
                {effectiveStatusLabel}
              </dd>
            </div>
            {service.port ? (
              <div className="min-w-0">
                <dt className="text-muted-foreground">
                  {t.studioSandboxServicePort}
                </dt>
                <dd className="font-mono text-foreground">{service.port}</dd>
              </div>
            ) : null}
            {service.entryPath ? (
              <div className="min-w-0 sm:col-span-2">
                <dt className="text-muted-foreground">
                  {t.studioSandboxServiceEntry}
                </dt>
                <dd className="truncate font-mono text-foreground">
                  {service.entryPath}
                </dd>
              </div>
            ) : null}
          </dl>
          {service.failure ? (
            <p className="text-xs whitespace-pre-wrap text-destructive">
              {service.failure}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {serviceIdentityVerified &&
            service.publicUrl &&
            effectiveStatus === "healthy" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-xl"
                onClick={openPreview}
              >
                <IconExternalLink aria-hidden />
                {t.studioSandboxOpenPreview}
              </Button>
            ) : null}
            {serviceIdentityVerified &&
            service.sessionId &&
            service.serviceId ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-xl"
                disabled={logsLoading}
                onClick={() => void loadLogs()}
              >
                {logsLoading ? (
                  <IconLoader2 aria-hidden className="animate-spin" />
                ) : (
                  <IconLogs aria-hidden />
                )}
                {t.studioSandboxServiceLogs}
              </Button>
            ) : null}
            {serviceIdentityVerified &&
            service.sessionId &&
            service.serviceId &&
            !["stopped", "failed"].includes(effectiveStatus) ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-xl"
                disabled={stopping}
                onClick={() => void stopService()}
              >
                {stopping ? (
                  <IconLoader2 aria-hidden className="animate-spin" />
                ) : (
                  <IconPlayerStop aria-hidden />
                )}
                {t.studioSandboxStopService}
              </Button>
            ) : null}
          </div>
          {logs !== null ? (
            <pre className="max-h-56 overflow-auto rounded-xl bg-muted/55 p-3 font-mono text-xs break-words whitespace-pre-wrap text-foreground">
              {logs || t.studioSandboxLogsEmpty}
            </pre>
          ) : null}
        </div>
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
    matches: (toolName) => toolName === "context_compaction",
    render: (activity) => <ContextCompactionActivity activity={activity} />,
  },
  {
    matches: (toolName) => toolName === "hook",
    render: (activity) => <ClaudeHookActivity activity={activity} />,
  },
  {
    matches: (toolName) => toolName === "run_code",
    render: (activity) => <RunCodeActivity activity={activity} />,
  },
  {
    matches: (toolName) => commandToolNames.has(toolName),
    render: (activity) => <RunCommandActivity activity={activity} />,
  },
  {
    matches: (toolName) => toolName === "sandbox_start_service",
    render: (activity) => <SandboxServiceActivity activity={activity} />,
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
  const renderer = toolActivityRendererRegistry.find((entry) =>
    entry.matches(activity.toolName)
  )

  // Protocol details enrich purpose-built renderers; they should not force a
  // known file/command/tool back into the raw generic JSON presentation.
  if (renderer) {
    return renderer.render(activity)
  }

  return <GenericToolActivity activity={activity} />
}
