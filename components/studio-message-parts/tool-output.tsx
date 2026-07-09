import * as React from "react"
import { RiCodeLine, RiExternalLinkLine, RiTerminalLine } from "@remixicon/react"

import {
  CodeBlock,
  CodeBlockCode,
  CodeBlockGroup,
} from "@/components/prompt-kit/code-block"
import { useI18n } from "@/components/i18n-provider"
import { MessageContent } from "@/components/ui/message"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { StudioMessageActivity } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

import { markdownClassName } from "./shared"

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

type ParsedJsonToolOutput = {
  code: string
  summary: string
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getJsonToolOutputSummary(value: unknown) {
  if (Array.isArray(value)) {
    return `${value.length} ${value.length === 1 ? "item" : "items"}`
  }

  if (!isJsonRecord(value)) {
    return ""
  }

  const keys = Object.keys(value)

  if (keys.length === 1) {
    const key = keys[0]
    const nestedValue = value[key]

    if (Array.isArray(nestedValue)) {
      return `${key} · ${nestedValue.length}`
    }

    if (isJsonRecord(nestedValue)) {
      return `${key} · ${Object.keys(nestedValue).length}`
    }
  }

  return `${keys.length} ${keys.length === 1 ? "field" : "fields"}`
}

function getJsonToolOutput(output: string): ParsedJsonToolOutput | null {
  const trimmed = output.trim()

  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return null
  }

  try {
    const value = JSON.parse(trimmed) as unknown

    if (!Array.isArray(value) && !isJsonRecord(value)) {
      return null
    }

    const code = JSON.stringify(value, null, 2)

    return typeof code === "string"
      ? { code, summary: getJsonToolOutputSummary(value) }
      : null
  } catch {
    return null
  }
}

function JsonToolOutput({ parsed }: { parsed: ParsedJsonToolOutput }) {
  return (
    <CodeBlock className="rounded-2xl shadow-sm">
      <CodeBlockGroup className="gap-3 border-b bg-muted/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <RiCodeLine
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span className="truncate text-sm font-medium">JSON</span>
          {parsed.summary ? (
            <Badge variant="outline" className="shrink-0">
              {parsed.summary}
            </Badge>
          ) : null}
        </div>
      </CodeBlockGroup>
      <CodeBlockCode
        code={parsed.code}
        language="json"
        className="max-h-[520px] overflow-auto"
      />
    </CodeBlock>
  )
}

export function SandboxToolOutput({ output }: { output: string }) {
  const { t } = useI18n()
  const jsonOutput = getJsonToolOutput(output)

  if (jsonOutput) {
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
        className={cn("bg-transparent p-0", markdownClassName)}
      >
        {output}
      </MessageContent>
    )
  }

  return (
    <div className="space-y-3">
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
  const output = getActivityDetailOutput(activity, t)

  return (
    <div className="space-y-2 border-l pl-3">
      <ToolInputBlock
        icon={inputIcon}
        input={activity.input}
        language={inputLanguage}
        title={inputTitle ?? `${t.input} · ${activity.toolName}`}
      />

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
      ) : (
        <div className="text-sm text-muted-foreground">
          {t.studioToolNoOutput}
        </div>
      )}
    </div>
  )
}

export function useLazyToolActivityDetails(defaultOpen: boolean, resetKey: string) {
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
