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

export function formatUsageCost(cost: NonNullable<StudioTokenUsage["cost"]>) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: cost.currency,
      currencyDisplay: "code",
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(cost.amount)
  } catch {
    return `${cost.currency} ${cost.amount}`
  }
}

export function resolveContextUsage(
  contextWindow: number,
  usage: StudioTokenUsage | null
) {
  if (!usage) {
    return null
  }

  const used = usage.contextTokensUsed
  const reportedTotal =
    usage.contextWindowSize ?? usage.modelContextWindow ?? 0
  // ACP adapters can only provide a best-effort window before the first model
  // result. Claude Code, for example, falls back to 200k when its SDK context
  // control request is unavailable. A known selected model is authoritative;
  // runtime metadata remains the fallback for custom/unknown models.
  const total = contextWindow > 0 ? contextWindow : reportedTotal

  if (used == null || used <= 0 || total <= 0) {
    return null
  }

  return {
    used,
    total,
    percent: Math.min(100, Math.round((used / total) * 100)),
  }
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
  const contextUsage = resolveContextUsage(contextWindow, usage)

  if (dense || !contextUsage) {
    return null
  }

  const { percent, total, used } = contextUsage
  const contextLabel = t.studioContextUsageTooltip(used, total, percent)
  const costLabel = usage?.cost ? formatUsageCost(usage.cost) : null
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
          aria-label={[contextLabel, costLabel].filter(Boolean).join(" · ")}
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
                formatCompactTokenCount(used),
                formatCompactTokenCount(total)
              )}
            </span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="end">
        <div className="flex flex-col gap-0.5">
          <span>{contextLabel}</span>
          {costLabel ? <span className="font-mono">{costLabel}</span> : null}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
