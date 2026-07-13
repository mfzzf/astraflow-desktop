"use client"

import * as React from "react"

import { CodeBlock, CodeBlockCode } from "@/components/prompt-kit/code-block"
import { Markdown } from "@/components/prompt-kit/markdown"
import { useI18n } from "@/components/i18n-provider"
import { StudioFileTypeIcon } from "@/components/studio-file-type-icon"
import { getStudioFileDescriptor } from "@/lib/studio-file-support"
import {
  parseFilePathHrefTarget,
  resolveMarkdownRelativeFileHref,
} from "@/lib/markdown-file-paths"
import { cn } from "@/lib/utils"

import {
  formatSidePanelFileSize,
  inferCodeLanguage,
  parseMarkdownFrontmatter,
} from "../side-panel-utils"
import type { StudioSidePanelFilePreview } from "../types"
import {
  readStudioWorkspaceDataUrlFile,
  readStudioWorkspaceTextFile,
  type StudioWorkspaceTransport,
} from "../workspace-transport"
import type { StudioRightPanelLabels } from "./labels"
import {
  StudioBinaryFilePreview,
  StudioStructuredTextFilePreview,
} from "./artifact-previews"

export function StudioSidePanelPreview({
  preview,
  workspace,
  labels,
  focusLine = null,
  focusColumn = null,
  focusEndLine = null,
}: {
  preview: StudioSidePanelFilePreview
  workspace: StudioWorkspaceTransport
  labels: StudioRightPanelLabels
  focusLine?: number | null
  focusColumn?: number | null
  focusEndLine?: number | null
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
    const descriptor = getStudioFileDescriptor(preview.entry.path)

    if (
      !focusLine &&
      (descriptor.kind === "spreadsheet" ||
        descriptor.kind === "notebook" ||
        descriptor.kind === "molecule")
    ) {
      return (
        <StudioStructuredTextFilePreview
          entry={preview.entry}
          file={preview.file}
          truncatedLabel={labels.truncated}
        />
      )
    }

    return (
      <StudioTextFilePreview
        entry={preview.entry}
        file={preview.file}
        workspace={workspace}
        labels={labels}
        focusLine={focusLine}
        focusColumn={focusColumn}
        focusEndLine={focusEndLine}
      />
    )
  }

  if (preview.kind === "binary") {
    return <StudioBinaryFilePreview entry={preview.entry} file={preview.file} />
  }

  return (
    <StudioUnsupportedFilePreview
      entry={preview.entry}
      error={preview.kind === "unsupported" ? preview.error : undefined}
      labels={labels}
    />
  )
}

