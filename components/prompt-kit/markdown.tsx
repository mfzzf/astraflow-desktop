"use client"

import {
  RiCheckLine,
  RiCodeLine,
  RiDownloadLine,
  RiExternalLinkLine,
  RiFileCopyLine,
  RiPlayLine,
  RiSaveLine,
} from "@remixicon/react"
import {
  memo,
  type MouseEvent,
  type MouseEventHandler,
  useId,
  useMemo,
  useState,
} from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"

import {
  CodeBlock,
  CodeBlockCode,
  CodeBlockGroup,
} from "@/components/prompt-kit/code-block"
import { StudioFileTypeIcon } from "@/components/studio-file-type-icon"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  getFilePathChipBasename,
  type MarkdownFilePathTarget,
  parseFilePathHrefTarget,
  parseFilePathText,
  remarkFilePathChips,
  resolveMarkdownRelativeFileHref,
} from "@/lib/markdown-file-paths"
import {
  createStreamingMarkdownBlockCache,
  isCompleteHtmlFenceBlock,
  isHtmlLanguage,
  repairStreamingMarkdown,
  type StreamingMarkdownRepair,
} from "@/lib/markdown-streaming"
import {
  getExternalMarkdownImageRoute,
  getOpenableMarkdownUrl,
  getStudioMarkdownMediaRoute,
  getWorkspaceMarkdownTarget,
  isLikelyExternalImageUrl,
  openMarkdownHrefInWorkspace,
  openMarkdownLink,
  openMarkdownTargetInWorkspace,
  resolveMappedMediaUrl,
  type StudioMarkdownMediaRoute,
  transformWorkspaceMarkdownUrl,
} from "@/lib/studio-markdown-links"
import {
  isStudioAppDownloadHref,
  isStudioExternalFileHref,
  STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
  type StudioOpenMarkdownTargetDetail,
} from "@/lib/studio-markdown-open"
import { cn } from "@/lib/utils"

export type MarkdownProps = {
  children: string
  id?: string
  className?: string
  autoPreviewHtml?: boolean
  mediaSaveSessionId?: string | null
  mediaUrlMap?: Record<string, string>
  openLinksInWorkspace?: boolean
  workspaceBaseDirectory?: string | null
  streaming?: boolean
  components?: Partial<Components>
}

export {
  createStreamingMarkdownBlockCache,
  parseMarkdownIntoBlocks,
  repairStreamingMarkdown,
} from "@/lib/markdown-streaming"
export type { StreamingMarkdownRepair } from "@/lib/markdown-streaming"

function getFilePathChipLineLabel(target: MarkdownFilePathTarget) {
  if (!target.line) {
    return null
  }

  const column = target.column ? `:${target.column}` : ""
  const range = target.endLine ? `-${target.endLine}` : ""

  return `(line ${target.line}${column}${range})`
}

function getPlainTextChildren(children: React.ReactNode): string | null {
  if (typeof children === "string" || typeof children === "number") {
    return String(children)
  }

  if (!Array.isArray(children)) {
    return null
  }

  let text = ""

  for (const child of children) {
    if (typeof child === "string" || typeof child === "number") {
      text += String(child)
      continue
    }

    return null
  }

  return text || null
}

function FilePathChip({
  target,
  label,
}: {
  target: MarkdownFilePathTarget
  label?: React.ReactNode
}) {
  const lineLabel = getFilePathChipLineLabel(target)

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()

    window.dispatchEvent(
      new CustomEvent<StudioOpenMarkdownTargetDetail>(
        STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
        {
          detail: {
            href: target.path,
            source: "link",
            line: target.line,
            column: target.column,
            endLine: target.endLine,
          },
        }
      )
    )
  }

  return (
    <button
      type="button"
      title={target.path}
      onClick={handleClick}
      className="markdown-file-reference not-prose"
    >
      <StudioFileTypeIcon path={target.path} size="small" />
      <span className="truncate">
        {label ?? getFilePathChipBasename(target.path)}
      </span>
      {lineLabel ? <span className="shrink-0">{lineLabel}</span> : null}
    </button>
  )
}

