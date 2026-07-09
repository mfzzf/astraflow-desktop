"use client"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useI18n } from "@/components/i18n-provider"
import type { StudioTokenUsage } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

export function formatCompactTokenCount(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`
  }

  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`
  }

  return String(value)
}

export function ContextUsageIndicator({
  contextWindow,
  usage,
  compact = false,
  dense = false,
}: {
  contextWindow: number
  usage: StudioTokenUsage | null
  compact?: boolean
  dense?: boolean
}) {
  const { t } = useI18n()

  if (!usage || dense || contextWindow <= 0 || usage.inputTokens <= 0) {
    return null
  }

  const percent = Math.min(
    100,
    Math.round((usage.inputTokens / contextWindow) * 100)
  )
  const ringStyle = {
    background: `conic-gradient(var(--primary) ${percent}%, var(--muted) 0)`,
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-background px-2 text-xs text-muted-foreground",
            compact && "w-7 justify-center px-0"
          )}
          aria-label={t.studioContextUsageTooltip(
            usage.inputTokens,
            contextWindow,
            percent
          )}
        >
          <span
            aria-hidden
            className="grid size-3.5 place-items-center rounded-full"
            style={ringStyle}
          >
            <span className="size-2 rounded-full bg-background" />
          </span>
          {compact ? null : (
            <span className="tabular-nums">
              {t.studioContextUsageLabel(
                formatCompactTokenCount(usage.inputTokens),
                formatCompactTokenCount(contextWindow)
              )}
            </span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="end">
        {t.studioContextUsageTooltip(usage.inputTokens, contextWindow, percent)}
      </TooltipContent>
    </Tooltip>
  )
}
