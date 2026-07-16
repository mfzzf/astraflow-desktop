import Image from "next/image"
import * as React from "react"
import {
  RiCheckLine,
  RiCloseLine,
  RiDownloadLine,
  RiExternalLinkLine,
  RiImageLine,
  RiSaveLine,
  RiVideoLine,
} from "@remixicon/react"
import { toast } from "sonner"

import { Shimmer } from "@/components/ai-elements/shimmer"
import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { assistantTraceContainerClassName, isZhLocale } from "./shared"
import type { RenderableStudioMessagePart, StudioMediaGenerationPart } from "./types"

function getMediaGenerationLabel(
  part: StudioMediaGenerationPart,
  t: ReturnType<typeof useI18n>["t"]
) {
  const isZh = isZhLocale(t)
  const media =
    part.kind === "image" ? (isZh ? "图像" : "image") : isZh ? "视频" : "video"

  if (
    part.status === "running" ||
    part.status === "queued" ||
    part.status === "polling"
  ) {
    return isZh ? `正在生成${media}` : `Generating ${media}`
  }

  if (part.status === "cancelled") {
    return isZh
      ? `${media}生成已取消`
      : `${media[0].toUpperCase()}${media.slice(1)} generation cancelled`
  }

  if (part.status === "error") {
    return isZh
      ? `${media}生成失败`
      : `${media[0].toUpperCase()}${media.slice(1)} generation failed`
  }

  if (part.status === "partial") {
    return isZh
      ? `${media}部分生成完成`
      : `${media[0].toUpperCase()}${media.slice(1)} partially generated`
  }

  return isZh ? `已生成${media}` : `Generated ${media}`
}

function withDownloadParam(href: string) {
  try {
    const url = new URL(href, window.location.href)
    url.searchParams.set("download", "1")

    return href.startsWith("/")
      ? `${url.pathname}${url.search}`
      : url.toString()
  } catch {
    const separator = href.includes("?") ? "&" : "?"
    return `${href}${separator}download=1`
  }
}

function getMediaOutputExtension(
  kind: StudioMediaGenerationPart["kind"],
  mimeType: string | null
) {
  if (mimeType === "image/jpeg") return "jpg"
  if (mimeType === "image/webp") return "webp"
  if (mimeType === "image/gif") return "gif"
  if (mimeType === "video/webm") return "webm"
  if (mimeType === "video/quicktime") return "mov"

  return kind === "image" ? "png" : "mp4"
}

function getMediaOutputSaveUrl(
  kind: StudioMediaGenerationPart["kind"],
  outputId: string
) {
  const segment = kind === "image" ? "image-outputs" : "video-outputs"

  return `/api/studio/${segment}/${encodeURIComponent(outputId)}/save`
}