function StudioUnsupportedFilePreview({
  entry,
  error,
  labels,
}: {
  entry: AstraFlowSidePanelDirectoryEntry
  error?: string
  labels: StudioRightPanelLabels
}) {
  return (
    <div className="flex h-full min-h-56 items-center justify-center p-8">
      <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
        <StudioFileTypeIcon path={entry.path} size="medium" />
        <div className="flex min-w-0 max-w-full flex-col gap-0.5">
          <strong className="truncate text-sm font-semibold text-foreground">
            {entry.name}
          </strong>
          {entry.size ? (
            <span className="text-xs text-muted-foreground">
              {formatSidePanelFileSize(entry.size)}
            </span>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm text-foreground">{labels.noPreview}</span>
          <span className="text-xs leading-5 text-muted-foreground">
            {error || labels.noPreviewDescription}
          </span>
        </div>
      </div>
    </div>
  )
}

export function StudioTextFilePreview({
  entry,
  file,
  workspace,
  labels,
  focusLine = null,
  focusColumn = null,
  focusEndLine = null,
}: {
  entry: AstraFlowSidePanelDirectoryEntry
  file: AstraFlowSidePanelTextFile
  workspace: StudioWorkspaceTransport
  labels: StudioRightPanelLabels
  focusLine?: number | null
  focusColumn?: number | null
  focusEndLine?: number | null
}) {
  const codeContainerRef = React.useRef<HTMLDivElement | null>(null)
  const isMarkdown =
    entry.extension === "md" ||
    entry.extension === "mdx" ||
    entry.extension === "markdown" ||
    entry.name.endsWith(".md") ||
    entry.name.endsWith(".mdx") ||
    entry.name.endsWith(".markdown")
  const isHtml =
    entry.extension === "html" ||
    entry.extension === "htm" ||
    entry.name.endsWith(".html") ||
    entry.name.endsWith(".htm")
  const showCode = Boolean(focusLine) || (!isMarkdown && (!isHtml || file.truncated))

  React.useEffect(() => {
    if (!focusLine || !showCode) {
      return
    }

    const firstLine = focusLine
    let cancelled = false
    let flashTimeout = 0
    let highlightedLines: HTMLElement[] = []
    let columnTarget: HTMLElement | null = null

    function clearFocusDecoration() {
      window.clearTimeout(flashTimeout)

      for (const highlightedLine of highlightedLines) {
        highlightedLine.classList.remove(
          "bg-primary/10",
          "outline",
          "outline-1",
          "outline-primary/30"
        )
      }
      highlightedLines = []
      columnTarget?.classList.remove("studio-code-column-focus")
      columnTarget?.style.removeProperty("--studio-code-focus-column")
      columnTarget = null
    }

    function tryScrollToLine() {
      if (cancelled) {
        return
      }

      clearFocusDecoration()
      const lines = Array.from(
        codeContainerRef.current?.querySelectorAll<HTMLElement>(
          "pre code .line"
        ) ?? []
      )
      const target =
        lines.find(
          (line) => Number(line.dataset.lineNumber) === firstLine
        ) ?? lines[firstLine - 1]

      if (!target) {
        return
      }

      const lastLine = Math.min(
        Math.max(firstLine, focusEndLine ?? firstLine),
        firstLine + 199
      )
      highlightedLines = lines.filter((line, index) => {
        const lineNumber = Number(line.dataset.lineNumber) || index + 1

        return lineNumber >= firstLine && lineNumber <= lastLine
      })

      target.scrollIntoView({ block: "center" })

      for (const highlightedLine of highlightedLines) {
        highlightedLine.classList.add(
          "bg-primary/10",
          "outline",
          "outline-1",
          "outline-primary/30"
        )
      }
      if (focusColumn && target) {
        const boundedColumn = Math.min(10_000, Math.max(1, focusColumn))
        columnTarget = target
        target.classList.add("studio-code-column-focus")
        // 2.75rem = the 2rem line-number gutter + its 0.75rem margin.
        target.style.setProperty(
          "--studio-code-focus-column",
          `calc(2.75rem + ${boundedColumn - 1}ch)`
        )
        const scrollContainer = target.closest<HTMLElement>(
          "[data-code-scroll-container]"
        )
        const computedStyle = window.getComputedStyle(target)
        const characterWidth =
          Number.parseFloat(computedStyle.fontSize || "12") * 0.6

        scrollContainer?.scrollTo({
          left: Math.max(
            0,
            target.offsetLeft +
              44 +
              (boundedColumn - 1) * characterWidth -
              scrollContainer.clientWidth / 2
          ),
          behavior: "smooth",
        })
      }
      flashTimeout = window.setTimeout(() => {
        for (const highlightedLine of highlightedLines) {
          highlightedLine.classList.remove(
            "bg-primary/10",
            "outline",
            "outline-1",
            "outline-primary/30"
          )
        }
        columnTarget?.classList.remove("studio-code-column-focus")
        columnTarget?.style.removeProperty("--studio-code-focus-column")
      }, 2400)
    }

    const observer = new MutationObserver(tryScrollToLine)

    if (codeContainerRef.current) {
      observer.observe(codeContainerRef.current, {
        childList: true,
        subtree: true,
      })
    }
    tryScrollToLine()

    return () => {
      cancelled = true
      observer.disconnect()
      clearFocusDecoration()
    }
  }, [focusColumn, focusEndLine, focusLine, showCode, file.content])

  if (isMarkdown && !focusLine) {
    return (
      <StudioMarkdownFilePreview
        file={file}
        workspace={workspace}
        labels={labels}
      />
    )
  }

  if (isHtml && !file.truncated && !focusLine) {
    return (
      <StudioHtmlFilePreview entry={entry} file={file} workspace={workspace} />
    )
  }

  return (
    <div
      ref={codeContainerRef}
      className="studio-code-file-preview min-h-full bg-background"
    >
      <CodeBlock className="rounded-none border-0 bg-transparent">
        <CodeBlockCode
          code={file.content}
          language={inferCodeLanguage(entry)}
          renderFallbackLines
          fallbackFocusLine={focusLine}
          fallbackFocusEndLine={focusEndLine}
          className="text-[12px] leading-5 [&>pre]:min-h-full [&>pre]:py-4 [&>pre]:pr-4 [&>pre]:pl-0"
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

const MAX_HTML_PREVIEW_ASSETS = 20
const MAX_HTML_PREVIEW_ASSET_BYTES = 4 * 1024 * 1024
const MAX_HTML_PREVIEW_TOTAL_ASSET_BYTES = 12 * 1024 * 1024

function getRemoteHtmlTarget(value: string, baseDirectory: string) {
  const resolvedHref = resolveMarkdownRelativeFileHref(value, baseDirectory)
  const target = parseFilePathHrefTarget(resolvedHref)

  return target ? { href: resolvedHref, path: target.path } : null
}

function getRemotePathDirectory(path: string) {
  const normalized = path.replaceAll("\\", "/")
  const separatorIndex = normalized.lastIndexOf("/")

  return separatorIndex > 0 ? normalized.slice(0, separatorIndex) : normalized
}

async function prepareWorkspaceHtmlPreview(
  content: string,
  baseDirectory: string,
  workspace: StudioWorkspaceTransport
) {
  const document = new DOMParser().parseFromString(content, "text/html")
  let remainingBytes = MAX_HTML_PREVIEW_TOTAL_ASSET_BYTES
  let loadedAssets = 0

  async function readDataUrl(path: string) {
    if (remainingBytes <= 0 || loadedAssets >= MAX_HTML_PREVIEW_ASSETS) {
      return null
    }

    try {
      const file = await readStudioWorkspaceDataUrlFile(
        workspace,
        path,
        Math.min(MAX_HTML_PREVIEW_ASSET_BYTES, remainingBytes)
      )

      remainingBytes -= file.size
      loadedAssets += 1
      return file.dataUrl
    } catch {
      return null
    }
  }

  async function rewriteCssUrls(css: string, directory: string) {
    const matches = Array.from(
      css.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)
    )
    const replacements = new Map<string, string>()

    for (const match of matches) {
      const value = match[2]?.trim()

      if (!value || value.startsWith("data:") || replacements.has(value)) {
        continue
      }

      const target = getRemoteHtmlTarget(value, directory)

      if (
        !target ||
        getStudioFileDescriptor(target.path).kind !== "image"
      ) {
        continue
      }

      const dataUrl = await readDataUrl(target.path)

      if (dataUrl) {
        replacements.set(value, dataUrl)
      }
    }

    return css.replace(
      /url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
      (source, _quote: string, value: string) => {
        const replacement = replacements.get(value.trim())
        return replacement ? `url("${replacement}")` : source
      }
    )
  }

  for (const link of Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]')
  )) {
    const target = getRemoteHtmlTarget(
      link.getAttribute("href") ?? "",
      baseDirectory
    )

    if (
      !target ||
      getStudioFileDescriptor(target.path).extension !== "css" ||
      loadedAssets >= MAX_HTML_PREVIEW_ASSETS
    ) {
      continue
    }

    try {
      const file = await readStudioWorkspaceTextFile(workspace, target.path)

      if (file.truncated || file.size > remainingBytes) {
        continue
      }

      remainingBytes -= file.size
      loadedAssets += 1
      const style = document.createElement("style")
      style.textContent = await rewriteCssUrls(
        file.content,
        getRemotePathDirectory(target.path)
      )
      link.replaceWith(style)
    } catch {
      // Leave the stylesheet unavailable rather than resolving it against the
      // AstraFlow application origin.
    }
  }

  for (const style of Array.from(document.querySelectorAll("style"))) {
    style.textContent = await rewriteCssUrls(
      style.textContent ?? "",
      baseDirectory
    )
  }

  for (const script of Array.from(document.querySelectorAll("script"))) {
    script.remove()
  }

  for (const element of Array.from(
    document.querySelectorAll<HTMLElement>("[src]")
  )) {
    const source = element.getAttribute("src") ?? ""
    const target = getRemoteHtmlTarget(source, baseDirectory)

    if (
      !target ||
      getStudioFileDescriptor(target.path).kind !== "image"
    ) {
      continue
    }

    const dataUrl = await readDataUrl(target.path)

    if (dataUrl) {
      element.setAttribute("src", dataUrl)
    } else {
      element.removeAttribute("src")
    }
  }

  for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = anchor.getAttribute("href") ?? ""
    const target = getRemoteHtmlTarget(href, baseDirectory)

    if (target) {
      anchor.setAttribute("href", "#")
    } else if (/^https?:/i.test(href)) {
      anchor.target = "_blank"
      anchor.rel = "noreferrer"
    }
  }

  for (const base of Array.from(document.querySelectorAll("base"))) {
    base.remove()
  }
  const safeBase = document.createElement("base")
  safeBase.href = "about:blank"
  document.head.prepend(safeBase)

  return `<!doctype html>\n${document.documentElement.outerHTML}`
}

