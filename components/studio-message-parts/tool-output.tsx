import * as React from "react"
import {
  RiArrowDownSLine,
  RiCodeLine,
  RiExternalLinkLine,
  RiTerminalLine,
} from "@remixicon/react"

import {
  CodeBlock,
  CodeBlockCode,
  CodeBlockGroup,
} from "@/components/prompt-kit/code-block"
import { useI18n } from "@/components/i18n-provider"
import { MessageContent } from "@/components/ui/message"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  normalizeToolPayload,
  type NormalizedToolPayload,
} from "@/lib/agent/tool-payload"
import type { AgentToolCallContent } from "@/lib/agent/structured-content"
import type { StudioMessageActivity } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

import {
  canOpenMessageLinksInWorkspace,
  markdownClassName,
  useMessageRenderEnvironment,
} from "./shared"
import { StructuredContentBlock } from "./structured-content"

function cleanDetectedUrl(value: string) {
  return value.replace(/[),.;\]]+$/g, "")
}

function extractExplicitPreviewUrl(output: string, prelude: string) {
  const candidates = [prelude]
  const serviceEndpointIndex = output.indexOf("\n\nSandbox service endpoint:")

  if (serviceEndpointIndex >= 0) {
    candidates.push(output.slice(serviceEndpointIndex))
  }

  for (const candidate of candidates) {
    const match = candidate.match(/^URL:\s*(https?:\/\/[^\s<>"'`]+)/im)

    if (match) {
      return cleanDetectedUrl(match[1])
    }
  }

  return null
}

function extractFencedOutputSection(output: string, label: string) {
  const match = output.match(
    new RegExp(`^${label}:\\n\`\`\`[^\\n]*\\n([\\s\\S]*?)\\n\`\`\``, "m")
  )

  return match?.[1]?.trim() ?? ""
}

function extractPlainOutputSection(output: string, label: string) {
  const marker = `${label}:\n`
  const start = output.indexOf(marker)

  if (start < 0) {
    return ""
  }

  const rest = output.slice(start + marker.length)
  const nextSection = rest.search(/\n\n(?:STDOUT|STDERR|RESULTS|ERROR):\n/)

  return (nextSection >= 0 ? rest.slice(0, nextSection) : rest).trim()
}

export function parseSandboxToolOutput(output: string) {
  const sectionStart = output.search(/\n\n(?:STDOUT|STDERR|RESULTS|ERROR):\n/)
  const prelude = (
    sectionStart >= 0 ? output.slice(0, sectionStart) : output
  ).trim()
  const fields = new Map<string, string>()
  const title =
    prelude
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.includes(":")) ?? ""

  for (const line of prelude.split("\n")) {
    const match = line.match(/^([^:\n]{2,48}):\s*(.+)$/)

    if (match) {
      fields.set(match[1].trim(), match[2].trim())
    }
  }

  const stdout = extractFencedOutputSection(output, "STDOUT")
  const stderr = extractFencedOutputSection(output, "STDERR")
  const results =
    extractFencedOutputSection(output, "RESULTS") ||
    extractPlainOutputSection(output, "RESULTS")
  const error =
    extractFencedOutputSection(output, "ERROR") ||
    extractPlainOutputSection(output, "ERROR")
  const isSandboxOutput =
    title.startsWith("AstraFlow Sandbox") || title === "Sandbox host resolved."
  const primaryUrl = isSandboxOutput
    ? extractExplicitPreviewUrl(output, prelude)
    : null
  const fieldEntries = [
    "Runtime template",
    "Sandbox ID",
    "Working directory",
    "Exit code",
    "Auto pause",
    "Port",
    "Host",
    "URL",
    "WebSocket URL",
  ]
    .map((label) => [label, fields.get(label)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))

  return {
    title,
    fieldEntries,
    stdout,
    stderr,
    results,
    error,
    primaryUrl,
    isSandboxOutput,
  }
}

function SandboxPreviewCard({ url }: { url: string }) {
  const { t } = useI18n()

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex min-w-0 items-center justify-between gap-3 border-b bg-muted/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <RiExternalLinkLine
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
          />
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">
              {t.studioSandboxPreview}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {url}
            </span>
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="rounded-2xl">
          <a href={url} target="_blank" rel="noreferrer">
            <RiExternalLinkLine aria-hidden />
            <span>{t.studioSandboxOpenPreview}</span>
          </a>
        </Button>
      </div>
      <div className="h-[min(60vh,420px)] bg-white">
        <iframe
          title={t.studioSandboxPreview}
          src={url}
          className="size-full border-0 bg-white"
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin"
        />
      </div>
    </div>
  )
}

function SandboxOutputSection({
  title,
  content,
  tone = "default",
}: {
  title: string
  content: string
  tone?: "default" | "destructive"
}) {
  if (!content.trim()) {
    return null
  }

  return (
    <CodeBlock
      className={cn(
        "rounded-2xl shadow-sm",
        tone === "destructive" && "border-destructive/30"
      )}
    >
      <CodeBlockGroup
        className={cn(
          "gap-3 border-b bg-muted/40 px-3 py-2",
          tone === "destructive" && "bg-destructive/5"
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <RiCodeLine
            aria-hidden
            className={cn(
              "size-4 text-muted-foreground",
              tone === "destructive" && "text-destructive"
            )}
          />
          <span
            className={cn(
              "truncate text-sm font-medium",
              tone === "destructive" && "text-destructive"
            )}
          >
            {title}
          </span>
        </div>
      </CodeBlockGroup>
      <CodeBlockCode code={content} language="text" />
    </CodeBlock>
  )
}

function JsonToolOutput({ parsed }: { parsed: NormalizedToolPayload }) {
  const { t } = useI18n()
  const environment = useMessageRenderEnvironment()
  const [jsonOpen, setJsonOpen] = React.useState(false)

  return (
    <Collapsible
      open={jsonOpen}
      onOpenChange={setJsonOpen}
      className="overflow-hidden rounded-2xl border bg-card shadow-sm"
    >
      <div className="flex min-w-0 items-center justify-between gap-3 bg-muted/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <RiCodeLine aria-hidden className="size-4 text-muted-foreground" />
          <span className="truncate text-sm font-medium">
            {t.studioToolStructuredResult}
          </span>
          <Badge variant="outline">JSON</Badge>
          {parsed.summary ? (
            <span className="truncate text-xs text-muted-foreground">
              {parsed.summary.label
                ? `${parsed.summary.label} · ${parsed.summary.count}`
                : parsed.summary.kind === "items"
                  ? t.studioToolJsonItems(parsed.summary.count)
                  : t.studioToolJsonFields(parsed.summary.count)}
            </span>
          ) : null}
        </div>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground"
          >
            <span>
              {jsonOpen ? t.studioToolHideJson : t.studioToolViewJson}
            </span>
            <RiArrowDownSLine
              aria-hidden
              className={cn("transition-transform", jsonOpen && "rotate-180")}
            />
          </Button>
        </CollapsibleTrigger>
      </div>

      {parsed.primaryText ? (
        <MessageContent
          markdown
          openLinksInWorkspace={canOpenMessageLinksInWorkspace(environment)}
          className={cn(
            "border-t bg-transparent px-3 py-2.5",
            markdownClassName
          )}
        >
          {parsed.primaryText}
        </MessageContent>
      ) : null}

      {parsed.scalars.length || parsed.collections.length ? (
        <div className="flex flex-col gap-2 border-t px-3 py-2.5">
          {parsed.scalars.length ? (
            <dl className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
              {parsed.scalars.map((field) => (
                <div key={field.key} className="flex min-w-0 flex-col gap-0.5">
                  <dt className="truncate text-muted-foreground">
                    {field.label}
                  </dt>
                  <dd
                    className="truncate font-mono text-foreground"
                    title={field.value}
                  >
                    {field.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {parsed.collections.length ? (
            <div className="flex flex-wrap gap-1.5">
              {parsed.collections.map((collection) => (
                <Badge key={collection.key} variant="secondary">
                  {collection.label} · {collection.count}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {parsed.previewItems.length ? (
        <div className="flex flex-col border-t">
          {parsed.previewItems.map((item) => (
            <div
              key={item.key}
              className="flex min-w-0 items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0"
            >
              <span className="min-w-0 truncate text-sm text-foreground">
                {item.title}
              </span>
              {item.subtitle ? (
                <span className="max-w-[50%] shrink-0 truncate text-xs text-muted-foreground">
                  {item.subtitle}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <CollapsibleContent className="border-t">
        <CodeBlock className="rounded-none border-0 shadow-none">
          <CodeBlockCode
            code={parsed.json ?? ""}
            language="json"
            className="max-h-[420px] overflow-auto"
          />
        </CodeBlock>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function SandboxToolOutput({ output }: { output: string }) {
  const { t } = useI18n()
  const environment = useMessageRenderEnvironment()
  const jsonOutput = normalizeToolPayload(output)

  if (jsonOutput.json) {
    return <JsonToolOutput parsed={jsonOutput} />
  }

  const parsed = parseSandboxToolOutput(output)
  const hasStructuredOutput =
    parsed.isSandboxOutput ||
    parsed.primaryUrl ||
    parsed.stdout ||
    parsed.stderr ||
    parsed.results ||
    parsed.error

  if (!hasStructuredOutput) {
    return (
      <MessageContent
        markdown
        openLinksInWorkspace={canOpenMessageLinksInWorkspace(environment)}
        className={cn("bg-transparent p-0", markdownClassName)}
      >
        {output}
      </MessageContent>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {parsed.fieldEntries.length > 0 ? (
        <div className="rounded-2xl border bg-card p-3 shadow-sm">
          <div className="mb-2 text-xs font-semibold text-muted-foreground uppercase">
            {t.studioSandboxDetails}
          </div>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            {parsed.fieldEntries.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-muted-foreground">{label}</dt>
                <dd
                  className="truncate font-mono text-foreground"
                  title={value}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {parsed.primaryUrl ? (
        <SandboxPreviewCard url={parsed.primaryUrl} />
      ) : null}

      <SandboxOutputSection
        title={t.studioSandboxStdout}
        content={parsed.stdout}
      />
      <SandboxOutputSection
        title={t.studioSandboxResults}
        content={parsed.results}
      />
      <SandboxOutputSection
        title={t.studioSandboxStderr}
        content={parsed.stderr}
        tone="destructive"
      />
      <SandboxOutputSection
        title={t.studioSandboxError}
        content={parsed.error}
        tone="destructive"
      />
    </div>
  )
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

  const parsed = parseSandboxToolOutput(output)

  return parsed.error || parsed.stderr || output
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
  icon,
  input,
  language = "json",
  title,
}: {
  icon?: React.ReactNode
  input: string
  language?: string
  title: string
}) {
  const normalizedInput = input.trim()

  if (!normalizedInput) {
    return null
  }

  return (
    <CodeBlock className="rounded-2xl shadow-sm">
      <CodeBlockGroup className="gap-3 border-b bg-muted/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon ?? (
            <RiTerminalLine
              aria-hidden
              className="size-4 text-muted-foreground"
            />
          )}
          <span className="truncate text-sm font-medium">{title}</span>
        </div>
      </CodeBlockGroup>
      <CodeBlockCode code={normalizedInput} language={language} />
    </CodeBlock>
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
            <CodeBlock
              key={`diff-${entry.path}-${index}`}
              className="rounded-xl shadow-sm"
            >
              <CodeBlockGroup className="border-b bg-muted/40 px-3 py-2">
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {entry.path}
                </span>
              </CodeBlockGroup>
              <CodeBlockCode code={code} language="diff" />
            </CodeBlock>
          )
        }

        return (
          <div
            key={`terminal-${entry.terminalId}-${index}`}
            className="flex min-w-0 items-center gap-2 rounded-xl border bg-card px-3 py-2 text-xs shadow-sm"
          >
            <RiTerminalLine className="size-4 shrink-0 text-muted-foreground" />
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
  const input = activity.input.trim() || unknownPayloadText(activity.rawInput)
  const hasStructuredContent = Boolean(activity.content?.length)

  return (
    <div className="flex flex-col gap-2 border-l pl-3">
      <ToolInputBlock
        icon={inputIcon}
        input={input}
        language={inputLanguage}
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
              "text-xs font-semibold uppercase",
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
