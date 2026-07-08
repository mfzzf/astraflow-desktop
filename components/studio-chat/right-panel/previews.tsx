"use client"

import * as React from "react"

import { CodeBlock, CodeBlockCode } from "@/components/prompt-kit/code-block"
import { Markdown } from "@/components/prompt-kit/markdown"
import { useI18n } from "@/components/i18n-provider"
import { cn } from "@/lib/utils"

import {
  formatSidePanelFileSize,
  inferCodeLanguage,
  parseMarkdownFrontmatter,
} from "../side-panel-utils"
import type { StudioSidePanelFilePreview } from "../types"
import type { StudioRightPanelLabels } from "./labels"

export function StudioSidePanelPreview({
  preview,
  labels,
  focusLine = null,
}: {
  preview: StudioSidePanelFilePreview
  labels: StudioRightPanelLabels
  focusLine?: number | null
}) {
  if (preview.kind === "image") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/20 p-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview.file.dataUrl}
            alt={preview.entry.name}
            className="max-h-full max-w-full rounded-md object-contain shadow-sm"
          />
        </div>
        <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-t px-3 text-xs text-muted-foreground">
          <span className="min-w-0 truncate text-foreground">
            {preview.entry.name}
          </span>
          <span className="shrink-0">
            {formatSidePanelFileSize(preview.file.size)}
          </span>
        </div>
      </div>
    )
  }

  if (preview.kind === "text") {
    return (
      <StudioTextFilePreview
        entry={preview.entry}
        file={preview.file}
        labels={labels}
        focusLine={focusLine}
      />
    )
  }

  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
      {preview.error || labels.noPreview}
    </div>
  )
}

export function StudioTextFilePreview({
  entry,
  file,
  labels,
  focusLine = null,
}: {
  entry: AstraFlowSidePanelDirectoryEntry
  file: AstraFlowSidePanelTextFile
  labels: StudioRightPanelLabels
  focusLine?: number | null
}) {
  const codeContainerRef = React.useRef<HTMLDivElement | null>(null)
  const isMarkdown = entry.extension === "md" || entry.name.endsWith(".md")
  const isHtml =
    entry.extension === "html" ||
    entry.extension === "htm" ||
    entry.name.endsWith(".html") ||
    entry.name.endsWith(".htm")
  const showCode = !isMarkdown && (!isHtml || file.truncated)

  React.useEffect(() => {
    if (!focusLine || !showCode) {
      return
    }

    let cancelled = false
    let attempts = 0
    let flashTimeout = 0

    function tryScrollToLine() {
      if (cancelled) {
        return
      }

      const lines =
        codeContainerRef.current?.querySelectorAll<HTMLElement>(
          "pre code .line"
        )
      const target = focusLine ? lines?.[focusLine - 1] : undefined

      if (!target) {
        attempts += 1

        // Shiki highlights asynchronously; retry until line spans exist.
        if (attempts < 40) {
          window.setTimeout(tryScrollToLine, 100)
        }
        return
      }

      target.scrollIntoView({ block: "center" })
      target.classList.add(
        "bg-primary/10",
        "outline",
        "outline-1",
        "outline-primary/30"
      )
      flashTimeout = window.setTimeout(() => {
        target.classList.remove(
          "bg-primary/10",
          "outline",
          "outline-1",
          "outline-primary/30"
        )
      }, 2400)
    }

    tryScrollToLine()

    return () => {
      cancelled = true
      window.clearTimeout(flashTimeout)
    }
  }, [focusLine, showCode, file.content])

  if (isMarkdown) {
    return <StudioMarkdownFilePreview file={file} labels={labels} />
  }

  if (isHtml && !file.truncated) {
    return <StudioHtmlFilePreview entry={entry} file={file} />
  }

  return (
    <div ref={codeContainerRef} className="min-h-full bg-background">
      <CodeBlock className="min-w-max rounded-none border-0 bg-transparent">
        <CodeBlockCode
          code={file.content}
          language={inferCodeLanguage(entry)}
          className="text-[12px] leading-5 [&>pre]:min-h-full [&>pre]:px-4 [&>pre]:py-4"
        />
      </CodeBlock>
      {file.truncated ? (
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">
          {labels.truncated}
        </p>
      ) : null}
    </div>
  )
}

export function StudioHtmlFilePreview({
  entry,
  file,
}: {
  entry: AstraFlowSidePanelDirectoryEntry
  file: AstraFlowSidePanelTextFile
}) {
  const { t } = useI18n()
  const [view, setView] = React.useState<"rendered" | "source">("rendered")

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3">
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {entry.name}
        </span>
        <div className="flex shrink-0 items-center gap-1 rounded-lg bg-muted/60 p-0.5">
          <button
            type="button"
            onClick={() => setView("rendered")}
            className={cn(
              "rounded-md px-2 py-0.5 text-xs transition-colors",
              view === "rendered"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.studioFilePreviewRendered}
          </button>
          <button
            type="button"
            onClick={() => setView("source")}
            className={cn(
              "rounded-md px-2 py-0.5 text-xs transition-colors",
              view === "source"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.studioFilePreviewSource}
          </button>
        </div>
      </div>
      {view === "rendered" ? (
        <div className="min-h-0 flex-1 bg-white">
          <iframe
            key={entry.path}
            title={entry.name}
            srcDoc={file.content}
            className="size-full border-0 bg-white"
            sandbox="allow-scripts allow-forms allow-popups allow-modals"
            referrerPolicy="no-referrer"
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <CodeBlock className="min-w-max rounded-none border-0 bg-transparent">
            <CodeBlockCode
              code={file.content}
              language={inferCodeLanguage(entry)}
              className="text-[12px] leading-5 [&>pre]:min-h-full [&>pre]:px-4 [&>pre]:py-4"
            />
          </CodeBlock>
        </div>
      )}
    </div>
  )
}

export function StudioMarkdownFilePreview({
  file,
  labels,
}: {
  file: AstraFlowSidePanelTextFile
  labels: StudioRightPanelLabels
}) {
  const parsed = React.useMemo(
    () => parseMarkdownFrontmatter(file.content),
    [file.content]
  )
  const title =
    parsed.metadata.find(([key]) => ["name", "title"].includes(key))?.[1] ??
    file.name
  const description =
    parsed.metadata.find(([key]) => key === "description")?.[1] ?? ""
  const secondaryMetadata = parsed.metadata.filter(
    ([key]) => !["name", "title", "description"].includes(key)
  )

  return (
    <div className="mx-auto min-h-full max-w-3xl px-6 py-5">
      {parsed.metadata.length > 0 ? (
        <section className="mb-5 rounded-lg border bg-muted/20 p-4">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {description}
            </p>
          ) : null}
          {secondaryMetadata.length > 0 ? (
            <div className="mt-3 grid gap-1.5 text-xs sm:grid-cols-2">
              {secondaryMetadata.map(([key, value]) => (
                <div
                  key={key}
                  className="flex min-w-0 items-start gap-2 rounded-md bg-background/80 px-2 py-1.5"
                >
                  <span className="shrink-0 font-medium text-muted-foreground">
                    {key}
                  </span>
                  <span className="min-w-0 break-words text-foreground">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <Markdown className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-headings:text-foreground prose-a:text-primary prose-code:rounded-sm prose-code:bg-muted prose-code:px-1 prose-code:py-0.5">
        {parsed.body || file.content}
      </Markdown>

      {file.truncated ? (
        <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
          {labels.truncated}
        </p>
      ) : null}
    </div>
  )
}
