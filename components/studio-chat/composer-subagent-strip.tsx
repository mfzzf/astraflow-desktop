"use client"

import * as React from "react"
import { IconLoader2 } from "@tabler/icons-react"

import { CentralIcon } from "@/components/central-icon"
import { useI18n } from "@/components/i18n-provider"
import { DisclosureRegion } from "@/components/ui/disclosure-region"
import { SynaraButton } from "@/components/ui/synara-button"
import { cn } from "@/lib/utils"

import {
  COMPOSER_STACKED_PANEL_BODY_PADDING_CLASS_NAME,
  COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME,
  COMPOSER_STACKED_PANEL_ICON_CLASS_NAME,
  ComposerStackedPanel,
  ComposerStackedPanelHeaderRow,
  ComposerStackedPanelRowLabel,
  ComposerStackedPanelRowMain,
} from "./composer-stacked-panel"
import type { StudioStatusSubagentSummary } from "./status-panel"

type ComposerSubagentStripProps = {
  items: readonly StudioStatusSubagentSummary[]
  compact: boolean
  onCompactChange: (compact: boolean) => void
  onOpenSubagent: (item: StudioStatusSubagentSummary) => void
  onStopAll?: () => void
}

export function getVisibleComposerSubagents(
  items: readonly StudioStatusSubagentSummary[]
) {
  const activeMessageIds = new Set(
    items
      .filter((item) => item.status === "running")
      .map((item) => item.messageId)
  )

  if (activeMessageIds.size === 0) {
    return []
  }

  return items.filter(
    (item) =>
      item.status === "running" || activeMessageIds.has(item.messageId)
  )
}

function statusDotClassName(status: StudioStatusSubagentSummary["status"]) {
  switch (status) {
    case "running":
      return "bg-blue-500 shadow-[0_0_0_2px_color-mix(in_oklab,var(--color-accent-blue)_16%,transparent)]"
    case "complete":
      return "bg-emerald-500"
    case "error":
      return "bg-destructive"
    case "cancelled":
      return "bg-muted-foreground/45"
  }
}

function statusLabel(
  status: StudioStatusSubagentSummary["status"],
  zh: boolean
) {
  switch (status) {
    case "running":
      return zh ? "运行中" : "Running"
    case "complete":
      return zh ? "已完成" : "Complete"
    case "error":
      return zh ? "失败" : "Failed"
    case "cancelled":
      return zh ? "已取消" : "Cancelled"
  }
}

// Port of Synara's ComposerSubagentStrip using the same Base UI Button and
// Tabler icon stack. AstraFlow opens the existing subagent detail surface rather
// than pretending every ACP provider exposes a separately addressable thread.
const ComposerSubagentStrip = React.memo(function ComposerSubagentStrip({
  items,
  compact,
  onCompactChange,
  onOpenSubagent,
  onStopAll,
}: ComposerSubagentStripProps) {
  const { locale } = useI18n()
  const zh = locale.toLowerCase().startsWith("zh")
  const runningCount = items.filter((item) => item.status === "running").length

  if (items.length === 0) return null

  return (
    <ComposerStackedPanel
      passthroughSideMargins
      data-testid="composer-subagent-strip"
    >
      <ComposerStackedPanelHeaderRow>
        <ComposerStackedPanelRowMain>
          {compact && runningCount > 0 ? (
            <IconLoader2
              aria-hidden
              className={cn(
                COMPOSER_STACKED_PANEL_ICON_CLASS_NAME,
                "animate-spin"
              )}
            />
          ) : (
            <CentralIcon
              name="robot"
              className={COMPOSER_STACKED_PANEL_ICON_CLASS_NAME}
            />
          )}
          <ComposerStackedPanelRowLabel>
            {runningCount > 0
              ? zh
                ? `${items.length} 个子 Agent，${runningCount} 个运行中`
                : `${runningCount} of ${items.length} subagents running`
              : zh
                ? `${items.length} 个子 Agent`
                : `${items.length} subagents`}
          </ComposerStackedPanelRowLabel>
        </ComposerStackedPanelRowMain>

        {onStopAll && runningCount > 1 ? (
          <SynaraButton
            type="button"
            size="icon-xs"
            variant="ghost"
            className={cn(
              "shrink-0",
              COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME
            )}
            onClick={onStopAll}
            aria-label={zh ? "停止所有子 Agent" : "Stop all subagents"}
            title={zh ? "停止所有子 Agent" : "Stop all running subagents"}
          >
            <CentralIcon name="stop" variant="fill" className="size-3" />
          </SynaraButton>
        ) : null}

        <SynaraButton
          type="button"
          size="icon-xs"
          variant="ghost"
          className={cn(
            "shrink-0",
            COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME
          )}
          onClick={() => onCompactChange(!compact)}
          aria-label={
            compact
              ? zh
                ? "展开子 Agent"
                : "Expand subagent strip"
              : zh
                ? "收起子 Agent"
                : "Collapse subagent strip"
          }
          title={
            compact
              ? zh
                ? "展开子 Agent"
                : "Expand subagent strip"
              : zh
                ? "收起子 Agent"
                : "Collapse subagent strip"
          }
        >
          {compact ? (
            <CentralIcon name="expand-45" className="size-3" />
          ) : (
            <CentralIcon name="minimize-45" className="size-3" />
          )}
        </SynaraButton>
      </ComposerStackedPanelHeaderRow>

      <DisclosureRegion open={!compact}>
        <div
          className={cn(
            "space-y-0",
            COMPOSER_STACKED_PANEL_BODY_PADDING_CLASS_NAME
          )}
        >
          {items.map((item) => {
            const part = item.part
            const role = part.role?.trim()
            const model = part.model?.trim()

            return (
              <button
                  key={item.taskId}
                  type="button"
                  data-testid="composer-subagent-row"
                  className="group flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-[var(--color-background-button-secondary-hover)]"
                  title={[item.name, role, model].filter(Boolean).join(" · ")}
                  onClick={() => onOpenSubagent(item)}
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      statusDotClassName(item.status)
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/85">
                    <span>{item.name}</span>
                    {role ? (
                      <span className="ml-1 text-[11px] font-normal text-muted-foreground/60">
                        ({role})
                      </span>
                    ) : null}
                    {model ? (
                      <span className="ml-1.5 text-[11px] font-normal text-muted-foreground/50">
                        {model}
                      </span>
                    ) : null}
                    {part.background ? (
                      <span className="ml-1.5 text-[11px] font-normal text-muted-foreground/50">
                        {zh ? "后台" : "background"}
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-[11px]",
                      item.status === "error"
                        ? "text-destructive"
                        : "text-muted-foreground/70"
                    )}
                  >
                    {statusLabel(item.status, zh)}
                  </span>
              </button>
            )
          })}
        </div>
      </DisclosureRegion>
    </ComposerStackedPanel>
  )
})

export { ComposerSubagentStrip }
