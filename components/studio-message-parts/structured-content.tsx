import { RiDownloadLine, RiFileLine, RiLinkM } from "@remixicon/react"

import {
  CodeBlock,
  CodeBlockCode,
  CodeBlockGroup,
} from "@/components/prompt-kit/code-block"
import { useI18n } from "@/components/i18n-provider"
import { MessageContent } from "@/components/ui/message"
import type { AgentContentBlock } from "@/lib/agent/structured-content"
import { cn } from "@/lib/utils"

import { markdownClassName, streamingPulseDotClassName } from "./shared"

function safeMediaMimeType(
  mimeType: string | null | undefined,
  kind: "audio" | "image"
) {
  const normalized = mimeType?.trim().toLowerCase()

  return normalized?.startsWith(`${kind}/`)
    ? normalized
    : kind === "image"
      ? "image/png"
      : "audio/mpeg"
}

function toBase64DataUrl(data: string, mimeType: string) {
  return `data:${mimeType};base64,${data}`
}

function safeResourceMimeType(mimeType: string | null | undefined) {
  const normalized = mimeType?.trim().toLowerCase()

  return normalized && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(normalized)
    ? normalized
    : "application/octet-stream"
}

function escapeMarkdownLabel(value: string) {
  return value.replace(/([\\[\]])/g, "\\$1")
}

function ResourceHeader({
  mimeType,
  title,
  uri,
}: {
  mimeType?: string | null
  title: string
  uri: string
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 rounded-xl border bg-card px-3 py-2.5 shadow-sm">
      <RiFileLine className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{title}</span>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {uri}
        </span>
        {mimeType ? (
          <span className="text-[11px] text-muted-foreground/80">
            {mimeType}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export function StructuredContentBlock({
  content,
  mediaSaveSessionId,
  openLinksInWorkspace = true,
  streaming = false,
}: {
  content: AgentContentBlock
  mediaSaveSessionId?: string | null
  openLinksInWorkspace?: boolean
  streaming?: boolean
}) {
  const { t } = useI18n()

  if (content.type === "text") {
    if (!content.text.trim()) {
      return null
    }

    return (
      <MessageContent
        markdown
        mediaSaveSessionId={mediaSaveSessionId}
        openLinksInWorkspace={openLinksInWorkspace}
        streaming={streaming}
        className={cn(
          "bg-transparent p-0",
          markdownClassName,
          streaming && streamingPulseDotClassName
        )}
      >
        {content.text}
      </MessageContent>
    )
  }

  if (content.type === "image") {
    const mimeType = safeMediaMimeType(content.mimeType, "image")

    return (
      <figure className="not-prose my-2 w-fit max-w-full overflow-hidden rounded-xl border bg-card shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={toBase64DataUrl(content.data, mimeType)}
          alt=""
          className="max-h-[min(68vh,720px)] max-w-full object-contain"
        />
        {content.uri ? (
          <figcaption className="truncate border-t px-3 py-1.5 font-mono text-xs text-muted-foreground">
            {content.uri}
          </figcaption>
        ) : null}
      </figure>
    )
  }

  if (content.type === "audio") {
    const mimeType = safeMediaMimeType(content.mimeType, "audio")

    return (
      <div className="not-prose my-2 max-w-lg rounded-xl border bg-card p-3 shadow-sm">
        <audio
          controls
          preload="metadata"
          src={toBase64DataUrl(content.data, mimeType)}
          className="h-10 w-full"
        />
      </div>
    )
  }

  if (content.type === "resource_link") {
    const label = content.title || content.name || content.uri

    return (
      <div className="not-prose my-2 flex min-w-0 items-start gap-2.5 rounded-xl border bg-card px-3 py-2.5 shadow-sm">
        <RiLinkM className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <MessageContent
            markdown
            openLinksInWorkspace={openLinksInWorkspace}
            className="bg-transparent p-0 text-sm font-medium"
          >
            {`[${escapeMarkdownLabel(label)}](${content.uri})`}
          </MessageContent>
          {content.description ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {content.description}
            </p>
          ) : null}
          {content.mimeType || content.size != null ? (
            <p className="mt-1 text-[11px] text-muted-foreground/80">
              {[
                content.mimeType,
                content.size != null ? `${content.size} B` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
        </div>
      </div>
    )
  }

  const { resource } = content

  if ("text" in resource) {
    return (
      <div className="not-prose my-2 flex flex-col gap-2">
        <ResourceHeader
          title={resource.uri.split(/[\\/]/).at(-1) || resource.uri}
          uri={resource.uri}
          mimeType={resource.mimeType}
        />
        <CodeBlock className="rounded-xl shadow-sm">
          <CodeBlockGroup className="border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {resource.mimeType || "text"}
          </CodeBlockGroup>
          <CodeBlockCode code={resource.text} language="text" />
        </CodeBlock>
      </div>
    )
  }

  const mimeType = resource.mimeType?.trim().toLowerCase() || null

  if (mimeType?.startsWith("image/")) {
    return (
      <StructuredContentBlock
        content={{
          type: "image",
          data: resource.blob,
          mimeType,
          uri: resource.uri,
        }}
        mediaSaveSessionId={mediaSaveSessionId}
        openLinksInWorkspace={openLinksInWorkspace}
      />
    )
  }

  if (mimeType?.startsWith("audio/")) {
    return (
      <StructuredContentBlock
        content={{ type: "audio", data: resource.blob, mimeType }}
        mediaSaveSessionId={mediaSaveSessionId}
        openLinksInWorkspace={openLinksInWorkspace}
      />
    )
  }

  return (
    <div className="not-prose my-2 flex max-w-lg flex-col gap-2">
      <ResourceHeader
        title={resource.uri.split(/[\\/]/).at(-1) || resource.uri}
        uri={resource.uri}
        mimeType={resource.mimeType}
      />
      <a
        href={toBase64DataUrl(
          resource.blob,
          safeResourceMimeType(resource.mimeType)
        )}
        download={resource.uri.split(/[\\/]/).at(-1) || "resource"}
        className="inline-flex w-fit items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
      >
        <RiDownloadLine className="size-4" aria-hidden />
        <span>{t.fileLibraryDownload}</span>
      </a>
    </div>
  )
}
