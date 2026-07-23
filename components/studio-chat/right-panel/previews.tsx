"use client"

import * as React from "react"
import { RiDownloadLine } from "@remixicon/react"

import { CodeBlock, CodeBlockCode } from "@/components/prompt-kit/code-block"
import { Markdown } from "@/components/chat-markdown"
import { useI18n } from "@/components/i18n-provider"
import { StudioFileTypeIcon } from "@/components/studio-file-type-icon"
import { Button } from "@/components/ui/button"
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
  getStudioWorkspaceFileDownloadHref,
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
  revision = null,
  requireRevisionValidation = false,
}: {
  preview: StudioSidePanelFilePreview
  workspace: StudioWorkspaceTransport
  labels: StudioRightPanelLabels
  focusLine?: number | null
  focusColumn?: number | null
  focusEndLine?: number | null
  revision?: string | null
  requireRevisionValidation?: boolean
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
        revision={revision}
        requireRevisionValidation={requireRevisionValidation}
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
      workspace={workspace}
    />
  )
}

function StudioUnsupportedFilePreview({
  entry,
  error,
  labels,
  workspace,
}: {
  entry: AstraFlowSidePanelDirectoryEntry
  error?: string
  labels: StudioRightPanelLabels
  workspace: StudioWorkspaceTransport
}) {
  const downloadHref = getStudioWorkspaceFileDownloadHref(workspace, entry.path)

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
            {error ||
              (downloadHref
                ? labels.noPreviewDownloadDescription
                : labels.noPreviewDescription)}
          </span>
        </div>
        {downloadHref ? (
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <a href={downloadHref} download={entry.name}>
              <RiDownloadLine aria-hidden className="size-4" />
              <span>{labels.downloadFile}</span>
            </a>
          </Button>
        ) : null}
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
  revision = null,
  requireRevisionValidation = false,
}: {
  entry: AstraFlowSidePanelDirectoryEntry
  file: AstraFlowSidePanelTextFile
  workspace: StudioWorkspaceTransport
  labels: StudioRightPanelLabels
  focusLine?: number | null
  focusColumn?: number | null
  focusEndLine?: number | null
  revision?: string | null
  requireRevisionValidation?: boolean
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
      <StudioHtmlFilePreview
        entry={entry}
        file={file}
        workspace={workspace}
        revision={revision}
        requireRevisionValidation={requireRevisionValidation}
      />
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

export async function prepareWorkspaceHtmlPreview(
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
    const withoutImports = css.replace(
      /@import\s+(?:url\([^)]*\)|["'][^"']*["'])[^;]*;?/gi,
      ""
    )
    const matches = Array.from(
      withoutImports.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)
    )
    const replacements = new Map<string, string | null>()

    for (const match of matches) {
      const value = match[2]?.trim()

      if (!value || replacements.has(value)) {
        continue
      }

      if (value.startsWith("#")) {
        replacements.set(value, value)
        continue
      }

      if (/^data:(?:image|font)\//i.test(value)) {
        replacements.set(value, value)
        continue
      }

      const target = getRemoteHtmlTarget(value, directory)

      if (
        !target ||
        getStudioFileDescriptor(target.path).kind !== "image"
      ) {
        replacements.set(value, null)
        continue
      }

      const dataUrl = await readDataUrl(target.path)

      replacements.set(value, dataUrl)
    }

    return withoutImports.replace(
      /url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
      (source, _quote: string, value: string) => {
        const replacement = replacements.get(value.trim())

        if (replacement === undefined) {
          return source
        }

        return replacement ? `url("${replacement}")` : 'url("")'
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
      link.remove()
      continue
    }

    try {
      const file = await readStudioWorkspaceTextFile(workspace, target.path)

      if (file.truncated || file.size > remainingBytes) {
        link.remove()
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
      link.remove()
    }
  }

  for (const link of Array.from(document.querySelectorAll("link"))) {
    link.remove()
  }

  for (const style of Array.from(document.querySelectorAll("style"))) {
    style.textContent = await rewriteCssUrls(
      style.textContent ?? "",
      baseDirectory
    )
  }

  for (const element of Array.from(
    document.querySelectorAll(
      "script, iframe, frame, frameset, object, embed, portal"
    )
  )) {
    element.remove()
  }

  for (const meta of Array.from(
    document.querySelectorAll<HTMLMetaElement>("meta[http-equiv]")
  )) {
    meta.remove()
  }

  for (const element of Array.from(
    document.querySelectorAll<HTMLElement>("[src]")
  )) {
    const source = element.getAttribute("src") ?? ""
    const isSafeInlineImage =
      element.tagName === "IMG" && /^data:image\//i.test(source)

    if (isSafeInlineImage) {
      continue
    }

    const target = getRemoteHtmlTarget(source, baseDirectory)

    if (
      !target ||
      getStudioFileDescriptor(target.path).kind !== "image" ||
      element.tagName !== "IMG"
    ) {
      element.removeAttribute("src")
      continue
    }

    const dataUrl = await readDataUrl(target.path)

    if (dataUrl) {
      element.setAttribute("src", dataUrl)
    } else {
      element.removeAttribute("src")
    }
  }

  for (const element of Array.from(
    document.querySelectorAll<HTMLElement>("*")
  )) {
    for (const attribute of Array.from(element.attributes)) {
      if (
        attribute.name.toLowerCase().startsWith("on") ||
        [
          "srcdoc",
          "srcset",
          "poster",
          "action",
          "formaction",
          "background",
          "manifest",
        ].includes(attribute.name.toLowerCase())
      ) {
        element.removeAttribute(attribute.name)
      }
    }

    if (element.hasAttribute("style")) {
      element.setAttribute(
        "style",
        await rewriteCssUrls(element.getAttribute("style") ?? "", baseDirectory)
      )
    }
  }

  for (const anchor of Array.from(
    document.querySelectorAll<HTMLAnchorElement>("a[href]")
  )) {
    const href = anchor.getAttribute("href") ?? ""

    anchor.setAttribute("href", href.startsWith("#") ? href : "#")
    anchor.removeAttribute("target")
    anchor.removeAttribute("ping")
  }

  for (const element of Array.from(
    document.querySelectorAll<HTMLElement>("[href], [xlink\\:href]")
  )) {
    if (element.tagName === "A") {
      continue
    }

    for (const attributeName of ["href", "xlink:href"]) {
      const value = element.getAttribute(attributeName)

      if (value && !value.startsWith("#")) {
        element.removeAttribute(attributeName)
      }
    }
  }

  for (const base of Array.from(document.querySelectorAll("base"))) {
    base.remove()
  }
  const policy = document.createElement("meta")
  policy.httpEquiv = "Content-Security-Policy"
  policy.content =
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
  document.head.prepend(policy)

  return `<!doctype html>\n${document.documentElement.outerHTML}`
}