function CodeActionButton({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & {
  label: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

function MarkdownMediaActions({
  media,
  saveSessionId,
}: {
  media: StudioMarkdownMediaRoute
  saveSessionId?: string | null
}) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const canSave = Boolean(media.saveUrl || (media.sourceUrl && saveSessionId))

  async function handleSave(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()

    if (saving) {
      return
    }

    setSaving(true)

    try {
      const response = media.saveUrl
        ? await fetch(media.saveUrl, { method: "POST" })
        : await fetch("/api/studio/media-url/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: media.filename,
              kind: media.kind,
              sessionId: saveSessionId,
              url: media.sourceUrl,
            }),
          })
      const payload = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      if (!response.ok) {
        throw new Error(payload?.error ?? "Save failed.")
      }

      setSaved(true)
      toast.success("Saved to Files")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <span className="not-prose inline-flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            asChild
            variant="secondary"
            size="icon-sm"
            className="size-8 bg-background/90 shadow-sm backdrop-blur hover:bg-background"
            aria-label="Download"
          >
            <a
              href={media.downloadUrl}
              download={media.filename}
              onClick={(event) => event.stopPropagation()}
            >
              <RiDownloadLine aria-hidden />
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Download</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="size-8 bg-background/90 shadow-sm backdrop-blur hover:bg-background"
            aria-label="Save to Files"
            disabled={!canSave || saving}
            onClick={handleSave}
          >
            {saved ? <RiCheckLine aria-hidden /> : <RiSaveLine aria-hidden />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {canSave ? "Save to Files" : "Cannot save this image"}
        </TooltipContent>
      </Tooltip>
    </span>
  )
}

type MarkdownLinkClickContext = {
  href: string
  directDownload: boolean
  openExternally: boolean
  openableUrl: string | null
  openLinksInWorkspace: boolean
  onClick?: MouseEventHandler<HTMLAnchorElement>
}

// Shared click routing for both plain links and media links. Keep the branch
// order stable: app downloads stay anchor downloads, explicit external files
// leave the app, workspace mode routes everything else into the workspace,
// and as a last resort openable URLs go to the system browser.
function handleMarkdownLinkClick(
  event: MouseEvent<HTMLAnchorElement>,
  {
    href,
    directDownload,
    openExternally,
    openableUrl,
    openLinksInWorkspace,
    onClick,
  }: MarkdownLinkClickContext
) {
  onClick?.(event)

  if (event.defaultPrevented || event.button !== 0) {
    return
  }

  if (directDownload) {
    return
  }

  if (openExternally && openableUrl) {
    event.preventDefault()
    openMarkdownLink(openableUrl)
    return
  }

  if (openLinksInWorkspace && href && !href.startsWith("#")) {
    // Never fall through to anchor navigation — an unresolvable target
    // would navigate the app window to its default HTML page.
    event.preventDefault()
    openMarkdownHrefInWorkspace(href, "link", openableUrl)
    return
  }

  if (openableUrl) {
    if (openMarkdownLink(openableUrl)) {
      event.preventDefault()
    }
    return
  }

  if (href && !href.startsWith("#")) {
    event.preventDefault()
  }
}

function MarkdownMediaLink({
  anchorProps,
  children,
  directDownload,
  href,
  media,
  onClick,
  openExternally,
  openableUrl,
  openLinksInWorkspace,
  saveSessionId,
}: {
  anchorProps: React.AnchorHTMLAttributes<HTMLAnchorElement>
  children: React.ReactNode
  directDownload: boolean
  href: string
  media: StudioMarkdownMediaRoute
  onClick?: React.MouseEventHandler<HTMLAnchorElement>
  openExternally: boolean
  openableUrl: string | null
  openLinksInWorkspace: boolean
  saveSessionId?: string | null
}) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    handleMarkdownLinkClick(event, {
      href,
      directDownload,
      openExternally,
      openableUrl,
      openLinksInWorkspace,
      onClick,
    })
  }

  return (
    <span className="not-prose inline-flex max-w-full items-center gap-1.5 align-middle">
      <a
        {...anchorProps}
        href={href}
        download={directDownload ? "" : anchorProps.download}
        target={!directDownload && openableUrl ? "_blank" : undefined}
        rel={!directDownload && openableUrl ? "noreferrer" : undefined}
        onClick={handleClick}
      >
        {children}
      </a>
      <MarkdownMediaActions media={media} saveSessionId={saveSessionId} />
    </span>
  )
}

