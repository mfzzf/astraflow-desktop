"use client"

import {
  RiCheckLine,
  RiDownloadLine,
  RiFileCopyLine,
  RiSaveLine,
} from "@remixicon/react"
import {
  memo,
  type MouseEvent,
  type MouseEventHandler,
  useDeferredValue,
  useMemo,
  useState,
} from "react"
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown"
import rehypeKatex from "rehype-katex"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import { toast } from "sonner"

import { useI18n } from "@/components/i18n-provider"
import { StudioFileTypeIcon } from "@/components/studio-file-type-icon"
import { SynaraCodeBlock } from "@/components/synara-code-block"
import { Button } from "@/components/ui/button"
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
  selectSynaraMarkdownText,
  useSmoothStreamedText,
} from "@/hooks/use-smooth-streamed-text"
import {
  dedentMarkdownCode,
  parseMarkdownCodeFenceInfo,
  type MarkdownCodeFenceInfo,
} from "@/lib/markdown-code-fence"
import {
  protectLiteralMarkdownDollars,
  rehypeRestoreLiteralDollars,
  restoreLiteralDollarPlaceholders,
} from "@/lib/markdown-math"
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
  mediaSaveSessionId?: string | null
  mediaUrlMap?: Record<string, string>
  openLinksInWorkspace?: boolean
  workspaceBaseDirectory?: string | null
  streaming?: boolean
  variant?: "assistant" | "user"
  components?: Partial<Components>
}

type MarkdownRemarkPlugins = NonNullable<
  React.ComponentProps<typeof ReactMarkdown>["remarkPlugins"]
>
type MarkdownRehypePlugins = NonNullable<
  React.ComponentProps<typeof ReactMarkdown>["rehypePlugins"]
>

const ASSISTANT_MARKDOWN_REMARK_PLUGINS: MarkdownRemarkPlugins = [
  remarkGfm,
  [remarkMath, { singleDollarTextMath: true }],
]
const USER_MARKDOWN_REMARK_PLUGINS: MarkdownRemarkPlugins = [
  remarkGfm,
  remarkBreaks,
]
const ASSISTANT_MARKDOWN_REHYPE_PLUGINS: MarkdownRehypePlugins = [
  [
    rehypeKatex,
    { output: "htmlAndMathml", strict: false, throwOnError: false },
  ],
  rehypeRestoreLiteralDollars,
]
const USER_MARKDOWN_REHYPE_PLUGINS: MarkdownRehypePlugins = []

function getFilePathChipLineLabel(
  target: MarkdownFilePathTarget,
  locale: string
) {
  if (!target.line) {
    return null
  }

  const column = target.column ? `:${target.column}` : ""
  const range = target.endLine ? `-${target.endLine}` : ""

  return `(${locale === "zh" ? "第" : "line "}${target.line}${column}${range}${locale === "zh" ? " 行" : ""})`
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
  const { locale } = useI18n()
  const lineLabel = getFilePathChipLineLabel(target, locale)

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

function MarkdownMediaActions({
  media,
  saveSessionId,
}: {
  media: StudioMarkdownMediaRoute
  saveSessionId?: string | null
}) {
  const { locale } = useI18n()
  const copy =
    locale === "zh"
      ? {
          saveFailed: "保存失败。",
          saved: "已保存到文件库",
          download: "下载",
          save: "保存到文件库",
          cannotSave: "无法保存此图像",
        }
      : {
          saveFailed: "Save failed.",
          saved: "Saved to Files",
          download: "Download",
          save: "Save to Files",
          cannotSave: "Cannot save this image",
        }
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
        throw new Error(payload?.error ?? copy.saveFailed)
      }

      setSaved(true)
      toast.success(copy.saved)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.saveFailed)
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
            aria-label={copy.download}
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
        <TooltipContent side="top">{copy.download}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="size-8 bg-background/90 shadow-sm backdrop-blur hover:bg-background"
            aria-label={copy.save}
            disabled={!canSave || saving}
            onClick={handleSave}
          >
            {saved ? <RiCheckLine aria-hidden /> : <RiSaveLine aria-hidden />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {canSave ? copy.save : copy.cannotSave}
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
  const { locale } = useI18n()
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
          aria-label={
            locale === "zh" ? "复制 Markdown 表格" : "Copy Markdown table"
          }
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
  fence,
  streaming,
}: {
  code: string
  fence: MarkdownCodeFenceInfo
  streaming: boolean
}) {
  return (
    <SynaraCodeBlock
      code={code}
      language={fence.language}
      fence={fence}
      streaming={streaming}
    />
  )
}

function extractFenceInfo(className?: string): string {
  if (!className) return "plaintext"
  const match = className.match(/language-([^\s]+)/)
  return match ? match[1] : "plaintext"
}

