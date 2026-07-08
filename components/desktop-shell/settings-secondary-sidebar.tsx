"use client"

import Link from "next/link"
import * as React from "react"
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  X,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type SettingsSidebarItem = {
  id: string
  label: string
  href?: string
  icon?: LucideIcon
  disabled?: boolean
  external?: boolean
  keywords?: string[]
  trailing?: React.ReactNode
}

type SettingsSidebarGroup = {
  id: string
  label?: string
  items: SettingsSidebarItem[]
}

type SettingsSearchResult = {
  groupId: string
  item: SettingsSidebarItem
  match: string
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase()
}

function getSettingsSearchResults(
  groups: SettingsSidebarGroup[],
  query: string
) {
  const normalized = normalizeSearch(query)

  if (!normalized) {
    return []
  }

  return groups.flatMap((group) =>
    group.items.flatMap<SettingsSearchResult>((item) => {
      const terms = [item.label, ...(item.keywords ?? [])]
      const match =
        terms.find((term) => term.toLowerCase().includes(normalized)) ?? null

      if (!match) {
        return []
      }

      return [{ groupId: group.id, item, match }]
    })
  )
}

function SettingsSidebarRow({
  item,
  active,
  collapsed,
  onSelect,
}: {
  item: SettingsSidebarItem
  active: boolean
  collapsed?: boolean
  onSelect?: (item: SettingsSidebarItem) => void
}) {
  const Icon = item.icon ?? Settings
  const disabled = item.disabled
  const external = item.external
  const content = (
    <>
      <Icon className="size-4 shrink-0" aria-hidden />
      {!collapsed ? <span className="min-w-0 flex-1 truncate">{item.label}</span> : null}
      {!collapsed && item.trailing ? (
        <span className="ml-auto shrink-0">{item.trailing}</span>
      ) : null}
      {!collapsed && external ? (
        <ExternalLink className="ml-auto size-3.5 shrink-0 opacity-55" aria-hidden />
      ) : null}
      {!collapsed && active && !external ? (
        <ChevronRight className="ml-auto size-3.5 shrink-0 opacity-65" aria-hidden />
      ) : null}
    </>
  )

  const className = cn(
    "no-drag group relative flex h-8 w-full items-center rounded-lg px-2 text-sm outline-none transition-colors",
    collapsed ? "justify-center" : "gap-2",
    disabled
      ? "cursor-not-allowed text-sidebar-foreground/35"
      : "cursor-default text-sidebar-foreground/75 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring",
    active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
  )

  if (item.href && !disabled) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link className={className} href={item.href} onClick={() => onSelect?.(item)}>
              {content}
            </Link>
          </TooltipTrigger>
          {collapsed ? <TooltipContent side="right">{item.label}</TooltipContent> : null}
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={className}
            disabled={disabled}
            onClick={() => onSelect?.(item)}
          >
            {content}
          </button>
        </TooltipTrigger>
        {collapsed || disabled ? (
          <TooltipContent side="right">
            {disabled ? "Unavailable" : item.label}
          </TooltipContent>
        ) : null}
      </Tooltip>
    </TooltipProvider>
  )
}

function SettingsSearchBox({
  query,
  onQueryChange,
}: {
  query: string
  onQueryChange: (query: string) => void
}) {
  return (
    <div className="no-drag relative shrink-0">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        aria-label="Search settings"
        className="h-8 w-full rounded-lg border border-sidebar-border bg-background/65 pr-8 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-sidebar-ring focus-visible:ring-2 focus-visible:ring-sidebar-ring/20"
        placeholder="Search settings"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      {query ? (
        <button
          type="button"
          aria-label="Clear settings search"
          className="absolute top-1/2 right-2 flex size-4 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          onClick={() => onQueryChange("")}
        >
          <X className="size-3" aria-hidden />
        </button>
      ) : null}
    </div>
  )
}

type SettingsSecondarySidebarProps = {
  groups: SettingsSidebarGroup[]
  activeId: string
  title?: React.ReactNode
  backLabel?: string
  collapsed?: boolean
  defaultCollapsed?: boolean
  canCollapse?: boolean
  groupSettingsSections?: boolean
  hostSelector?: React.ReactNode
  footer?: React.ReactNode
  className?: string
  onBack?: () => void
  onClearHostFilter?: () => void
  onCollapsedChange?: (collapsed: boolean) => void
  onSelect?: (item: SettingsSidebarItem) => void
}

