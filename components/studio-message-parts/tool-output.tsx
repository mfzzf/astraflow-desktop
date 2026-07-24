import * as React from "react"
import { IconTerminal2 } from "@tabler/icons-react"

import { SynaraCodeBlock } from "@/components/synara-code-block"
import { useI18n } from "@/components/i18n-provider"
import { Badge } from "@/components/ui/badge"
import {
  normalizeCommandToolResult,
  normalizeToolPayload,
  type NormalizedToolPayload,
} from "@/lib/agent/tool-payload"
import type { AgentToolCallContent } from "@/lib/agent/structured-content"
import { normalizeAgentToolName } from "@/lib/agent/tool-names"
import type { StudioMessageActivity } from "@/lib/studio-types"

import {
  canOpenMessageLinksInWorkspace,
  getActivityInputText,
  useMessageRenderEnvironment,
} from "./shared"
import { StructuredContentBlock } from "./structured-content"

function JsonToolOutput({ parsed }: { parsed: NormalizedToolPayload }) {
  const { t } = useI18n()
  const summary = parsed.summary
    ? parsed.summary.label
      ? `${parsed.summary.label} · ${parsed.summary.count}`
      : parsed.summary.kind === "items"
        ? t.studioToolJsonItems(parsed.summary.count)
        : t.studioToolJsonFields(parsed.summary.count)
    : null

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {parsed.primaryText ? (
        <p className="text-sm leading-6 whitespace-pre-wrap text-foreground">
          {parsed.primaryText}
        </p>
      ) : null}
      {summary ? (
        <div className="text-xs text-muted-foreground">{summary}</div>
      ) : null}
      <SynaraCodeBlock code={parsed.json ?? ""} language="json" />
    </div>
  )
}

export function SandboxToolOutput({ output }: { output: string }) {
  const jsonOutput = normalizeToolPayload(output)

  if (jsonOutput.json) {
    return <JsonToolOutput parsed={jsonOutput} />
  }

  return <SynaraCodeBlock code={output} language="text" />
}

export function getActivityFailureOutput(
  activity: StudioMessageActivity,
  t: ReturnType<typeof useI18n>["t"]
) {
  if (activity.status !== "error") {
    return ""
  }

  const explicitError = activity.error?.trim()

  if (explicitError) {
    return explicitError
  }

  const output = activity.output.trim()

  if (!output) {
    return t.studioToolError
  }

  return output
}

export function getActivityDetailOutput(
  activity: StudioMessageActivity,
  t: ReturnType<typeof useI18n>["t"]
) {
  return activity.status === "error"
    ? getActivityFailureOutput(activity, t)
    : activity.output.trim()
}

function ToolInputBlock({
  collapsedLines,
  defaultWrap,
  input,
  language = "json",
  streaming,
}: {
  collapsedLines?: number
  defaultWrap?: boolean
  icon?: React.ReactNode
  input: string
  language?: string
  streaming?: boolean
  title: string
}) {
  const normalizedInput = input.trim()

  if (!normalizedInput) {
    return null
  }

  return (
    <SynaraCodeBlock
      code={normalizedInput}
      language={language}
      collapsedLines={collapsedLines}
      defaultWrap={defaultWrap}
      streaming={streaming}
    />
  )
}

function ToolCallContentDetails({
  content,
}: {
  content: AgentToolCallContent[]
}) {
  const environment = useMessageRenderEnvironment()

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {content.map((entry, index) => {
        if (entry.type === "content") {
          return (
            <StructuredContentBlock
              key={`content-${index}`}
              content={entry.content}
              openLinksInWorkspace={canOpenMessageLinksInWorkspace(environment)}
            />
          )
        }

        if (entry.type === "diff") {
          const code =
            entry.oldText == null
              ? entry.newText
              : `--- ${entry.path}\n+++ ${entry.path}\n${entry.oldText}\n---\n${entry.newText}`

          return (
            <SynaraCodeBlock
              key={`diff-${entry.path}-${index}`}
              code={code}
              language="diff"
            />
          )
        }

        return (
          <div
            key={`terminal-${entry.terminalId}-${index}`}
            className="flex min-w-0 items-center gap-2 rounded-xl border bg-card px-3 py-2 text-xs shadow-sm"
          >
            <IconTerminal2 className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-mono">{entry.terminalId}</span>
          </div>
        )
      })}
    </div>
  )
}

