import * as React from "react"
import {
  RiArrowDownSLine,
  RiExternalLinkLine,
  RiEyeLine,
  RiFileAddLine,
  RiFileEditLine,
  RiFolderOpenLine,
} from "@remixicon/react"

import { StudioFileTypeIcon } from "@/components/studio-file-type-icon"
import {
  CodeBlock,
  CodeBlockGroup,
  useShikiHighlightedLines,
} from "@/components/prompt-kit/code-block"
import { useI18n } from "@/components/i18n-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
  type StudioOpenMarkdownTargetDetail,
} from "@/lib/studio-markdown-open"
import {
  getStudioFileDescriptor,
  isStudioFilePreviewable,
} from "@/lib/studio-file-support"
import type { StudioMessageActivity } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

import { getFileToolTarget, parseToolInputObject } from "./shared"

export function FileTypeBadge({ path }: { path: string }) {
  return (
    <StudioFileTypeIcon
      path={path}
      size="small"
      className="size-4 rounded-[4px] text-[8px]"
    />
  )
}

export function FileChangeStats({
  additions,
  deletions,
}: {
  additions: number
  deletions: number
}) {
  if (additions <= 0 && deletions <= 0) {
    return null
  }

  return (
    <span className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums">
      {additions > 0 ? (
        <span className="text-emerald-600">+{additions}</span>
      ) : null}
      {deletions > 0 ? (
        <span className="text-destructive">-{deletions}</span>
      ) : null}
    </span>
  )
}

export function getFilePathExtension(path: string) {
  const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

  return name.includes(".") ? (name.split(".").at(-1)?.toLowerCase() ?? "") : ""
}

export function getFilePathName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

export function isPreviewableWrittenFile(path: string) {
  return isStudioFilePreviewable(path)
}

export type WrittenFileInfo = {
  path: string
  kind: "create" | "edit"
  oldText: string
  newText: string
}

export function getWrittenFileInfo(
  activity: StudioMessageActivity
): WrittenFileInfo | null {
  if (activity.toolName !== "write_file" && activity.toolName !== "edit_file") {
    return null
  }

  const path = getFileToolTarget(activity.input)

  if (!path) {
    return null
  }

  const parsed = parseToolInputObject(activity.input)

  if (activity.toolName === "write_file") {
    const content =
      parsed && typeof parsed.content === "string" ? parsed.content : ""

    return { path, kind: "create", oldText: "", newText: content }
  }

  const oldText =
    parsed && typeof parsed.old_string === "string" ? parsed.old_string : ""
  const newText =
    parsed && typeof parsed.new_string === "string" ? parsed.new_string : ""

  if (!oldText && !newText) {
    return null
  }

  return { path, kind: "edit", oldText, newText }
}

function getWrittenFileTypeLabel(
  path: string,
  t: ReturnType<typeof useI18n>["t"]
) {
  const extension = getFilePathExtension(path)
  const descriptor = getStudioFileDescriptor(path)

  if (extension === "html" || extension === "htm" || extension === "svg") {
    return t.studioFileWebsiteLabel
  }

  if (descriptor.kind === "image") {
    return t.studioFileImageLabel
  }

  return t.studioFileDocumentLabel
}

type DiffLine = { type: "add" | "del" | "context"; text: string }

const MAX_DIFF_LINES = 600

function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.length ? oldText.split("\n") : []
  const newLines = newText.length ? newText.split("\n") : []

  if (oldLines.length === 0) {
    return newLines.map((text) => ({ type: "add", text }))
  }

  if (newLines.length === 0) {
    return oldLines.map((text) => ({ type: "del", text }))
  }

  // Guard against an oversized DP matrix for very large edits.
  if (oldLines.length * newLines.length > 2_000_000) {
    return [
      ...oldLines.map((text): DiffLine => ({ type: "del", text })),
      ...newLines.map((text): DiffLine => ({ type: "add", text })),
    ]
  }

  const n = oldLines.length
  const m = newLines.length
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  )

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        oldLines[i] === newLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const result: DiffLine[] = []
  let i = 0
  let j = 0

  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: "context", text: oldLines[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: "del", text: oldLines[i] })
      i++
    } else {
      result.push({ type: "add", text: newLines[j] })
      j++
    }
  }

  while (i < n) {
    result.push({ type: "del", text: oldLines[i] })
    i++
  }

  while (j < m) {
    result.push({ type: "add", text: newLines[j] })
    j++
  }

  return result
}