export function StudioHtmlFilePreview({
  entry,
  file,
  workspace,
}: {
  entry: AstraFlowSidePanelDirectoryEntry
  file: AstraFlowSidePanelTextFile
  workspace: StudioWorkspaceTransport
}) {
  const { t } = useI18n()
  const [view, setView] = React.useState<"rendered" | "source">("source")
  const [preparing, setPreparing] = React.useState(false)
  const [preparedPreview, setPreparedPreview] = React.useState<{
    key: string
    content: string
  } | null>(null)
  const previewRequestRef = React.useRef(0)
  const previewKey = `${file.path}:${file.modifiedAt}`

  async function handleShowRendered() {
    const cached = preparedPreview?.key === previewKey

    if (cached) {
      setView("rendered")
      return
    }

    const requestId = previewRequestRef.current + 1
    previewRequestRef.current = requestId
    setPreparing(true)

    try {
      const content = await prepareWorkspaceHtmlPreview(
        file.content,
        file.directory,
        workspace
      )

      if (previewRequestRef.current === requestId) {
        setPreparedPreview({ key: previewKey, content })
        setView("rendered")
      }
    } catch {
      if (previewRequestRef.current === requestId) {
        setView("source")
      }
    } finally {
      if (previewRequestRef.current === requestId) {
        setPreparing(false)
      }
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3">
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {entry.name}
        </span>
        <div className="flex shrink-0 items-center gap-1 rounded-lg bg-muted/60 p-0.5">
          <button
            type="button"
            onClick={() => void handleShowRendered()}
            disabled={preparing}
            className={cn(
              "rounded-md px-2 py-0.5 text-xs transition-colors",
              view === "rendered" && preparedPreview?.key === previewKey
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
      {view === "rendered" && preparedPreview?.key === previewKey ? (
        <div className="min-h-0 flex-1 bg-white">
          <iframe
            key={entry.path}
            title={entry.name}
            srcDoc={preparedPreview.content}
            className="size-full border-0 bg-white"
            sandbox=""
            referrerPolicy="no-referrer"
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <CodeBlock className="rounded-none border-0 bg-transparent">
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
  workspace,
  labels,
}: {
  file: AstraFlowSidePanelTextFile
  workspace: StudioWorkspaceTransport
  labels: StudioRightPanelLabels
}) {
  const parsed = React.useMemo(
    () => parseMarkdownFrontmatter(file.content),
    [file.content]
  )
  const mediaKey = `${file.path}:${file.modifiedAt}`
  const [localMedia, setLocalMedia] = React.useState<{
    key: string
    urls: Record<string, string>
  }>({ key: "", urls: {} })

  React.useEffect(() => {
    let cancelled = false

    const source = parsed.body || file.content
    const targets = new Map<string, string>()
    const imagePattern = /!\[[^\]]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))/g
    let match: RegExpExecArray | null

    while ((match = imagePattern.exec(source)) && targets.size < 12) {
      const originalHref = match[1] ?? match[2]
      const resolvedHref = resolveMarkdownRelativeFileHref(
        originalHref,
        file.directory
      )
      const target = parseFilePathHrefTarget(resolvedHref)

      if (
        !target ||
        getStudioFileDescriptor(target.path).kind !== "image"
      ) {
        continue
      }

      targets.set(resolvedHref, target.path)
    }

    void (async () => {
      const entries: Array<readonly [string, string]> = []
      const maxImageBytes = 4 * 1024 * 1024
      const maxTotalBytes = 12 * 1024 * 1024
      let totalBytes = 0

      for (const [resolvedHref, path] of targets) {
        if (cancelled || totalBytes >= maxTotalBytes) {
          break
        }

        try {
          const previewFile = await readStudioWorkspaceDataUrlFile(
            workspace,
            path,
            Math.min(maxImageBytes, maxTotalBytes - totalBytes)
          )

          totalBytes += previewFile.size
          entries.push([resolvedHref, previewFile.dataUrl])
        } catch {
          // Fall back to the Markdown alt text when an asset is too large or
          // unavailable through the selected workspace transport.
        }
      }

      if (cancelled) {
        return
      }

      setLocalMedia({
        key: mediaKey,
        urls: Object.fromEntries(entries),
      })
    })()

    return () => {
      cancelled = true
    }
  }, [file.content, file.directory, mediaKey, parsed.body, workspace])
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

      <Markdown
        openLinksInWorkspace
        workspaceBaseDirectory={file.directory}
        mediaUrlMap={localMedia.key === mediaKey ? localMedia.urls : undefined}
        className="max-w-none [--markdown-font-size:15px] [--markdown-line-height:24px]"
      >
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
