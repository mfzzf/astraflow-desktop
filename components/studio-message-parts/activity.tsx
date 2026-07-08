import * as React from "react"
import { RiArrowDownSLine } from "@remixicon/react"

import { useI18n } from "@/components/i18n-provider"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

import { isZhLocale, SuppressWrittenFileOpenCardsContext } from "./shared"

function getTurnActivitySummaryLabel({
  isZh,
  stepCount,
  durationMs,
}: {
  isZh: boolean
  stepCount: number
  durationMs: number
}) {
  if (durationMs > 0) {
    const seconds = Math.max(1, Math.round(durationMs / 1000))

    return isZh ? `工作了 ${seconds} 秒` : `Worked for ${seconds}s`
  }

  return isZh
    ? `完成了 ${stepCount} 个步骤`
    : `Worked through ${stepCount} step${stepCount === 1 ? "" : "s"}`
}

export function TurnActivitySummary({
  stepCount,
  durationMs,
  defaultOpen = false,
  children,
}: {
  stepCount: number
  durationMs: number
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const { t } = useI18n()
  const isZh = isZhLocale(t)
  const [open, setOpen] = React.useState(defaultOpen)

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="not-prose my-1 flex flex-col"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <span>
            {getTurnActivitySummaryLabel({ isZh, stepCount, durationMs })}
          </span>
          <RiArrowDownSLine
            aria-hidden
            className={cn("size-4 transition-transform", !open && "-rotate-90")}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 flex flex-col gap-1.5">
          <SuppressWrittenFileOpenCardsContext.Provider value={true}>
            {children}
          </SuppressWrittenFileOpenCardsContext.Provider>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