function unknownPayloadText(value: unknown) {
  if (typeof value === "string") {
    return value
  }

  if (value === undefined || value === null) {
    return ""
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

type ToolResultChannels = {
  stdout: string
  stderr: string
  output: string
}

function unwrapToolResult(value: unknown) {
  const serialized = unknownPayloadText(value).trim()
  const parsed = serialized ? normalizeToolPayload(serialized).value : value
  const details = getRecord(getRecord(parsed)?.details)

  return details && Object.hasOwn(details, "result") ? details.result : parsed
}

function extractToolResultChannels(value: unknown): ToolResultChannels {
  const result = unwrapToolResult(value)
  const serialized = unknownPayloadText(result).trim()

  if (!serialized) {
    return { stdout: "", stderr: "", output: "" }
  }

  const normalized = normalizeCommandToolResult(serialized)
  const stdout = normalized.stdout.trimEnd()
  const stderr = normalized.stderr.trimEnd()

  if (stdout || stderr) {
    return { stdout, stderr, output: "" }
  }

  if (normalized.output && normalized.output !== serialized) {
    const nested = normalizeCommandToolResult(normalized.output)
    const nestedStdout = nested.stdout.trimEnd()
    const nestedStderr = nested.stderr.trimEnd()

    if (nestedStdout || nestedStderr) {
      return { stdout: nestedStdout, stderr: nestedStderr, output: "" }
    }
  }

  return {
    stdout: "",
    stderr: "",
    output:
      normalized.output.trim() ||
      (normalized.isProcessResult ? "" : serialized),
  }
}

function getToolContentText(activity: StudioMessageActivity) {
  return (activity.content ?? [])
    .flatMap((entry) =>
      entry.type === "content" &&
      entry.content.type === "text" &&
      entry.content.text.trim()
        ? [entry.content.text]
        : []
    )
    .join("\n")
    .trim()
}

export function getToolActivityResultChannels(
  activity: StudioMessageActivity
): Pick<ToolResultChannels, "stdout" | "stderr"> {
  const candidates = [
    activity.rawOutput,
    activity.status === "error" ? activity.error : activity.output,
    activity.status === "error" ? activity.output : activity.error,
    getToolContentText(activity),
  ]

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === "") {
      continue
    }

    const channels = extractToolResultChannels(candidate)

    if (channels.stdout || channels.stderr) {
      return { stdout: channels.stdout, stderr: channels.stderr }
    }

    if (channels.output) {
      return activity.status === "error"
        ? { stdout: "", stderr: channels.output }
        : { stdout: channels.output, stderr: "" }
    }
  }

  return { stdout: "", stderr: "" }
}

function ToolResultChannel({
  label,
  output,
  destructive = false,
}: {
  label: string
  output: string
  destructive?: boolean
}) {
  const normalized = normalizeToolPayload(output)

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div
        className={
          destructive
            ? "text-xs text-destructive"
            : "text-xs text-muted-foreground"
        }
      >
        {label}
      </div>
      <SynaraCodeBlock
        code={normalized.json ?? output}
        language={normalized.json ? "json" : "text"}
      />
    </div>
  )
}

export function ToolActivityDetails({
  activity,
  inputIcon,
  inputLanguage = "json",
  inputTitle,
}: {
  activity: StudioMessageActivity
  inputIcon?: React.ReactNode
  inputLanguage?: string
  inputTitle?: string
}) {
  const { t } = useI18n()
  const input = getActivityInputText(activity)
  const result = getToolActivityResultChannels(activity)
  const structuredContent = (activity.content ?? []).filter(
    (entry) =>
      entry.type !== "content" || entry.content.type !== "text"
  )
  const hasStructuredContent = structuredContent.length > 0
  const inputCodeBlockOptions = getToolInputCodeBlockOptions(activity)

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ToolInputBlock
        collapsedLines={inputCodeBlockOptions.collapsedLines}
        defaultWrap={inputCodeBlockOptions.defaultWrap}
        icon={inputIcon}
        input={input}
        language={inputLanguage}
        streaming={inputCodeBlockOptions.streaming}
        title={
          inputTitle ??
          `${t.input} · ${t.studioToolDisplayName(activity.toolName)}`
        }
      />

      {activity.locations?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {activity.locations.map((location, index) => (
            <Badge
              key={`${location.path}-${location.line ?? ""}-${index}`}
              variant="outline"
              className="max-w-full font-mono font-normal"
            >
              <span className="truncate">
                {location.path}
                {location.line != null ? `:${location.line}` : ""}
              </span>
            </Badge>
          ))}
        </div>
      ) : null}

      {hasStructuredContent ? (
        <ToolCallContentDetails content={structuredContent} />
      ) : null}

      {activity.status === "running" ? null : result.stdout || result.stderr ? (
        <>
          {result.stdout ? (
            <ToolResultChannel
              label={t.studioSandboxStdout}
              output={result.stdout}
            />
          ) : null}
          {result.stderr ? (
            <ToolResultChannel
              destructive
              label={t.studioSandboxStderr}
              output={result.stderr}
            />
          ) : null}
        </>
      ) : hasStructuredContent ? null : (
        <div className="text-sm text-muted-foreground">
          {t.studioToolNoOutput}
        </div>
      )}
    </div>
  )
}

export function getToolInputCodeBlockOptions(
  activity: Pick<StudioMessageActivity, "status" | "toolName">
) {
  const toolName = normalizeAgentToolName(activity.toolName)
  const isFileMutation = toolName === "write_file" || toolName === "edit_file"

  return {
    collapsedLines: isFileMutation ? 10 : undefined,
    defaultWrap: isFileMutation,
    streaming: activity.status === "running",
  }
}

export function useLazyToolActivityDetails(
  defaultOpen: boolean,
  resetKey: string
) {
  const previousResetKeyRef = React.useRef(resetKey)
  const [open, setOpen] = React.useState(defaultOpen)
  const [hasOpened, setHasOpened] = React.useState(defaultOpen)

  React.useEffect(() => {
    if (previousResetKeyRef.current === resetKey) {
      return
    }

    previousResetKeyRef.current = resetKey
    setOpen(defaultOpen)
    setHasOpened(defaultOpen)
  }, [defaultOpen, resetKey])

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)

    if (nextOpen) {
      setHasOpened(true)
    }
  }, [])

  return {
    open,
    onOpenChange: handleOpenChange,
    shouldRenderDetails: open || hasOpened,
  }
}
