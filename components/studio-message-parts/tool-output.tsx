import * as React from "react"
import { IconTerminal2 } from "@tabler/icons-react"

import { SynaraCodeBlock } from "@/components/synara-code-block"
import { useI18n } from "@/components/i18n-provider"
import { Badge } from "@/components/ui/badge"
import {
  normalizeToolPayload,
  type NormalizedToolPayload,
} from "@/lib/agent/tool-payload"
import type { AgentToolCallContent } from "@/lib/agent/structured-content"
import { normalizeAgentToolName } from "@/lib/agent/tool-names"
import type { StudioMessageActivity } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

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
  const output =
    getActivityDetailOutput(activity, t) ||
    unknownPayloadText(activity.rawOutput)
  const input = getActivityInputText(activity)
  const hasStructuredContent = Boolean(activity.content?.length)
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
        <ToolCallContentDetails content={activity.content ?? []} />
      ) : null}

      {activity.status === "running" ? null : output ? (
        <>
          <div
            className={cn(
              "text-xs",
              activity.status === "error"
                ? "text-destructive"
                : "text-muted-foreground"
            )}
          >
            {activity.status === "error" ? t.studioToolError : t.output}
          </div>
          <SandboxToolOutput output={output} />
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
