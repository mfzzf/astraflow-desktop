"use client"

import * as React from "react"
import {
  RiDownloadLine,
  RiLoader4Line,
  RiSaveLine,
} from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type MediaOutputActionsTone = "inline" | "overlay"

type MediaOutputActionsProps = {
  tone?: MediaOutputActionsTone
  className?: string
  downloadLabel?: string
  saveLabel?: string
  saving?: boolean
  saveDisabled?: boolean
  stopPropagation?: boolean
  onDownload?: () => void
  onSave?: () => void
}

function MediaOutputActions({
  tone = "inline",
  className,
  downloadLabel,
  saveLabel,
  saving = false,
  saveDisabled = false,
  stopPropagation = false,
  onDownload,
  onSave,
}: MediaOutputActionsProps) {
  const isOverlay = tone === "overlay"
  const buttonClassName = isOverlay
    ? "h-7 rounded-full px-2 text-xs text-white hover:bg-white/15"
    : "rounded-2xl"

  function handleAction(
    event: React.MouseEvent<HTMLButtonElement>,
    action: (() => void) | undefined
  ) {
    if (stopPropagation) {
      event.stopPropagation()
    }
    action?.()
  }

  return (
    <div
      className={cn(
        isOverlay
          ? "flex items-center gap-1.5 rounded-full bg-black/60 px-1 py-0.5 opacity-0 transition group-hover:opacity-100"
          : "flex flex-wrap justify-end gap-2",
        className
      )}
    >
      {onDownload ? (
        <Button
          type="button"
          variant={isOverlay ? "ghost" : "outline"}
          size="sm"
          className={buttonClassName}
          onClick={(event) => handleAction(event, onDownload)}
        >
          <RiDownloadLine aria-hidden />
          {downloadLabel ? <span>{downloadLabel}</span> : null}
        </Button>
      ) : null}
      {onSave ? (
        <Button
          type="button"
          variant={isOverlay ? "ghost" : "outline"}
          size="sm"
          className={buttonClassName}
          onClick={(event) => handleAction(event, onSave)}
          disabled={saveDisabled || saving}
        >
          {saving ? (
            <RiLoader4Line className="animate-spin" aria-hidden />
          ) : (
            <RiSaveLine aria-hidden />
          )}
          {saveLabel ? <span>{saveLabel}</span> : null}
        </Button>
      ) : null}
    </div>
  )
}

type MediaStatusBadgeProps = {
  status: string
  label: string
  className?: string
}

function MediaStatusBadge({
  status,
  label,
  className,
}: MediaStatusBadgeProps) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border bg-background/80 px-2 py-0.5 text-[10px]",
        (status === "error" || status === "cancelled") &&
          "border-destructive/40 text-destructive",
        (status === "complete" || status === "partial") &&
          "border-primary/35 text-primary",
        className
      )}
    >
      {label}
    </span>
  )
}

export { MediaOutputActions, MediaStatusBadge }
