"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

const COMPOSER_STACKED_PANEL_CHROME_CLASS_NAME =
  "chat-composer-stacked-top relative overflow-hidden border border-b-0 border-[color:var(--color-border)] dark:border-[color:color-mix(in_srgb,var(--color-border)_50%,transparent)]"
const COMPOSER_STACKED_PANEL_HEADER_ROW_CLASS_NAME =
  "flex items-center justify-between gap-2 px-2.5 py-1.5"
const COMPOSER_STACKED_PANEL_ROW_MAIN_CLASS_NAME =
  "flex min-w-0 flex-1 items-center gap-1.5"
const COMPOSER_STACKED_PANEL_ICON_CLASS_NAME =
  "size-3.5 shrink-0 text-[var(--color-text-foreground-secondary)]"
const COMPOSER_STACKED_PANEL_META_CLASS_NAME =
  "truncate text-[12px] text-muted-foreground/80"
const COMPOSER_STACKED_PANEL_BODY_PADDING_CLASS_NAME = "px-2.5 pb-1.5"
const COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME =
  "size-5 rounded-md text-[var(--color-text-foreground-tertiary)] hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-foreground)]"

type ComposerStackedPanelProps = React.HTMLAttributes<HTMLDivElement> & {
  attachedToPrevious?: boolean
  passthroughSideMargins?: boolean
}

const ComposerStackedPanel = React.memo(function ComposerStackedPanel({
  children,
  className,
  attachedToPrevious = false,
  passthroughSideMargins = false,
  ...props
}: ComposerStackedPanelProps) {
  const panel = (
    <div
      data-composer-stacked-attached={
        attachedToPrevious ? "true" : undefined
      }
      className={cn(
        "mx-auto -mb-px w-11/12 min-w-0",
        passthroughSideMargins && "pointer-events-auto",
        COMPOSER_STACKED_PANEL_CHROME_CLASS_NAME,
        className
      )}
      {...props}
    >
      {children}
    </div>
  )

  return passthroughSideMargins ? (
    <div className="pointer-events-none w-full">{panel}</div>
  ) : (
    panel
  )
})

const ComposerStackedPanelHeaderRow = React.memo(
  function ComposerStackedPanelHeaderRow({
    className,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) {
    return (
      <div
        className={cn(
          COMPOSER_STACKED_PANEL_HEADER_ROW_CLASS_NAME,
          className
        )}
        {...props}
      />
    )
  }
)

const ComposerStackedPanelRowMain = React.memo(
  function ComposerStackedPanelRowMain({
    className,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) {
    return (
      <div
        className={cn(
          COMPOSER_STACKED_PANEL_ROW_MAIN_CLASS_NAME,
          className
        )}
        {...props}
      />
    )
  }
)

const ComposerStackedPanelRowLabel = React.memo(
  function ComposerStackedPanelRowLabel({
    children,
    className,
  }: {
    children: React.ReactNode
    className?: string
  }) {
    return (
      <span
        className={cn(COMPOSER_STACKED_PANEL_META_CLASS_NAME, className)}
      >
        {children}
      </span>
    )
  }
)

export {
  COMPOSER_STACKED_PANEL_BODY_PADDING_CLASS_NAME,
  COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME,
  COMPOSER_STACKED_PANEL_ICON_CLASS_NAME,
  ComposerStackedPanel,
  ComposerStackedPanelHeaderRow,
  ComposerStackedPanelRowLabel,
  ComposerStackedPanelRowMain,
}
