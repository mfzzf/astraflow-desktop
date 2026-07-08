"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import {
  RiCloseLine,
  RiFileTextLine,
  RiInformationLine,
  RiLoader4Line,
} from "@remixicon/react"

import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { StudioAttachment } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

import { formatAttachmentSize } from "./attachment-utils"
import type { SkillsMarketPageProps } from "./types"

export function OptionInfoTooltip({ description }: { description: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={description}
          className="mr-4 ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/65 transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          tabIndex={0}
        >
          <RiInformationLine aria-hidden className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        sideOffset={8}
        className="max-w-56 text-left leading-5 whitespace-normal"
      >
        {description}
      </TooltipContent>
    </Tooltip>
  )
}

export function SelectOptionRow({
  description,
  icon,
  label,
  meta,
}: {
  description: string
  icon?: React.ReactNode
  label: string
  meta?: string
}) {
  return (
    <span className="flex w-full min-w-0 items-center gap-2">
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta ? (
        <span className="max-w-40 truncate text-xs font-normal text-muted-foreground">
          {meta}
        </span>
      ) : null}
      <OptionInfoTooltip description={description} />
    </span>
  )
}

export function FileAttachmentChip({
  attachment,
  compact = false,
}: {
  attachment: StudioAttachment
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        "flex h-full min-w-0 items-center gap-2 bg-background/70 px-3 py-2",
        compact ? "text-xs" : "rounded-2xl border text-sm shadow-sm"
      )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <RiFileTextLine aria-hidden className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{attachment.name}</div>
        <div className="truncate text-muted-foreground">
          {[attachment.mimeType, formatAttachmentSize(attachment.size)]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
    </div>
  )
}

export function SkillsMarketPageLoading() {
  return (
    <div className="flex h-full min-h-0 items-end justify-center p-6">
      <div className="flex items-center gap-2 rounded-full border bg-background px-3 py-2 text-sm text-muted-foreground shadow-lg">
        <RiLoader4Line className="animate-spin" aria-hidden />
        <span>Loading</span>
      </div>
    </div>
  )
}

export const LazySkillsMarketPage = dynamic<SkillsMarketPageProps>(
  () =>
    import("@/components/skills-market-page").then(
      (mod) => mod.SkillsMarketPage
    ),
  { loading: SkillsMarketPageLoading }
)

export function ChatComposerPluginsDialog() {
  const { t } = useI18n()
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    function handleOpenComposerPlugins() {
      setOpen(true)
    }

    window.addEventListener(
      "astraflow:open-composer-plugins",
      handleOpenComposerPlugins
    )

    return () => {
      window.removeEventListener(
        "astraflow:open-composer-plugins",
        handleOpenComposerPlugins
      )
    }
  }, [])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="flex h-[min(76vh,720px)] w-[min(86vw,1180px)] max-w-none flex-col gap-0 overflow-hidden rounded-2xl border bg-background p-0 shadow-2xl sm:max-w-none"
        overlayClassName="bg-slate-950/16 backdrop-blur-[1px]"
        showCloseButton={false}
      >
        <DialogHeader className="shrink-0 flex-row items-center justify-between gap-4 border-b bg-background px-4 py-3">
          <div className="min-w-0">
            <DialogTitle className="truncate text-lg">{t.skills}</DialogTitle>
            <DialogDescription className="sr-only">
              {t.studioComposerPluginsDescription}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              className="shrink-0 rounded-full"
            >
              <RiCloseLine aria-hidden />
            </Button>
          </DialogClose>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden">
          {open ? <LazySkillsMarketPage embedded initialView="mine" /> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