export async function validateWorkspaceHtmlPreviewRevision(
  content: string,
  revision: string | null | undefined
) {
  const normalizedRevision = revision?.trim().toLowerCase() ?? ""

  if (
    !/^[a-f0-9]{64}$/.test(normalizedRevision) ||
    !globalThis.crypto?.subtle
  ) {
    return false
  }

  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(content)
  )
  const actualRevision = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")

  return actualRevision === normalizedRevision
}

export function StudioHtmlFilePreview({
  entry,
  file,
  workspace,
  revision = null,
  requireRevisionValidation = false,
}: {
  entry: AstraFlowSidePanelDirectoryEntry
  file: AstraFlowSidePanelTextFile
  workspace: StudioWorkspaceTransport
  revision?: string | null
  requireRevisionValidation?: boolean
}) {
  const { locale, t } = useI18n()
  const normalizedRevision = revision?.trim().toLowerCase()
  const previewKey = `${file.path}:${
    normalizedRevision
      ? `sha256:${normalizedRevision}`
      : `mtime:${file.modifiedAt}`
  }`
  const [viewSelection, setViewSelection] = React.useState<{
    key: string
    view: "rendered" | "source"
  }>(() => ({ key: previewKey, view: "rendered" }))
  const [preparedPreview, setPreparedPreview] = React.useState<{
    key: string
    content: string
  } | null>(null)
  const [failedPreviewKey, setFailedPreviewKey] = React.useState<string | null>(
    null
  )
  const [previewRetry, setPreviewRetry] = React.useState({
    attempt: 0,
    key: "",
  })
  const view =
    viewSelection.key === previewKey ? viewSelection.view : "rendered"
  const retryAttempt =
    previewRetry.key === previewKey ? previewRetry.attempt : 0

  React.useEffect(() => {
    if (preparedPreview?.key === previewKey) {
      return
    }

    let cancelled = false

    void (async () => {
      if (
        requireRevisionValidation &&
        !(await validateWorkspaceHtmlPreviewRevision(
          file.content,
          normalizedRevision
        ))
      ) {
        throw new Error("Workspace HTML revision mismatch.")
      }

      return prepareWorkspaceHtmlPreview(
        file.content,
        file.directory,
        workspace
      )
    })()
      .then((content) => {
        if (cancelled) {
          return
        }

        setPreparedPreview({ key: previewKey, content })
        setFailedPreviewKey((current) =>
          current === previewKey ? null : current
        )
      })
      .catch(() => {
        if (cancelled) {
          return
        }

        setFailedPreviewKey(previewKey)
        setViewSelection((current) =>
          current.key !== previewKey || current.view === "rendered"
            ? { key: previewKey, view: "source" }
            : current
        )
      })

    return () => {
      cancelled = true
    }
  }, [
    file.content,
    file.directory,
    preparedPreview?.key,
    previewKey,
    requireRevisionValidation,
    retryAttempt,
    normalizedRevision,
    workspace,
  ])

  function handleShowRendered() {
    setViewSelection({ key: previewKey, view: "rendered" })

    if (failedPreviewKey === previewKey) {
      setFailedPreviewKey(null)
      setPreviewRetry((current) => ({
        attempt: current.key === previewKey ? current.attempt + 1 : 1,
        key: previewKey,
      }))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {entry.name}
          </span>
          <span className="shrink-0 rounded-full border bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {locale === "zh"
              ? "安全预览 · 脚本已禁用"
              : "Safe preview · scripts off"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-lg bg-muted/60 p-0.5">
          <button
            type="button"
            aria-pressed={view === "rendered"}
            onClick={handleShowRendered}
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
            aria-pressed={view === "source"}
            onClick={() =>
              setViewSelection({ key: previewKey, view: "source" })
            }
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
        preparedPreview?.key === previewKey ? (
          <div className="min-h-0 flex-1 bg-white">
            <iframe
              key={previewKey}
              title={entry.name}
              srcDoc={preparedPreview.content}
              className="size-full border-0 bg-white"
              sandbox=""
              referrerPolicy="no-referrer"
            />
          </div>
        ) : (
          <div
            aria-busy="true"
            className="flex min-h-0 flex-1 items-center justify-center gap-2 bg-white text-xs text-muted-foreground"
          >
            <span
              aria-hidden
              className="size-4 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-muted-foreground"
            />
            {t.studioFilePreviewPreparing}
          </div>
        )
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