function MediaOutputActions({
  kind,
  output,
}: {
  kind: StudioMediaGenerationPart["kind"]
  output: StudioMediaGenerationPart["outputs"][number]
}) {
  const { t } = useI18n()
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(Boolean(output.storagePath))
  const downloadUrl = withDownloadParam(output.contentUrl)
  const filename = `${kind}-${output.index + 1}-${output.id}.${getMediaOutputExtension(
    kind,
    output.mimeType
  )}`

  async function handleSave(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()

    if (saving || saved) {
      return
    }

    setSaving(true)

    try {
      const response = await fetch(getMediaOutputSaveUrl(kind, output.id), {
        method: "POST",
      })
      const payload = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      if (!response.ok) {
        throw new Error(payload?.error ?? t.requestFailed)
      }

      setSaved(true)
      toast.success(t.studioImageSaved)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.requestFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
      <Button
        asChild
        variant="secondary"
        size="icon-sm"
        className="size-8 rounded-full bg-background/90 text-muted-foreground shadow-sm hover:bg-background hover:text-foreground"
        aria-label={t.fileLibraryDownload}
        title={t.fileLibraryDownload}
      >
        <a
          href={downloadUrl}
          download={filename}
          onClick={(event) => event.stopPropagation()}
        >
          <RiDownloadLine aria-hidden className="size-4" />
        </a>
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        className="size-8 rounded-full bg-background/90 text-muted-foreground shadow-sm hover:bg-background hover:text-foreground"
        aria-label={saved ? t.studioImageSaved : t.studioImageSave}
        title={saved ? t.studioImageSaved : t.studioImageSave}
        disabled={saving || saved}
        onClick={handleSave}
      >
        {saved ? (
          <RiCheckLine aria-hidden className="size-4" />
        ) : (
          <RiSaveLine aria-hidden className="size-4" />
        )}
      </Button>
      <Button
        asChild
        variant="secondary"
        size="icon-sm"
        className="size-8 rounded-full bg-background/90 text-muted-foreground shadow-sm hover:bg-background hover:text-foreground"
        aria-label={t.codeboxOpen}
        title={t.codeboxOpen}
      >
        <a
          href={output.contentUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
        >
          <RiExternalLinkLine aria-hidden className="size-4" />
        </a>
      </Button>
    </div>
  )
}

function getMediaUrlMapKeys(url: string) {
  const keys = [url]

  try {
    const baseUrl =
      typeof window === "undefined" ? "http://localhost" : window.location.href
    const parsed = new URL(url, baseUrl)

    keys.push(parsed.toString(), `${parsed.origin}${parsed.pathname}`)

    if (url.startsWith("/")) {
      keys.push(parsed.pathname)
    }
  } catch {
    // Use the raw URL only.
  }

  return keys
}

export function createMediaUrlMap(parts: RenderableStudioMessagePart[]) {
  const urlMap: Record<string, string> = {}

  for (const part of parts) {
    if (part.type !== "media_generation") {
      continue
    }

    for (const output of part.outputs) {
      for (const key of getMediaUrlMapKeys(output.contentUrl)) {
        urlMap[key] = output.contentUrl
      }

      if (!output.url) {
        continue
      }

      for (const key of getMediaUrlMapKeys(output.url)) {
        urlMap[key] = output.contentUrl
      }
    }
  }

  return urlMap
}

export function AssistantMediaGeneration({
  part,
}: {
  part: StudioMediaGenerationPart
}) {
  const { t } = useI18n()
  const label = getMediaGenerationLabel(part, t)
  const running =
    part.status === "queued" ||
    part.status === "running" ||
    part.status === "polling"
  const failed = part.status === "error"
  const Icon = part.kind === "image" ? RiImageLine : RiVideoLine
  const taskRef = part.providerTaskId || part.providerRequestId
  const progress =
    typeof part.progress === "number"
      ? Math.min(Math.max(part.progress, 0), 1)
      : null
  const progressLabel =
    progress === null ? null : `${Math.round(progress * 100)}%`
  const headerLabel =
    part.status === "complete" || part.status === "partial"
      ? part.modelName || label
      : label

  return (
    <div
      className={cn(
        assistantTraceContainerClassName,
        "overflow-hidden rounded-xl border border-border/70 bg-muted/30 text-sm text-foreground",
        failed && "border-destructive/30 bg-destructive/5"
      )}
    >
      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center text-muted-foreground",
            failed && "text-destructive"
          )}
        >
          {failed ? (
            <RiCloseLine aria-hidden className="size-4" />
          ) : part.status === "complete" ? (
            <RiCheckLine aria-hidden className="size-4" />
          ) : (
            <Icon aria-hidden className="size-4" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {running ? (
            <Shimmer as="span">{headerLabel}</Shimmer>
          ) : (
            headerLabel
          )}
        </span>
      </div>

      <div className="border-t border-border/60 px-3 py-2">
        <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">
          {part.prompt}
        </div>

        {taskRef ? (
          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground/80">
            {taskRef}
          </div>
        ) : null}

        {running && (progressLabel || part.phase || part.rawStatus) ? (
          <div className="mt-2 space-y-1.5">
            <div className="flex min-w-0 items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="min-w-0 truncate">
                {part.phase ?? part.rawStatus ?? label}
              </span>
              {progressLabel ? (
                <span className="shrink-0 tabular-nums">{progressLabel}</span>
              ) : null}
            </div>
            {progress !== null ? (
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${Math.max(progress * 100, 4)}%` }}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {part.outputs.length > 0 ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {part.outputs.map((output) => (
              <div
                key={output.id}
                className="group relative block overflow-hidden rounded-lg border bg-background"
              >
                <a
                  href={output.contentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block"
                >
                  {part.kind === "image" ? (
                    <Image
                      src={output.contentUrl}
                      alt={part.prompt}
                      className="aspect-video w-full object-cover"
                      width={640}
                      height={360}
                      sizes="(min-width: 640px) 50vw, 100vw"
                      unoptimized
                    />
                  ) : (
                    <video
                      src={output.contentUrl}
                      className="aspect-video w-full bg-black object-contain"
                      controls
                      preload="metadata"
                    />
                  )}
                </a>
                <MediaOutputActions kind={part.kind} output={output} />
              </div>
            ))}
          </div>
        ) : null}

        {failed && part.errorMessage ? (
          <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {part.errorMessage}
          </div>
        ) : null}
      </div>
    </div>
  )
}
