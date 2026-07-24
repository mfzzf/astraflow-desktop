import * as React from "react"

import { DisclosureChevron } from "@/components/ui/disclosure-chevron"
import {
  SynaraCollapsible,
  SynaraCollapsiblePanel,
  SynaraCollapsibleTrigger,
} from "@/components/ui/synara-collapsible"

import { SuppressWrittenFileOpenCardsContext } from "./shared"

export function formatSynaraTurnDuration(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0ms"
  if (durationMs < 1_000) return `${Math.max(1, Math.round(durationMs))}ms`
  if (durationMs < 10_000) return `${(durationMs / 1_000).toFixed(1)}s`
  if (durationMs < 60_000) return `${Math.round(durationMs / 1_000)}s`

  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.round((durationMs % 60_000) / 1_000)

  if (seconds === 0) return `${minutes}m`
  if (seconds === 60) return `${minutes + 1}m`

  return `${minutes}m ${seconds}s`
}

export function formatSynaraWorkingDuration(durationMs: number) {
  const elapsedSeconds = Math.max(0, Math.floor(durationMs / 1_000))

  if (elapsedSeconds < 60) return `${elapsedSeconds}s`

  const hours = Math.floor(elapsedSeconds / 3_600)
  const minutes = Math.floor((elapsedSeconds % 3_600) / 60)
  const seconds = elapsedSeconds % 60

  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`

  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

function elapsedMs(startedAt: string, completedAt: string | null | undefined) {
  if (!completedAt) return null

  const start = Date.parse(startedAt)
  const end = Date.parse(completedAt)

  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? end - start
    : null
}

function WorkingTimer({ startedAt }: { startedAt: string }) {
  const [label, setLabel] = React.useState(() => {
    const start = Date.parse(startedAt)

    return formatSynaraWorkingDuration(
      Number.isFinite(start) ? Date.now() - start : 0
    )
  })

  React.useEffect(() => {
    const update = () => {
      const start = Date.parse(startedAt)

      setLabel(
        formatSynaraWorkingDuration(
          Number.isFinite(start) ? Date.now() - start : 0
        )
      )
    }

    update()
    const interval = window.setInterval(update, 1_000)

    return () => window.clearInterval(interval)
  }, [startedAt])

  return <span>{label}</span>
}

export function TurnWorkingHeader({ startedAt }: { startedAt: string }) {
  return (
    <div className="not-prose mb-3">
      <div className="flex items-center gap-2 pb-2 pl-px text-sm text-muted-foreground/70">
        <span aria-hidden className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/55 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-primary/70" />
        </span>
        <span>
          Working for <WorkingTimer startedAt={startedAt} />
        </span>
      </div>
      <div className="h-px w-full bg-border" />
    </div>
  )
}

export function TurnActivitySummary({
  startedAt,
  completedAt,
  durationMs,
  children,
}: {
  startedAt: string
  completedAt?: string | null
  durationMs: number
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const turnDurationMs = elapsedMs(startedAt, completedAt) ?? durationMs

  return (
    <div className="not-prose mb-3">
      <SynaraCollapsible
        open={open}
        onOpenChange={setOpen}
        className="group/collapsed-work"
      >
        <SynaraCollapsibleTrigger className="inline-flex items-center gap-1 pb-2 pl-px text-left text-sm text-muted-foreground/70 transition-colors duration-200 hover:text-muted-foreground/90">
          <span>Worked for {formatSynaraTurnDuration(turnDurationMs)}</span>
          <DisclosureChevron open={open} className="text-muted-foreground/55" />
        </SynaraCollapsibleTrigger>
        <SynaraCollapsiblePanel>
          <div className="mb-2.5 flex flex-col gap-1.5">
            <SuppressWrittenFileOpenCardsContext.Provider value={true}>
              {children}
            </SuppressWrittenFileOpenCardsContext.Provider>
          </div>
        </SynaraCollapsiblePanel>
      </SynaraCollapsible>
      <div className="h-px w-full bg-border" />
    </div>
  )
}
