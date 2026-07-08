"use client"

import Link from "next/link"
import * as React from "react"
import { ChevronRight, ExternalLink } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { TokenSearchInput } from "@/components/search-input"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type DesktopSidebarItem = {
  id: string
  label: string
  href?: string
  icon?: LucideIcon
  active?: boolean
  disabled?: boolean
  external?: boolean
  badge?: React.ReactNode
  description?: React.ReactNode
  keywords?: string[]
  onSelect?: () => void
}

type DesktopSidebarSection = {
  id: string
  label?: React.ReactNode
  items: DesktopSidebarItem[]
  action?: React.ReactNode
}

type DesktopSidebarProps = {
  sections: DesktopSidebarSection[]
  activeId?: string
  header?: React.ReactNode
  footer?: React.ReactNode
  collapsed?: boolean
  searchable?: boolean
  searchPlaceholder?: string
  className?: string
  contentClassName?: string
  onSelect?: (item: DesktopSidebarItem) => void
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase()
}

function matchesSidebarSearch(item: DesktopSidebarItem, query: string) {
  const normalized = normalizeSearch(query)

  if (!normalized) {
    return true
  }

  return [item.label, ...(item.keywords ?? [])]
    .join(" ")
    .toLowerCase()
    .includes(normalized)
}

function DesktopSidebarSearch({
  query,
  placeholder,
  onQueryChange,
}: {
  query: string
  placeholder: string
  onQueryChange: (query: string) => void
}) {
  return (
    <TokenSearchInput
      clearable
      clearLabel="Clear search"
      onValueChange={onQueryChange}
      placeholder={placeholder}
      value={query}
    />
  )
}

function DesktopSidebarRow({
  item,
  active,
  collapsed,
  onSelect,
}: {
  item: DesktopSidebarItem
  active: boolean
  collapsed?: boolean
  onSelect?: (item: DesktopSidebarItem) => void
}) {
  const Icon = item.icon
  const disabled = item.disabled
  const content = (
    <>
      {Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
      {!collapsed ? (
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      ) : (
        <span className="sr-only">{item.label}</span>
      )}
      {!collapsed && item.badge ? (
        <span className="ml-auto shrink-0 text-xs text-token-description-foreground">
          {item.badge}
        </span>
      ) : null}
      {!collapsed && item.external ? (
        <ExternalLink className="ml-auto size-3.5 shrink-0 opacity-55" aria-hidden />
      ) : null}
      {!collapsed && active && !item.external ? (
        <ChevronRight className="ml-auto size-3.5 shrink-0 opacity-65" aria-hidden />
      ) : null}
    </>
  )
  const className = cn(
    "no-drag group relative flex h-(--height-token-nav-row) w-full items-center rounded-(--radius-md) px-2 text-sm outline-none transition-colors",
    collapsed ? "justify-center" : "gap-2",
    disabled
      ? "cursor-not-allowed text-token-description-foreground/60"
      : "cursor-default text-token-text-secondary hover:bg-token-list-hover-background hover:text-token-foreground focus-visible:ring-1 focus-visible:ring-border-focus",
    active && "bg-token-list-hover-background font-medium text-token-foreground"
  )

  const handleSelect = () => {
    if (disabled) {
      return
    }

    item.onSelect?.()
    onSelect?.(item)
  }

  const row = item.href && !disabled ? (
    <Link className={className} href={item.href} onClick={handleSelect}>
      {content}
    </Link>
  ) : (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onClick={handleSelect}
    >
      {content}
    </button>
  )

  if (!collapsed && !item.description) {
    return row
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{row}</TooltipTrigger>
        <TooltipContent side="right">
          <div className="grid max-w-64 gap-1">
            <span>{item.label}</span>
            {item.description ? (
              <span className="text-xs text-token-description-foreground">{item.description}</span>
            ) : null}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function DesktopSidebarSectionView({
  section,
  activeId,
  collapsed,
  onSelect,
}: {
  section: DesktopSidebarSection
  activeId?: string
  collapsed?: boolean
  onSelect?: (item: DesktopSidebarItem) => void
}) {
  return (
    <section className="grid gap-1">
      {!collapsed && (section.label || section.action) ? (
        <div className="flex min-h-6 items-center gap-2 px-2">
          {section.label ? (
            <div className="min-w-0 flex-1 truncate text-xs text-token-description-foreground">
              {section.label}
            </div>
          ) : (
            <div className="flex-1" />
          )}
          {section.action ? (
            <div className="no-drag shrink-0 text-token-description-foreground">
              {section.action}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-0.5">
        {section.items.map((item) => (
          <DesktopSidebarRow
            active={item.active ?? item.id === activeId}
            collapsed={collapsed}
            item={item}
            key={item.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  )
}

function DesktopSidebar({
  sections,
  activeId,
  header,
  footer,
  collapsed = false,
  searchable = false,
  searchPlaceholder = "Search",
  className,
  contentClassName,
  onSelect,
}: DesktopSidebarProps) {
  const [query, setQuery] = React.useState("")
  const visibleSections = React.useMemo(() => {
    if (!normalizeSearch(query)) {
      return sections
    }

    return sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => matchesSidebarSearch(item, query)),
      }))
      .filter((section) => section.items.length > 0)
  }, [query, sections])

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden bg-token-side-bar-background text-token-foreground",
        collapsed ? "w-14 px-2" : "w-full px-2",
        className
      )}
    >
      {header ? <div className="shrink-0 py-2">{header}</div> : null}

      {searchable && !collapsed ? (
        <div className="shrink-0 pb-2">
          <DesktopSidebarSearch
            placeholder={searchPlaceholder}
            query={query}
            onQueryChange={setQuery}
          />
        </div>
      ) : null}

      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          collapsed ? "grid content-start gap-2" : "grid content-start gap-4",
          contentClassName
        )}
      >
        {visibleSections.map((section) => (
          <DesktopSidebarSectionView
            activeId={activeId}
            collapsed={collapsed}
            key={section.id}
            section={section}
            onSelect={onSelect}
          />
        ))}

        {query && visibleSections.length === 0 ? (
          <p className="px-2 py-1 text-sm text-token-description-foreground">No results.</p>
        ) : null}
      </div>

      {footer && !collapsed ? <div className="shrink-0 py-2">{footer}</div> : null}
    </div>
  )
}

export { DesktopSidebar, DesktopSidebarRow, DesktopSidebarSectionView }
export type { DesktopSidebarItem, DesktopSidebarSection }