export function FileDiffView({ info }: { info: WrittenFileInfo }) {
  const { t } = useI18n()
  const lines = React.useMemo(
    () => computeLineDiff(info.oldText, info.newText),
    [info.oldText, info.newText]
  )
  const additions = lines.filter((line) => line.type === "add").length
  const deletions = lines.filter((line) => line.type === "del").length
  const visibleLines = lines.slice(0, MAX_DIFF_LINES)
  const hiddenCount = lines.length - visibleLines.length
  const highlightedLines = useShikiHighlightedLines({
    code: visibleLines.map((line) => line.text).join("\n"),
    language: getStudioFileDescriptor(info.path).language,
  })

  return (
    <CodeBlock className="overflow-hidden rounded-2xl shadow-sm">
      <CodeBlockGroup className="gap-3 border-b bg-muted/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {info.kind === "create" ? (
            <RiFileAddLine
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
          ) : (
            <RiFileEditLine
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
          )}
          <span className="truncate font-mono text-sm font-medium">
            {getFilePathName(info.path)}
          </span>
          {info.kind === "create" ? (
            <Badge variant="outline" className="shrink-0">
              {t.studioFileNewFile}
            </Badge>
          ) : null}
        </div>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {t.studioFileDiffChanges(additions, deletions)}
        </span>
      </CodeBlockGroup>
      <div className="max-h-[420px] overflow-auto py-1 font-mono text-[12px] leading-5">
        {visibleLines.map((line, index) => (
          <div
            key={index}
            className={cn(
              "flex gap-2 px-3 whitespace-pre",
              line.type === "add" && "bg-emerald-500/10",
              line.type === "del" && "bg-red-500/10",
              line.type === "context" && "text-muted-foreground"
            )}
          >
            <span
              className={cn(
                "w-3 shrink-0 text-center opacity-70 select-none",
                line.type === "add" && "text-emerald-700 dark:text-emerald-300",
                line.type === "del" && "text-red-700 dark:text-red-300"
              )}
            >
              {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
            </span>
            <span className="min-w-0">
              {highlightedLines?.[index] ? (
                <span
                  // Shiki escapes source before emitting token spans.
                  dangerouslySetInnerHTML={{
                    __html: highlightedLines[index],
                  }}
                />
              ) : (
                line.text || "​"
              )}
            </span>
          </div>
        ))}
      </div>
      {hiddenCount > 0 ? (
        <div className="border-t px-3 py-1.5 text-xs text-muted-foreground">
          {`+${hiddenCount}`}
        </div>
      ) : null}
    </CodeBlock>
  )
}

function dispatchOpenFilePreview(path: string) {
  if (typeof window === "undefined") {
    return
  }

  window.dispatchEvent(
    new CustomEvent<StudioOpenMarkdownTargetDetail>(
      STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
      { detail: { href: path, source: "link" } }
    )
  )
}

function WrittenFileOpenCardMenuItem({
  icon,
  label,
  onSelect,
}: {
  icon: React.ReactNode
  label: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}

export function WrittenFileOpenCard({ info }: { info: WrittenFileInfo }) {
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = React.useState(false)
  const bridge =
    typeof window !== "undefined" ? window.astraflowDesktop : undefined
  const canOpenInBrowser = Boolean(bridge?.sidePanelOpenPath)
  const canReveal = Boolean(bridge?.sidePanelShowItem)
  const handlePreview = () => {
    setMenuOpen(false)
    dispatchOpenFilePreview(info.path)
  }

  const handleOpenInBrowser = () => {
    setMenuOpen(false)
    void bridge?.sidePanelOpenPath?.(info.path)
  }

  const handleReveal = () => {
    setMenuOpen(false)
    void bridge?.sidePanelShowItem?.(info.path)
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border bg-card px-3 py-2 shadow-sm">
      <button
        type="button"
        onClick={handlePreview}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <StudioFileTypeIcon path={info.path} size="medium" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">
            {getFilePathName(info.path)}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {getWrittenFileTypeLabel(info.path, t)}
          </span>
        </span>
      </button>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="shrink-0 rounded-2xl">
            <span>{t.studioFileOpenIn}</span>
            <RiArrowDownSLine aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 gap-0.5 rounded-2xl p-1">
          <WrittenFileOpenCardMenuItem
            icon={<RiEyeLine aria-hidden className="size-4" />}
            label={t.studioFileOpenPreview}
            onSelect={handlePreview}
          />
          {canOpenInBrowser ? (
            <WrittenFileOpenCardMenuItem
              icon={<RiExternalLinkLine aria-hidden className="size-4" />}
              label={t.studioFileOpenBrowser}
              onSelect={handleOpenInBrowser}
            />
          ) : null}
          {canReveal ? (
            <WrittenFileOpenCardMenuItem
              icon={<RiFolderOpenLine aria-hidden className="size-4" />}
              label={t.studioFileRevealInFolder}
              onSelect={handleReveal}
            />
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  )
}
