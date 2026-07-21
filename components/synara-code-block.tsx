"use client"

import { IconCheck, IconCopy, IconTextWrap } from "@tabler/icons-react"
import * as React from "react"
import { toast } from "sonner"

import { useI18n } from "@/components/i18n-provider"
import { StudioFileTypeIcon } from "@/components/studio-file-type-icon"
import { useOptionalTheme } from "@/components/theme-provider"
import { IconButton } from "@/components/ui/icon-button"
import type { MarkdownCodeFenceInfo } from "@/lib/markdown-code-fence"
import {
  getSynaraSyntaxHighlighter,
  highlightCodeWithSynaraHighlighter,
} from "@/lib/synara-syntax-highlighting"
import { writeTextToClipboard } from "@/lib/browser-clipboard"
import { cn } from "@/lib/utils"

type SynaraCodeBlockProps = {
  code: string
  language?: string
  className?: string
  bodyClassName?: string
  fence?: MarkdownCodeFenceInfo
  streaming?: boolean
}

function normalizeLanguage(language: string | undefined) {
  const normalized = language?.trim().toLowerCase() ?? ""

  if (!normalized || normalized === "plaintext" || normalized === "plain") {
    return "text"
  }

  return normalized
}

function SynaraHighlightedCode({
  code,
  language,
  streaming,
}: {
  code: string
  language: string
  streaming: boolean
}) {
  const resolvedTheme = useOptionalTheme()?.resolvedTheme ?? "light"
  const theme = resolvedTheme === "dark" ? "github-dark" : "github-light"
  const renderKey = `${theme}:${language}:${code}`
  const [highlighted, setHighlighted] = React.useState<{
    key: string
    html: string | null
  } | null>(null)

  React.useEffect(() => {
    // Re-highlighting on every streamed token swaps the plain and Shiki trees
    // continuously. Render stable plain code until the block is complete.
    if (streaming) {
      return
    }

    let active = true

    void getSynaraSyntaxHighlighter(language)
      .then((highlighter) =>
        highlightCodeWithSynaraHighlighter(highlighter, code, language, theme)
      )
      .then((nextHtml) => {
        if (active) setHighlighted({ key: renderKey, html: nextHtml })
      })
      .catch(() => {
        if (active) setHighlighted({ key: renderKey, html: null })
      })

    return () => {
      active = false
    }
  }, [code, language, renderKey, streaming, theme])

  const html = highlighted?.key === renderKey ? highlighted.html : null

  if (!html) {
    return (
      <pre>
        <code>{code}</code>
      </pre>
    )
  }

  return (
    <div
      className="synara-codeblock__highlight"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function SynaraCodeBlock({
  code,
  language: rawLanguage = "text",
  className,
  bodyClassName,
  fence,
  streaming = false,
}: SynaraCodeBlockProps) {
  const { locale } = useI18n()
  const language = normalizeLanguage(rawLanguage)
  const [copied, setCopied] = React.useState(false)
  const [wrap, setWrap] = React.useState(false)
  const labels =
    locale === "zh"
      ? {
          enableWrap: "启用自动换行",
          disableWrap: "关闭自动换行",
          copied: "已复制",
          copy: "复制代码",
          copyFailed: "复制失败，请手动选择代码。",
        }
      : {
          enableWrap: "Enable soft wrap",
          disableWrap: "Disable soft wrap",
          copied: "Copied",
          copy: "Copy code",
          copyFailed: "Copy failed. Select the code manually.",
        }
  const copiedTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  )

  const copyCode = React.useCallback(() => {
    void writeTextToClipboard(code).then((didCopy) => {
      if (didCopy) {
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
        setCopied(true)
        toast.success(labels.copied)
        copiedTimerRef.current = setTimeout(() => {
          setCopied(false)
          copiedTimerRef.current = null
        }, 1_200)
        return
      }

      toast.error(labels.copyFailed)
    })
  }, [code, labels.copied, labels.copyFailed])

  React.useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    },
    []
  )

  return (
    <div
      className={cn("synara-codeblock", className)}
      data-wrap={wrap ? "true" : "false"}
      data-streaming={streaming ? "true" : "false"}
    >
      <div className="synara-codeblock__header">
        {fence?.isFileReference && fence.filePath && fence.fileName ? (
          <span className="synara-codeblock__file" title={fence.filePath}>
            <StudioFileTypeIcon
              path={fence.filePath}
              size="small"
              className="synara-codeblock__file-icon"
            />
            <span className="synara-codeblock__file-name">
              {fence.fileName}
            </span>
            {fence.directory ? (
              <span className="synara-codeblock__file-directory">
                {fence.directory}
              </span>
            ) : null}
            {fence.lineRange ? (
              <span className="synara-codeblock__file-lines">
                {fence.lineRange}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="synara-codeblock__language">
            <span>{language}</span>
          </span>
        )}
        <div className="synara-codeblock__actions">
          <IconButton
            className="synara-codeblock__action"
            label={wrap ? labels.disableWrap : labels.enableWrap}
            tooltip={wrap ? labels.disableWrap : labels.enableWrap}
            aria-pressed={wrap}
            data-active={wrap ? "true" : "false"}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setWrap((current) => !current)
            }}
          >
            <IconTextWrap className="size-3.5" />
          </IconButton>
          <IconButton
            className="synara-codeblock__action"
            label={copied ? labels.copied : labels.copy}
            tooltip={copied ? labels.copied : labels.copy}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              copyCode()
            }}
          >
            {copied ? (
              <IconCheck className="size-3.5" />
            ) : (
              <IconCopy className="size-3.5" />
            )}
          </IconButton>
        </div>
      </div>
      <div className={cn("synara-codeblock__body", bodyClassName)}>
        <SynaraHighlightedCode
          code={code}
          language={language}
          streaming={streaming}
        />
      </div>
    </div>
  )
}

export { SynaraCodeBlock }
export type { SynaraCodeBlockProps }
