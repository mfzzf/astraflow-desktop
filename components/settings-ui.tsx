"use client"

import * as React from "react"
import { RiLoader4Line } from "@remixicon/react"

import { cn } from "@/lib/utils"

// Shared building blocks for the full-screen settings surface. Every settings
// page is composed from the same three primitives so the whole area reads as
// one system: a page header, titled sections, and hairline-divided rows with
// the control pinned to the right.

function SettingsPage({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex w-full flex-col gap-4", className)}
      {...props}
    />
  )
}

function SettingsPageHeader({
  title,
  description,
  busy = false,
}: {
  title: string
  description?: string
  busy?: boolean
}) {
  return (
    <header className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="truncate text-xl leading-tight font-medium tracking-tight">
          {title}
        </h1>
        {description ? (
          <p className="text-sm text-token-text-secondary">{description}</p>
        ) : null}
      </div>
      <RiLoader4Line
        aria-hidden
        className={cn(
          "mt-1.5 size-4 shrink-0 animate-spin text-token-description-foreground transition-opacity",
          busy ? "opacity-100" : "opacity-0"
        )}
      />
    </header>
  )
}

function SettingsSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("flex flex-col gap-1.5", className)}>
      {title || description || action ? (
        <div className="flex items-start justify-between gap-2 px-2 py-1">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {title ? (
              <h2 className="text-xs font-medium text-token-text-secondary">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="text-sm text-token-text-tertiary">{description}</p>
            ) : null}
          </div>
          {action ? (
            <div className="flex shrink-0 items-center gap-2">{action}</div>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col divide-y divide-token-border overflow-hidden rounded-lg border border-token-border bg-transparent">
        {children}
      </div>
    </section>
  )
}

function SettingsRow({
  label,
  description,
  children,
  className,
}: {
  label: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 px-3 py-2.5",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="min-w-0 text-xs text-token-text-primary">{label}</div>
        {description ? (
          <div className="min-w-0 text-xs text-token-text-secondary">
            {description}
          </div>
        ) : null}
      </div>
      {children ? (
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      ) : null}
    </div>
  )
}

// A read-only fact row: muted label on the left, selectable value on the
// right. Used for account/project metadata instead of stat-tile grids.
function SettingsValueRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5">
      <span className="shrink-0 text-xs text-token-text-secondary">
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 truncate text-right text-xs text-token-text-primary select-text",
          mono && "font-mono text-[11px]"
        )}
      >
        {value}
      </span>
    </div>
  )
}

function SettingsEmptyRow({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1 px-4 py-10 text-center text-xs text-token-text-secondary",
        className
      )}
    >
      {children}
    </div>
  )
}

// Compact pill segmented toggle used for small exclusive choices inside
// settings rows (theme, language, runtime mode). Selected pill gets a subtle
// foreground tint; the rest stay ghosted until hovered.
function SettingsSegmented<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  options: { id: T; label: React.ReactNode }[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
  ariaLabel?: string
}) {
  return (
    <div
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5"
      role="group"
    >
      {options.map((option) => {
        const selected = option.id === value

        return (
          <button
            aria-pressed={selected}
            className={cn(
              "flex cursor-default items-center gap-1 rounded-full border border-transparent px-2.5 py-1 text-xs whitespace-nowrap select-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-40",
              selected
                ? "bg-token-foreground/5 text-token-foreground"
                : "text-token-text-tertiary hover:bg-token-list-hover-background hover:text-token-foreground"
            )}
            disabled={disabled}
            key={option.id}
            onClick={() => {
              if (!selected) {
                onChange(option.id)
              }
            }}
            type="button"
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export {
  SettingsEmptyRow,
  SettingsPage,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  SettingsSegmented,
  SettingsValueRow,
}