function MarkdownTableFrame({
  children,
  source,
}: {
  children: React.ReactNode
  source: string
}) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    void navigator.clipboard.writeText(source.trim())
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1100)
  }

  return (
    <div className="chatgpt-table-container not-prose">
      <div className="chatgpt-table-wrapper">
        {children}
        <button
          type="button"
          className="markdown-table-copy"
          aria-label="Copy Markdown table"
          onClick={handleCopy}
        >
          {copied ? (
            <RiCheckLine aria-hidden className="size-3.5" />
          ) : (
            <RiFileCopyLine aria-hidden className="size-3.5" />
          )}
        </button>
      </div>
    </div>
  )
}

function MarkdownCodeBlock({
  code,
  language,
  autoPreviewHtml,
  streaming,
}: {
  code: string
  language: string
  autoPreviewHtml: boolean
  streaming: boolean
}) {
  const canPreview = autoPreviewHtml && isHtmlLanguage(language)
  const [view, setView] = useState<"code" | "preview">("code")
  const [copied, setCopied] = useState(false)
  const [expandedPreviewOpen, setExpandedPreviewOpen] = useState(false)

  function handleCopy() {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <CodeBlock className="chatgpt-code-block my-3 rounded-xl shadow-none">
        <CodeBlockGroup className="chatgpt-code-header gap-3 border-b px-3 py-0">
          <div className="flex min-w-0 items-center gap-2">
            <RiCodeLine
              aria-hidden
              className="size-3.5 text-muted-foreground"
            />
            <span className="truncate text-xs font-medium">
              {getLanguageLabel(language)}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {canPreview ? (
              <>
                <CodeActionButton
                  label="Show code"
                  className={cn(view === "code" && "bg-secondary")}
                  onClick={() => setView("code")}
                >
                  <RiCodeLine aria-hidden />
                </CodeActionButton>
                <CodeActionButton
                  label="Preview HTML"
                  className={cn(view === "preview" && "bg-secondary")}
                  onClick={() => setView("preview")}
                >
                  <RiPlayLine aria-hidden />
                </CodeActionButton>
                <CodeActionButton
                  label="Open preview"
                  onClick={() => setExpandedPreviewOpen(true)}
                >
                  <RiExternalLinkLine aria-hidden />
                </CodeActionButton>
              </>
            ) : null}
            <CodeActionButton label="Copy code" onClick={handleCopy}>
              {copied ? (
                <RiCheckLine aria-hidden className="text-foreground" />
              ) : (
                <RiFileCopyLine aria-hidden />
              )}
            </CodeActionButton>
          </div>
        </CodeBlockGroup>
        {view === "preview" && canPreview ? (
          <div className="h-[420px] bg-white">
            <iframe
              title="HTML preview"
              sandbox="allow-scripts allow-forms"
              srcDoc={code}
              className="size-full border-0 bg-white"
            />
          </div>
        ) : (
          <CodeBlockCode
            code={code}
            language={language}
            streaming={streaming}
            className="chatgpt-code-body"
          />
        )}
      </CodeBlock>

      {canPreview ? (
        <Dialog
          open={expandedPreviewOpen}
          onOpenChange={setExpandedPreviewOpen}
        >
          <DialogContent className="flex h-[min(86vh,780px)] w-[min(92vw,1100px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
            <DialogHeader className="border-b px-4 py-3">
              <DialogTitle className="text-sm">HTML preview</DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 bg-white">
              <iframe
                title="Expanded HTML preview"
                sandbox="allow-scripts allow-forms"
                srcDoc={code}
                className="size-full border-0 bg-white"
              />
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}

function extractLanguage(className?: string): string {
  if (!className) return "plaintext"
  const match = className.match(/language-([^\s]+)/)
  return match ? match[1] : "plaintext"
}

function inferUnlabelledCodeLanguage(code: string) {
  const source = code.trim()

  if (!source) {
    return "plaintext"
  }

  if (/^[\[{]/.test(source)) {
    try {
      JSON.parse(source)
      return "json"
    } catch {
      // Continue with lightweight syntax signals.
    }
  }

  if (/^<!doctype\s+html|^<html\b|^<[A-Za-z][\s\S]*<\/[^>]+>$/i.test(source)) {
    return "html"
  }

  if (/^(?:diff --git|@@ |--- a\/|\+\+\+ b\/)/m.test(source)) {
    return "diff"
  }

  if (/^(?:import|export|interface|type|const|let|function|class)\b/m.test(source)) {
    return /:\s*(?:string|number|boolean|unknown|[A-Z]\w*(?:<[^>]+>)?)/.test(
      source
    )
      ? "typescript"
      : "javascript"
  }

  if (/^(?:from\s+\S+\s+import|import\s+\S+|def\s+\w+|class\s+\w+|print\s*\()/m.test(source)) {
    return "python"
  }

  if (/^(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|WITH)\b/im.test(source)) {
    return "sql"
  }

  if (/^(?:#!.*\b(?:sh|bash|zsh)|(?:npm|bun|pnpm|yarn|git|curl)\s+)/m.test(source)) {
    return "bash"
  }

  if (/^[.#]?[\w-]+(?:\s+[.#]?[\w-]+)*\s*\{[\s\S]*:[^;{}]+;/m.test(source)) {
    return "css"
  }

  return "plaintext"
}

function getLanguageLabel(language: string) {
  return language === "plaintext" ? "Code" : language.toUpperCase()
}

function createMarkdownComponents(
  source: string,
  autoPreviewHtml: boolean,
  mediaSaveSessionId: string | null | undefined,
  mediaUrlMap: Record<string, string> | undefined,
  openLinksInWorkspace: boolean,
  workspaceBaseDirectory: string | null | undefined,
  streaming: boolean
): Partial<Components> {
  return {
    p: function ParagraphComponent({ className, ...props }) {
      return (
        <p className={cn("chatgpt-markdown-paragraph", className)} {...props} />
      )
    },
    h1: function HeadingOneComponent({ className, ...props }) {
      return (
        <h1 className={cn("chatgpt-heading heading-1", className)} {...props} />
      )
    },
    h2: function HeadingTwoComponent({ className, ...props }) {
      return (
        <h2 className={cn("chatgpt-heading heading-2", className)} {...props} />
      )
    },
    h3: function HeadingThreeComponent({ className, ...props }) {
      return (
        <h3 className={cn("chatgpt-heading heading-3", className)} {...props} />
      )
    },
    h4: function HeadingFourComponent({ className, ...props }) {
      return (
        <h4 className={cn("chatgpt-heading heading-4", className)} {...props} />
      )
    },
    h5: function HeadingFiveComponent({ className, ...props }) {
      return (
        <h5 className={cn("chatgpt-heading heading-5", className)} {...props} />
      )
    },
    h6: function HeadingSixComponent({ className, ...props }) {
      return (
        <h6 className={cn("chatgpt-heading heading-6", className)} {...props} />
      )
    },
    ul: function UnorderedListComponent({ className, ...props }) {
      return <ul className={cn("chatgpt-list", className)} {...props} />
    },
    ol: function OrderedListComponent({ className, ...props }) {
      return <ol className={cn("chatgpt-list", className)} {...props} />
    },
    blockquote: function BlockquoteComponent({ className, ...props }) {
      return (
        <blockquote
          className={cn("chatgpt-blockquote", className)}
          {...props}
        />
      )
    },
    hr: function RuleComponent({ className, ...props }) {
      return (
        <hr className={cn("chatgpt-markdown-rule", className)} {...props} />
      )
    },
    table: function TableComponent({ children, node, ...props }) {
      const startOffset = node?.position?.start.offset
      const endOffset = node?.position?.end.offset
      const tableSource =
        typeof startOffset === "number" && typeof endOffset === "number"
          ? source.slice(startOffset, endOffset)
          : source

      return (
        <MarkdownTableFrame source={tableSource}>
          <table {...props}>{children}</table>
        </MarkdownTableFrame>
      )
    },
    a: function LinkComponent(props) {
      const { href, children, node, onClick, ...anchorProps } = props
      void node

      const workspaceHref = openLinksInWorkspace
        ? resolveMarkdownRelativeFileHref(href, workspaceBaseDirectory)
        : href
      const filePathTarget = openLinksInWorkspace
        ? parseFilePathHrefTarget(workspaceHref)
        : null

      if (filePathTarget) {
        return <FilePathChip target={filePathTarget} label={children} />
      }

      const linkedFilePathTarget = openLinksInWorkspace
        ? parseFilePathText(getPlainTextChildren(children) ?? "")
        : null

      if (linkedFilePathTarget) {
        return <FilePathChip target={linkedFilePathTarget} />
      }

      const mappedHref = resolveMappedMediaUrl(workspaceHref, mediaUrlMap)
      const openableUrl = mappedHref ? getOpenableMarkdownUrl(mappedHref) : null
      const appDownload = mappedHref
        ? isStudioAppDownloadHref(mappedHref)
        : false
      const externalFile = mappedHref
        ? isStudioExternalFileHref(mappedHref)
        : false
      const media =
        getStudioMarkdownMediaRoute(mappedHref) ??
        (isLikelyExternalImageUrl(mappedHref)
          ? getExternalMarkdownImageRoute(mappedHref, undefined)
          : null)

      function handleClick(event: MouseEvent<HTMLAnchorElement>) {
        handleMarkdownLinkClick(event, {
          href: mappedHref ?? workspaceHref ?? "",
          directDownload: appDownload,
          openExternally: externalFile,
          openableUrl,
          openLinksInWorkspace,
          onClick,
        })
      }

      if (workspaceHref && media) {
        return (
          <MarkdownMediaLink
            anchorProps={anchorProps}
            directDownload={appDownload}
            href={mappedHref ?? workspaceHref}
            media={media}
            onClick={onClick}
            openExternally={externalFile}
            openableUrl={openableUrl}
            openLinksInWorkspace={openLinksInWorkspace}
            saveSessionId={mediaSaveSessionId}
          >
            {children}
          </MarkdownMediaLink>
        )
      }

      return (
        <a
          {...anchorProps}
          href={mappedHref ?? workspaceHref}
          download={appDownload ? "" : undefined}
          target={!appDownload && openableUrl ? "_blank" : undefined}
          rel={!appDownload && openableUrl ? "noreferrer" : undefined}
          onClick={handleClick}
        >
          {children}
        </a>
      )
    },
    img: function ImageComponent(props) {
      const { src, alt, node, onClick, ...imageProps } = props
      void node
      const imageSrc = typeof src === "string" ? src : undefined
      const workspaceImageSrc = openLinksInWorkspace
        ? resolveMarkdownRelativeFileHref(imageSrc, workspaceBaseDirectory)
        : imageSrc
      const resolvedImageSrc = resolveMappedMediaUrl(
        workspaceImageSrc,
        mediaUrlMap
      )
      const media =
        getStudioMarkdownMediaRoute(resolvedImageSrc) ??
        getExternalMarkdownImageRoute(resolvedImageSrc, alt ?? undefined)
      // The zoom affordance only makes sense when clicking actually opens
      // something. That is exactly the set of images the workspace target
      // resolver accepts; everything else has no click behavior, so a zoom
      // cursor there was misleading.
      const zoomable = Boolean(
        openLinksInWorkspace &&
          workspaceImageSrc &&
          getWorkspaceMarkdownTarget(workspaceImageSrc)
      )

      function handleClick(event: MouseEvent<HTMLImageElement>) {
        onClick?.(event)

        if (
          event.defaultPrevented ||
          !openLinksInWorkspace ||
          !workspaceImageSrc ||
          !openMarkdownTargetInWorkspace(workspaceImageSrc, "image")
        ) {
          return
        }

        event.preventDefault()
      }

      if (media) {
        return (
          <span className="not-prose group relative my-3 block w-fit max-w-full overflow-hidden rounded-xl border bg-card shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              {...imageProps}
              src={resolvedImageSrc}
              alt={alt ?? ""}
              className={cn(
                "chatgpt-markdown-image m-0 max-h-[min(68vh,720px)] max-w-full object-contain",
                zoomable && "cursor-zoom-in",
                typeof imageProps.className === "string" && imageProps.className
              )}
              onClick={handleClick}
            />
            <span className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <MarkdownMediaActions
                media={media}
                saveSessionId={mediaSaveSessionId}
              />
            </span>
          </span>
        )
      }

      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          {...imageProps}
          src={resolvedImageSrc ?? src}
          alt={alt ?? ""}
          className={cn(
            "chatgpt-markdown-image",
            zoomable && "cursor-zoom-in",
            typeof imageProps.className === "string" && imageProps.className
          )}
          onClick={handleClick}
        />
      )
    },
    code: function CodeComponent({ className, children, node, ...props }) {
      const hasLanguage = Boolean(className?.includes("language-"))
      const isInline =
        !hasLanguage &&
        (!node?.position?.start.line ||
          node?.position?.start.line === node?.position?.end.line)

      if (isInline) {
        const inlineText = getPlainTextChildren(children)
        const inlineFileTarget =
          openLinksInWorkspace && inlineText
            ? parseFilePathHrefTarget(inlineText)
            : null

        if (inlineFileTarget) {
          return <FilePathChip target={inlineFileTarget} label={children} />
        }

        return (
          <code className={cn("chatgpt-inline-code", className)} {...props}>
            {children}
          </code>
        )
      }

      const code = String(children).replace(/\n$/, "")
      const declaredLanguage = extractLanguage(className)
      const language =
        declaredLanguage === "plaintext"
          ? inferUnlabelledCodeLanguage(code)
          : declaredLanguage

      return (
        <MarkdownCodeBlock
          code={code}
          language={language}
          autoPreviewHtml={autoPreviewHtml}
          streaming={streaming}
        />
      )
    },
    pre: function PreComponent({ children }) {
      return <>{children}</>
    },
  }
}

const MarkdownBlockRenderer = memo(
  function MarkdownBlockRenderer({
    content,
    autoPreviewHtml,
    mediaSaveSessionId,
    mediaUrlMap,
    openLinksInWorkspace,
    workspaceBaseDirectory,
    streaming,
    components,
  }: {
    content: string
    autoPreviewHtml: boolean
    mediaSaveSessionId?: string | null
    mediaUrlMap?: Record<string, string>
    openLinksInWorkspace: boolean
    workspaceBaseDirectory?: string | null
    streaming: boolean
    components?: Partial<Components>
  }) {
    const markdownComponents = useMemo(
      () => ({
        ...createMarkdownComponents(
          content,
          autoPreviewHtml,
          mediaSaveSessionId,
          mediaUrlMap,
          openLinksInWorkspace,
          workspaceBaseDirectory,
          streaming
        ),
        ...components,
      }),
      [
        autoPreviewHtml,
        components,
        content,
        mediaSaveSessionId,
        mediaUrlMap,
        openLinksInWorkspace,
        workspaceBaseDirectory,
        streaming,
      ]
    )

    const remarkPlugins = useMemo(
      () =>
        openLinksInWorkspace ? [remarkGfm, remarkFilePathChips] : [remarkGfm],
      [openLinksInWorkspace]
    )

    // Raw HTML inside Markdown is intentionally not rendered (no rehype-raw):
    // model output is untrusted markup, and dropping raw HTML is the safe
    // default. Fenced ```html blocks get an explicit sandboxed iframe preview
    // instead (see MarkdownCodeBlock).
    return (
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        components={markdownComponents}
        urlTransform={
          openLinksInWorkspace ? transformWorkspaceMarkdownUrl : undefined
        }
      >
        {content}
      </ReactMarkdown>
    )
  },
  function propsAreEqual(prevProps, nextProps) {
    return (
      prevProps.content === nextProps.content &&
      prevProps.autoPreviewHtml === nextProps.autoPreviewHtml &&
      prevProps.mediaSaveSessionId === nextProps.mediaSaveSessionId &&
      prevProps.mediaUrlMap === nextProps.mediaUrlMap &&
      prevProps.openLinksInWorkspace === nextProps.openLinksInWorkspace &&
      prevProps.workspaceBaseDirectory === nextProps.workspaceBaseDirectory &&
      prevProps.streaming === nextProps.streaming &&
      prevProps.components === nextProps.components
    )
  }
)

MarkdownBlockRenderer.displayName = "MarkdownBlockRenderer"

function MarkdownComponent({
  children,
  id,
  className,
  autoPreviewHtml = true,
  mediaSaveSessionId,
  mediaUrlMap,
  openLinksInWorkspace = false,
  workspaceBaseDirectory,
  streaming = false,
  components,
}: MarkdownProps) {
  const generatedId = useId()
  const blockId = id ?? generatedId
  const [blockCache] = useState(createStreamingMarkdownBlockCache)

  const repaired = useMemo<StreamingMarkdownRepair>(
    () =>
      streaming
        ? repairStreamingMarkdown(children)
        : { isCodeFenceOpen: false, markdown: children },
    [children, streaming]
  )
  const blocks = useMemo(() => {
    if (streaming) {
      return blockCache.read(children, repaired.markdown)
    }

    return blockCache.complete(repaired.markdown)
  }, [blockCache, children, repaired.markdown, streaming])

  // A single provider per rendered message keeps code-block and media
  // tooltips working without each block mounting its own provider. The app
  // shell has a root provider too, but this component must also render
  // standalone (SSR tests, previews outside the shell).
  return (
    <TooltipProvider>
      <div
        className={cn("chatgpt-markdown", streaming && "is-streaming", className)}
        data-code-fence-open={repaired.isCodeFenceOpen ? "true" : "false"}
      >
        {blocks.map((block) => (
          <MarkdownBlockRenderer
            key={`${blockId}-${block.key}`}
            content={block.content}
            autoPreviewHtml={
              autoPreviewHtml &&
              !block.mutable &&
              isCompleteHtmlFenceBlock(block.content)
            }
            mediaSaveSessionId={mediaSaveSessionId}
            mediaUrlMap={mediaUrlMap}
            openLinksInWorkspace={openLinksInWorkspace}
            workspaceBaseDirectory={workspaceBaseDirectory}
            streaming={block.mutable}
            components={components}
          />
        ))}
      </div>
    </TooltipProvider>
  )
}

const Markdown = memo(MarkdownComponent)
Markdown.displayName = "Markdown"

export { Markdown }