function createMarkdownComponents(
  source: string,
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

      const code = dedentMarkdownCode(String(children).replace(/\n$/, ""))
      const fence = parseMarkdownCodeFenceInfo(extractFenceInfo(className))

      return (
        <MarkdownCodeBlock code={code} fence={fence} streaming={streaming} />
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
    mediaSaveSessionId,
    mediaUrlMap,
    openLinksInWorkspace,
    workspaceBaseDirectory,
    variant,
    streaming,
    components,
  }: {
    content: string
    mediaSaveSessionId?: string | null
    mediaUrlMap?: Record<string, string>
    openLinksInWorkspace: boolean
    workspaceBaseDirectory?: string | null
    variant: "assistant" | "user"
    streaming: boolean
    components?: Partial<Components>
  }) {
    const markdownComponents = useMemo(
      () => ({
        ...createMarkdownComponents(
          content,
          mediaSaveSessionId,
          mediaUrlMap,
          openLinksInWorkspace,
          workspaceBaseDirectory,
          streaming
        ),
        ...components,
      }),
      [
        components,
        content,
        mediaSaveSessionId,
        mediaUrlMap,
        openLinksInWorkspace,
        streaming,
        workspaceBaseDirectory,
      ]
    )

    const remarkPlugins = useMemo<MarkdownRemarkPlugins>(() => {
      const base =
        variant === "user"
          ? USER_MARKDOWN_REMARK_PLUGINS
          : ASSISTANT_MARKDOWN_REMARK_PLUGINS

      return openLinksInWorkspace ? [...base, remarkFilePathChips] : base
    }, [openLinksInWorkspace, variant])
    const rehypePlugins =
      variant === "user"
        ? USER_MARKDOWN_REHYPE_PLUGINS
        : ASSISTANT_MARKDOWN_REHYPE_PLUGINS

    // Raw HTML inside Markdown is intentionally not rendered (no rehype-raw):
    // model output is untrusted markup, and fenced HTML remains visible as code.
    return (
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={markdownComponents}
        urlTransform={(href) => {
          const restoredHref = restoreLiteralDollarPlaceholders(href)
          return openLinksInWorkspace
            ? transformWorkspaceMarkdownUrl(restoredHref)
            : defaultUrlTransform(restoredHref)
        }}
      >
        {content}
      </ReactMarkdown>
    )
  },
  function propsAreEqual(prevProps, nextProps) {
    return (
      prevProps.content === nextProps.content &&
      prevProps.mediaSaveSessionId === nextProps.mediaSaveSessionId &&
      prevProps.mediaUrlMap === nextProps.mediaUrlMap &&
      prevProps.openLinksInWorkspace === nextProps.openLinksInWorkspace &&
      prevProps.workspaceBaseDirectory === nextProps.workspaceBaseDirectory &&
      prevProps.variant === nextProps.variant &&
      prevProps.streaming === nextProps.streaming &&
      prevProps.components === nextProps.components
    )
  }
)

MarkdownBlockRenderer.displayName = "MarkdownBlockRenderer"

function MarkdownComponent({
  children,
  className,
  mediaSaveSessionId,
  mediaUrlMap,
  openLinksInWorkspace = false,
  workspaceBaseDirectory,
  streaming = false,
  variant = "assistant",
  components,
}: MarkdownProps) {
  // Synara smooths provider flushes on requestAnimationFrame, then lets React
  // defer and coalesce the expensive full-document Markdown parse.
  const smoothedChildren = useSmoothStreamedText(children, streaming)
  const normalizedChildren = useMemo(
    () =>
      variant === "user"
        ? smoothedChildren
        : protectLiteralMarkdownDollars(smoothedChildren),
    [smoothedChildren, variant]
  )
  const deferredNormalizedChildren = useDeferredValue(normalizedChildren)
  const renderedChildren = selectSynaraMarkdownText({
    normalizedText: normalizedChildren,
    deferredText: deferredNormalizedChildren,
    streaming,
  })

  // A single provider per rendered message keeps code-block and media
  // tooltips working without each block mounting its own provider. The app
  // shell has a root provider too, but this component must also render
  // standalone (SSR tests, previews outside the shell).
  return (
    <TooltipProvider>
      <div
        className={cn(
          "chat-markdown chatgpt-markdown",
          streaming && "is-streaming",
          className
        )}
        data-streaming={streaming ? "true" : "false"}
      >
        <MarkdownBlockRenderer
          content={renderedChildren}
          mediaSaveSessionId={mediaSaveSessionId}
          mediaUrlMap={mediaUrlMap}
          openLinksInWorkspace={openLinksInWorkspace}
          workspaceBaseDirectory={workspaceBaseDirectory}
          variant={variant}
          streaming={streaming}
          components={components}
        />
      </div>
    </TooltipProvider>
  )
}

const Markdown = memo(MarkdownComponent)
Markdown.displayName = "Markdown"

export { Markdown }