function SettingsSecondarySidebar({
  groups,
  activeId,
  title = "Settings",
  backLabel = "Back",
  collapsed,
  defaultCollapsed = false,
  canCollapse = false,
  groupSettingsSections = true,
  hostSelector,
  footer,
  className,
  onBack,
  onClearHostFilter,
  onCollapsedChange,
  onSelect,
}: SettingsSecondarySidebarProps) {
  const [localCollapsed, setLocalCollapsed] = React.useState(defaultCollapsed)
  const [query, setQuery] = React.useState("")
  const actualCollapsed = collapsed ?? localCollapsed
  const searchResults = React.useMemo(
    () => getSettingsSearchResults(groups, query),
    [groups, query]
  )
  const isSearching = !actualCollapsed && normalizeSearch(query).length > 0

  function setCollapsed(next: boolean) {
    setLocalCollapsed(next)
    onCollapsedChange?.(next)
  }

  function handleRowSelect(item: SettingsSidebarItem) {
    if (!item.disabled) {
      onSelect?.(item)
    }
  }

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 shrink-0 flex-col overflow-visible border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
        actualCollapsed ? "w-14 px-2" : "w-[var(--settings-sidebar-width,16rem)] px-2",
        className
      )}
    >
      <div className="h-(--titlebar-height) shrink-0" aria-hidden />

      <nav
        aria-label="Settings"
        className="flex min-h-0 flex-1 select-none flex-col px-1"
      >
        {canCollapse ? (
          <div className="mb-2 shrink-0">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={
                      actualCollapsed
                        ? "Expand settings navigation"
                        : "Collapse settings navigation"
                    }
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                    onClick={() => setCollapsed(!actualCollapsed)}
                  >
                    {actualCollapsed ? (
                      <PanelLeftOpen className="size-4" aria-hidden />
                    ) : (
                      <PanelLeftClose className="size-4" aria-hidden />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {actualCollapsed
                    ? "Expand settings navigation"
                    : "Collapse settings navigation"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        ) : null}

        {onBack ? (
          <button
            type="button"
            role="link"
            className={cn(
              "no-drag group relative mb-2 flex h-8 w-full items-center rounded-lg text-sm text-sidebar-foreground/70 outline-none transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring",
              actualCollapsed ? "justify-center px-0" : "gap-2 px-2"
            )}
            onClick={onBack}
          >
            <ArrowLeft className="size-4 shrink-0" aria-hidden />
            {actualCollapsed ? <span className="sr-only">{backLabel}</span> : backLabel}
          </button>
        ) : null}

        {!actualCollapsed ? (
          <div className="mb-3 px-2 text-sm font-medium text-sidebar-foreground">
            {title}
          </div>
        ) : null}

        {hostSelector && !actualCollapsed ? (
          <div className="no-drag mb-4 shrink-0">{hostSelector}</div>
        ) : null}

        {!actualCollapsed ? (
          <div className="mb-3">
            <SettingsSearchBox query={query} onQueryChange={setQuery} />
          </div>
        ) : null}

        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto pb-2",
            actualCollapsed ? "flex flex-col gap-2" : "flex flex-col gap-4"
          )}
        >
          {isSearching ? (
            <div className="grid gap-0.5">
              {searchResults.map((result) => (
                <SettingsSidebarRow
                  active={result.item.id === activeId}
                  item={result.item}
                  key={`${result.groupId}:${result.item.id}`}
                  onSelect={handleRowSelect}
                />
              ))}
              {searchResults.length === 0 ? (
                <p className="px-2 py-1 text-sm text-muted-foreground">
                  No matching settings.
                </p>
              ) : null}
            </div>
          ) : (
            groups.map((group) => (
              <div className="grid gap-0.5" key={group.id}>
                {groupSettingsSections && group.label && !actualCollapsed ? (
                  <div className="px-2 pb-1 text-xs text-sidebar-foreground/55">
                    {group.label}
                  </div>
                ) : null}

                {group.items.map((item) => (
                  <SettingsSidebarRow
                    active={item.id === activeId}
                    collapsed={actualCollapsed}
                    item={item}
                    key={item.id}
                    onSelect={handleRowSelect}
                  />
                ))}
              </div>
            ))
          )}
        </div>

        {onClearHostFilter && !actualCollapsed ? (
          <div className="shrink-0 px-2 pb-2 text-sm text-sidebar-foreground/65">
            <button
              type="button"
              className="mr-1 cursor-default border-0 bg-transparent p-0 underline underline-offset-2 hover:text-sidebar-foreground"
              onClick={onClearHostFilter}
            >
              Clear filter
            </button>
            to view all settings
          </div>
        ) : null}

        {footer && !actualCollapsed ? <div className="shrink-0 pb-3">{footer}</div> : null}
      </nav>
    </aside>
  )
}

function SettingsTwoColumnShell({
  sidebar,
  children,
  contentClassName,
}: {
  sidebar: React.ReactNode
  children: React.ReactNode
  contentClassName?: string
}) {
  return (
    <div className="flex h-dvh min-h-0 bg-background text-foreground">
      {sidebar}
      <main className="relative isolate min-h-0 min-w-0 flex-1 overflow-visible">
        <div
          className={cn(
            "h-full min-h-0 overflow-y-auto px-8 pt-14 pb-20 lg:px-10",
            contentClassName
          )}
        >
          <div className="mx-auto w-full max-w-[1120px]">{children}</div>
        </div>
      </main>
    </div>
  )
}

export { SettingsSecondarySidebar, SettingsTwoColumnShell }
export type { SettingsSidebarGroup, SettingsSidebarItem }
