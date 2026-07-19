"use client"

import Link from "next/link"
import * as React from "react"
import { IconExternalLink } from "@tabler/icons-react"

import { CentralIcon } from "@/components/central-icon"
import { useI18n } from "@/components/i18n-provider"
import { TokenSearchInput } from "@/components/search-input"
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
  icon?: string
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

function useSettingsSidebarCopy() {
  const { locale } = useI18n()

  return locale === "zh"
    ? {
        unavailable: "不可用",
        clearSearch: "清除设置搜索",
        searchPlaceholder: "搜索设置…",
        settings: "设置",
        back: "返回",
        navigation: "设置",
        expand: "展开设置导航",
        collapse: "收起设置导航",
        noMatches: "没有匹配的设置。",
        clearFilter: "清除筛选",
        viewAll: "以查看全部设置",
      }
    : {
        unavailable: "Unavailable",
        clearSearch: "Clear settings search",
        searchPlaceholder: "Search settings...",
        settings: "Settings",
        back: "Back",
        navigation: "Settings",
        expand: "Expand settings navigation",
        collapse: "Collapse settings navigation",
        noMatches: "No matching settings.",
        clearFilter: "Clear filter",
        viewAll: "to view all settings",
      }
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
  const copy = useSettingsSidebarCopy()
  const disabled = item.disabled
  const external = item.external
  const content = (
    <>
      <CentralIcon
        name={item.icon ?? "settings-gear-1"}
        className="size-4 shrink-0"
      />
      {!collapsed ? (
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      ) : null}
      {!collapsed && item.trailing ? (
        <span className="ml-auto shrink-0">{item.trailing}</span>
      ) : null}
      {!collapsed && external ? (
        <IconExternalLink
          className="ml-auto size-3.5 shrink-0 opacity-55"
          aria-hidden
        />
      ) : null}
    </>
  )

  const className = cn(
    "no-drag group relative flex h-(--height-token-nav-row) w-full items-center rounded-(--radius-md) px-2 text-sm transition-colors outline-none",
    collapsed ? "justify-center" : "gap-2",
    disabled
      ? "cursor-not-allowed text-token-description-foreground/60"
      : "cursor-default text-token-text-secondary hover:bg-token-list-hover-background hover:text-token-foreground focus-visible:ring-1 focus-visible:ring-border-focus",
    active && "bg-token-list-hover-background font-medium text-token-foreground"
  )

  if (item.href && !disabled) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              className={className}
              href={item.href}
              onClick={() => onSelect?.(item)}
            >
              {content}
            </Link>
          </TooltipTrigger>
          {collapsed ? (
            <TooltipContent side="right">{item.label}</TooltipContent>
          ) : null}
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
            {disabled ? copy.unavailable : item.label}
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
  const copy = useSettingsSidebarCopy()

  return (
    <TokenSearchInput
      clearable
      clearLabel={copy.clearSearch}
      containerClassName="shrink-0"
      onValueChange={onQueryChange}
      placeholder={copy.searchPlaceholder}
      value={query}
    />
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
  title,
  backLabel,
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
  const copy = useSettingsSidebarCopy()
  const [localCollapsed, setLocalCollapsed] = React.useState(defaultCollapsed)
  const [query, setQuery] = React.useState("")
  const actualCollapsed = collapsed ?? localCollapsed
  const searchResults = React.useMemo(
    () => getSettingsSearchResults(groups, query),
    [groups, query]
  )
  const isSearching = !actualCollapsed && normalizeSearch(query).length > 0
  const resolvedTitle = title === undefined ? copy.settings : title
  const resolvedBackLabel = backLabel ?? copy.back

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
        "flex h-full min-h-0 shrink-0 flex-col overflow-visible border-r border-token-border-light bg-token-side-bar-background text-token-foreground",
        actualCollapsed
          ? "w-14 px-2"
          : "w-[var(--settings-sidebar-width,18.5rem)] px-2",
        className
      )}
    >
      <div
        aria-hidden
        data-electron-drag-header
        data-titlebar-drag-region
        className="h-(--titlebar-height) shrink-0"
      />

      <nav
        aria-label={copy.navigation}
        className="flex min-h-0 flex-1 flex-col px-1 select-none"
      >
        {canCollapse ? (
          <div className="mb-2 shrink-0">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={actualCollapsed ? copy.expand : copy.collapse}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                    onClick={() => setCollapsed(!actualCollapsed)}
                  >
                    <CentralIcon
                      name={
                        actualCollapsed
                          ? "sidebar-simple-left-wide"
                          : "sidebar-hidden-right-wide"
                      }
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {actualCollapsed ? copy.expand : copy.collapse}
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
              "no-drag group relative mb-2 flex h-(--height-token-nav-row) w-full items-center rounded-(--radius-md) text-sm text-token-text-secondary transition-colors outline-none hover:bg-token-list-hover-background hover:text-token-foreground focus-visible:ring-1 focus-visible:ring-border-focus",
              actualCollapsed ? "justify-center px-0" : "gap-2 px-2"
            )}
            onClick={onBack}
          >
            <CentralIcon name="arrow-left" className="size-4 shrink-0" />
            {actualCollapsed ? (
              <span className="sr-only">{resolvedBackLabel}</span>
            ) : (
              resolvedBackLabel
            )}
          </button>
        ) : null}

        {!actualCollapsed && resolvedTitle ? (
          <div className="mb-3 px-2 text-sm font-medium text-token-foreground">
            {resolvedTitle}
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
                <p className="px-2 py-1 text-sm text-token-description-foreground">
                  {copy.noMatches}
                </p>
              ) : null}
            </div>
          ) : (
            groups.map((group) => (
              <div className="grid gap-0.5" key={group.id}>
                {groupSettingsSections && group.label && !actualCollapsed ? (
                  <div className="px-2 pb-1 text-xs text-token-description-foreground">
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
          <div className="shrink-0 px-2 pb-2 text-sm text-token-description-foreground">
            <button
              type="button"
              className="mr-1 cursor-default border-0 bg-transparent p-0 underline underline-offset-2 hover:text-token-foreground"
              onClick={onClearHostFilter}
            >
              {copy.clearFilter}
            </button>{" "}
            {copy.viewAll}
          </div>
        ) : null}

        {footer && !actualCollapsed ? (
          <div className="shrink-0 pb-3">{footer}</div>
        ) : null}
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
    <div className="flex h-dvh min-h-0 bg-token-main-surface-primary text-token-foreground">
      {sidebar}
      <main className="relative isolate flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          aria-hidden
          data-electron-drag-header
          data-titlebar-drag-region
          className="h-(--titlebar-height) shrink-0"
        />
        <div className={cn("min-h-0 flex-1 overflow-y-auto", contentClassName)}>
          <div className="mx-auto w-full max-w-3xl px-6 py-8">{children}</div>
        </div>
      </main>
    </div>
  )
}

export { SettingsSecondarySidebar, SettingsTwoColumnShell }
export type { SettingsSidebarGroup, SettingsSidebarItem }
