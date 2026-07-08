import * as React from "react"
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiSearchLine,
} from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type PageControlSize = "xs" | "sm" | "default"

const inputSizeClass: Record<PageControlSize, string> = {
  xs: "h-7 rounded-(--radius-md) pl-8 text-xs",
  sm: "h-8 pl-9",
  default: "h-9 pl-9",
}

const iconSizeClass: Record<PageControlSize, string> = {
  xs: "left-2.5 size-4",
  sm: "left-3 size-4",
  default: "left-3 size-4",
}

function PageSearchInput({
  ariaLabel,
  className,
  inputClassName,
  onValueChange,
  placeholder,
  size = "sm",
  value,
}: {
  ariaLabel?: string
  className?: string
  inputClassName?: string
  onValueChange: (value: string) => void
  placeholder: string
  size?: PageControlSize
  value: string
}) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <RiSearchLine
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground",
          iconSizeClass[size]
        )}
      />
      <Input
        aria-label={ariaLabel ?? placeholder}
        className={cn(inputSizeClass[size], inputClassName)}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        type="search"
        value={value}
      />
    </div>
  )
}

function PagePaginationBar({
  className,
  nextDisabled,
  nextLabel,
  onNext,
  onPrevious,
  previousDisabled,
  previousLabel,
  summary,
}: {
  className?: string
  nextDisabled: boolean
  nextLabel: string
  onNext: () => void
  onPrevious: () => void
  previousDisabled: boolean
  previousLabel: string
  summary: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between border-t py-3",
        className
      )}
    >
      <span className="text-xs text-muted-foreground">{summary}</span>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-muted-foreground"
          disabled={previousDisabled}
          onClick={onPrevious}
        >
          <RiArrowLeftSLine aria-hidden />
          {previousLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-muted-foreground"
          disabled={nextDisabled}
          onClick={onNext}
        >
          {nextLabel}
          <RiArrowRightSLine aria-hidden />
        </Button>
      </div>
    </div>
  )
}

function PageLoadMoreBar({
  className,
  label,
  onLoadMore,
}: {
  className?: string
  label: string
  onLoadMore: () => void
}) {
  return (
    <div className={cn("flex justify-center pt-4", className)}>
      <Button type="button" variant="outline" onClick={onLoadMore}>
        {label}
      </Button>
    </div>
  )
}

function PageEmptyState({
  action,
  className,
  description,
  icon,
  title,
}: {
  action?: React.ReactNode
  className?: string
  description?: React.ReactNode
  icon: React.ReactNode
  title: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex min-h-72 items-center justify-center rounded-4xl bg-card px-6 py-12 text-center shadow-md ring-1 ring-foreground/5",
        className
      )}
    >
      <div className="flex max-w-md flex-col items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-medium">{title}</h2>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </div>
  )
}

export {
  PageEmptyState,
  PageLoadMoreBar,
  PagePaginationBar,
  PageSearchInput,
}
