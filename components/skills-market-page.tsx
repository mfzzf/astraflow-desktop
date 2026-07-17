"use client"

import {
  RiAddLine,
  RiArrowDownSLine,
  RiBookOpenLine,
  RiFolderLine,
  RiRefreshLine,
  RiSearchLine,
} from "@remixicon/react"

import { getSidebarAwarePageInsetClassName } from "@/components/app-page-inset"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { PagePaginationBar, PageSearchInput } from "@/components/page-controls"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ExpertsTab } from "@/components/experts-market/experts-tab"
import { cn } from "@/lib/utils"
import { useSkillsMarketPageState } from "@/components/skills-market/hooks/use-skills-market-page-state"
import {
  InstalledMcpCard,
  InstalledSkillCard,
  McpDetailDialog,
  McpMarketCard,
  McpManualDialog,
  SkillCard,
  SkillDetailDialog,
  SkillImportDialog,
  SkillSkeletonGrid,
} from "@/components/skills-market/skills-market-components"
import { type SkillsMarketPageProps } from "@/components/skills-market/types"

function formatMarketplaceKey(value: string) {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function MarketplaceMultiSelect({
  allLabel,
  label,
  onChange,
  options,
  selected,
}: {
  allLabel: string
  label: string
  onChange: (values: string[]) => void
  options: string[]
  selected: string[]
}) {
  const selectedSet = new Set(selected)
  const summary =
    selected.length === 0
      ? label
      : selected.length === 1
        ? `${label}: ${formatMarketplaceKey(selected[0])}`
        : `${label}: ${selected.length}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 max-w-52 font-normal"
          aria-label={label}
        >
          <span className="truncate">{summary}</span>
          <RiArrowDownSLine data-icon="inline-end" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuCheckboxItem
            checked={selected.length === 0}
            onCheckedChange={() => onChange([])}
            onSelect={(event) => event.preventDefault()}
          >
            {allLabel}
          </DropdownMenuCheckboxItem>
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option}
              checked={selectedSet.has(option)}
              onCheckedChange={(checked) => {
                onChange(
                  checked
                    ? [...selected, option]
                    : selected.filter((item) => item !== option)
                )
              }}
              onSelect={(event) => event.preventDefault()}
            >
              {formatMarketplaceKey(option)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SkillsMarketPage({
  embedded = false,
  initialView = "market",
}: SkillsMarketPageProps = {}) {
  const state = useSkillsMarketPageState({ embedded, initialView })
  const {
    category,
    categories,
    subCategory,
    visibleSubCategories,
    debouncedQuery,
    detail,
    detailError,
    detailLoading,
    detailOpen,
    error,
    handleCategoryChange,
    handleSubCategoryChange,
    handleImportFolderChange,
    handleImportFolderClick,
    handleImportSelectedSkills,
    handleInstallMcpFromMarket,
    handleInstallSkill,
    handleMcpManualOpenChange,
    handleNextMcpPage,
    handleOrderChange,
    handleMcpOrderChange,
    handleMcpRegistryTypesChange,
    handleMcpStatusesChange,
    handleMcpTransportsChange,
    handlePreviousMcpPage,
    handleRemoveInstalledMcp,
    handleRemoveInstalledSkill,
    handleSaveMcpManual,
    handleScanLocalSkills,
    handleTestInstalledMcp,
    handleToggleAllImportCandidates,
    handleToggleImportCandidate,
    handleToggleInstalledMcp,
    handleToggleInstalledSkill,
    installedBySlug,
    installedMcpByRegistry,
    installedEmptyClass,
    installedGridClass,
    installedLoading,
    loading,
    mcpBusyId,
    mcpDetail,
    mcpDetailError,
    mcpDetailLoading,
    mcpDetailOpen,
    mcpInstalledLoading,
    mcpLoading,
    mcpManualError,
    mcpManualForm,
    mcpManualOpen,
    mcpNextCursor,
    mcpServers,
    mcpOrderBy,
    selectedMcpRegistryTypes,
    selectedMcpStatuses,
    selectedMcpTransports,
    availableMcpRegistryTypes,
    availableMcpStatuses,
    availableMcpTransports,
    mcpTotalCount,
    mcpEditingId,
    needsSidebarToggleOffset,
    openEditMcpDialog,
    openInstalledSkill,
    openManualMcpDialog,
    openMcpDetail,
    openSkill,
    page,
    pluginTabs,
    pluginType,
    query,
    refresh,
    refreshTick,
    searchPlaceholder,
    selectedInstalledSkill,
    selectedMcp,
    selectedSkill,
    setDetailOpen,
    setMcpDetailOpen,
    setPage,
    setQuery,
    setMcpManualForm,
    skillGridClass,
    skillImportData,
    skillImportOpen,
    skillImportScanning,
    skillImportSelected,
    skillImporting,
    setSkillImportOpen,
    t,
    locale,
    totalPages,
    totalCount,
    visibleEnd,
    visibleStart,
    visibleInstalledSkills,
    visibleInstalledMcpServers,
    visibleSkills,
    view,
    orderBy,
    installingSlug,
    isMineView,
    isExpertsPlugin,
    isSkillsPlugin,
    updatingSlug,
    removingSlug,
    directoryInputRef,
    totalPluginCount,
    enabledPluginCount,
    cardSize,
    marketEmptyClass,
  } = state

  return (
    <main className="h-full overflow-hidden bg-background">
      <div
        className={getSidebarAwarePageInsetClassName({
          className: "flex h-full min-h-0 w-full flex-col",
          needsSidebarToggleOffset,
          variant: embedded ? "embedded" : "market",
        })}
      >
        <header
          className={cn(
            "flex shrink-0 flex-col",
            embedded ? "gap-3 border-b pb-3" : "gap-4"
          )}
        >
          <div className="flex min-w-0 items-center justify-between gap-3">
            {embedded ? (
              pluginTabs
            ) : (
              <h1 className="truncate text-xl font-semibold tracking-tight">
                {t.skills}
              </h1>
            )}
            <div className="flex shrink-0 items-center gap-1.5">
              {isSkillsPlugin || isMineView ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-muted-foreground"
                    disabled={skillImporting}
                    onClick={handleImportFolderClick}
                  >
                    <RiFolderLine aria-hidden />
                    <span className="hidden sm:inline">
                      {t.skillImportFolder}
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-muted-foreground"
                    disabled={skillImportScanning || skillImporting}
                    onClick={handleScanLocalSkills}
                  >
                    <RiSearchLine
                      aria-hidden
                      className={cn(skillImportScanning && "animate-spin")}
                    />
                    <span className="hidden sm:inline">{t.skillScanLocal}</span>
                  </Button>
                </>
              ) : null}
              {pluginType === "mcp" || isMineView ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => openManualMcpDialog()}
                >
                  <RiAddLine aria-hidden />
                  <span className="hidden sm:inline">{t.mcpAddManual}</span>
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-muted-foreground"
                aria-label={t.refresh}
                onClick={refresh}
                disabled={
                  isMineView
                    ? installedLoading || mcpInstalledLoading
                    : isExpertsPlugin
                      ? false
                      : pluginType === "mcp"
                        ? mcpLoading
                        : loading
                }
              >
                <RiRefreshLine
                  aria-hidden
                  className={cn(
                    (isMineView
                      ? installedLoading || mcpInstalledLoading
                      : isExpertsPlugin
                        ? false
                        : isSkillsPlugin
                          ? loading
                          : mcpLoading) && "animate-spin"
                  )}
                />
              </Button>
            </div>
          </div>

          {embedded ? null : pluginTabs}

          {isExpertsPlugin ? null : (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <PageSearchInput
                className="sm:w-72"
                onValueChange={setQuery}
                placeholder={searchPlaceholder}
                value={query}
              />

              {isSkillsPlugin && view === "market" ? (
                <>
                  <Select value={category} onValueChange={handleCategoryChange}>
                    <SelectTrigger
                      size="sm"
                      className="h-8 w-fit max-w-56 min-w-0 px-2.5 text-xs sm:text-sm"
                      aria-label={t.skillCategory}
                    >
                      <SelectValue placeholder={t.skillCategory} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="__all__">
                          {t.skillAllCategories}
                        </SelectItem>
                        {categories.map((item) => (
                          <SelectItem key={item} value={item}>
                            {formatMarketplaceKey(item)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>

                  <Select
                    value={subCategory}
                    onValueChange={handleSubCategoryChange}
                  >
                    <SelectTrigger
                      size="sm"
                      className="h-8 w-fit max-w-56 min-w-0 px-2.5 text-xs sm:text-sm"
                      aria-label={t.skillSubCategory}
                    >
                      <SelectValue placeholder={t.skillSubCategory} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="__all__">
                          {t.skillAllSubCategories}
                        </SelectItem>
                        {visibleSubCategories.map((item) => (
                          <SelectItem key={item.key} value={item.key}>
                            {locale === "zh"
                              ? item.name
                              : formatMarketplaceKey(item.key)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>

                  <Select value={orderBy} onValueChange={handleOrderChange}>
                    <SelectTrigger
                      size="sm"
                      className="h-8 w-fit max-w-44 min-w-0 px-2.5 text-xs sm:text-sm"
                      aria-label={t.skillSort}
                    >
                      <SelectValue placeholder={t.skillSort} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="popular">
                          {t.skillSortDownloads}
                        </SelectItem>
                        <SelectItem value="stars">
                          {t.skillSortStars}
                        </SelectItem>
                        <SelectItem value="recent">
                          {t.skillSortUpdated}
                        </SelectItem>
                        <SelectItem value="name">{t.skillSortName}</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </>
              ) : null}

              {pluginType === "mcp" && view === "market" ? (
                <>
                  <MarketplaceMultiSelect
                    allLabel={t.mcpAllRegistryTypes}
                    label={t.mcpRegistryTypes}
                    onChange={handleMcpRegistryTypesChange}
                    options={availableMcpRegistryTypes}
                    selected={selectedMcpRegistryTypes}
                  />
                  <MarketplaceMultiSelect
                    allLabel={t.mcpAllTransports}
                    label={t.mcpTransport}
                    onChange={handleMcpTransportsChange}
                    options={availableMcpTransports}
                    selected={selectedMcpTransports}
                  />
                  <MarketplaceMultiSelect
                    allLabel={t.mcpAllStatuses}
                    label={t.mcpStatus}
                    onChange={handleMcpStatusesChange}
                    options={availableMcpStatuses}
                    selected={selectedMcpStatuses}
                  />
                  <Select
                    value={mcpOrderBy}
                    onValueChange={handleMcpOrderChange}
                  >
                    <SelectTrigger
                      size="sm"
                      className="h-8 w-fit max-w-44 min-w-0 px-2.5 text-xs sm:text-sm"
                      aria-label={t.mcpSort}
                    >
                      <SelectValue placeholder={t.mcpSort} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="recent">
                          {t.mcpSortRecent}
                        </SelectItem>
                        <SelectItem value="name">{t.mcpSortName}</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </>
              ) : null}

              <span className="min-w-0 shrink-0 truncate text-xs text-muted-foreground">
                {isMineView
                  ? t.mcpEnabledSummary(enabledPluginCount, totalPluginCount)
                  : pluginType === "mcp"
                    ? t.mcpMarketSummary(mcpServers.length, mcpTotalCount)
                    : t.skillsSummary(visibleStart, visibleEnd, totalCount)}
              </span>
            </div>
          )}
        </header>

        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            isExpertsPlugin && view === "market"
              ? "overflow-hidden"
              : "overflow-y-auto",
            embedded ? "py-4 pr-1" : "pt-4"
          )}
        >
          {error ? (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>{t.requestFailed}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {isExpertsPlugin && view === "market" ? (
            <ExpertsTab
              embedded={embedded}
              query={debouncedQuery}
              refreshKey={refreshTick}
              searchPlaceholder={searchPlaceholder}
              searchValue={query}
              onSearchValueChange={setQuery}
            />
          ) : isMineView ? (
            <div className={cn("flex flex-col", embedded ? "gap-4" : "gap-5")}>
              <section className="flex flex-col gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2 px-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <RiBookOpenLine
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <h2 className="truncate text-base font-semibold">
                      {t.pluginTypeSkills}
                    </h2>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t.skillInstalledSummary(visibleInstalledSkills.length)}
                  </span>
                </div>

                {installedLoading ? (
                  <SkillSkeletonGrid size={cardSize} />
                ) : visibleInstalledSkills.length === 0 ? (
                  <div className={installedEmptyClass}>
                    <div className="flex max-w-sm flex-col items-center text-center">
                      <div className="mb-3 flex items-center justify-center text-muted-foreground">
                        <RiBookOpenLine className="size-5" aria-hidden />
                      </div>
                      <p className="text-sm font-medium">
                        {t.skillNoInstalled}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className={installedGridClass}>
                    {visibleInstalledSkills.map((installedSkill, index) => (
                      <InstalledSkillCard
                        key={`${installedSkill.slug}-${installedSkill.version}-${index}`}
                        busy={
                          updatingSlug === installedSkill.slug ||
                          removingSlug === installedSkill.slug
                        }
                        installedSkill={installedSkill}
                        locale={locale}
                        onOpen={openInstalledSkill}
                        onRemove={handleRemoveInstalledSkill}
                        onToggle={handleToggleInstalledSkill}
                      />
                    ))}
                  </div>
                )}
              </section>

              <section className="flex flex-col gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2 px-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <RiFolderLine
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <h2 className="truncate text-base font-semibold">
                      {t.pluginTypeMcp}
                    </h2>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t.mcpInstalledSummary(visibleInstalledMcpServers.length)}
                  </span>
                </div>

                {mcpInstalledLoading ? (
                  <SkillSkeletonGrid size={cardSize} />
                ) : visibleInstalledMcpServers.length === 0 ? (
                  <div className={installedEmptyClass}>
                    <div className="flex max-w-sm flex-col items-center text-center">
                      <div className="mb-3 flex items-center justify-center text-muted-foreground">
                        <RiFolderLine className="size-5" aria-hidden />
                      </div>
                      <p className="text-sm font-medium">{t.mcpNoInstalled}</p>
                      <Button
                        type="button"
                        size="sm"
                        className="mt-4"
                        onClick={() => openManualMcpDialog()}
                      >
                        <RiAddLine aria-hidden />
                        {t.mcpAddManual}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className={installedGridClass}>
                    {visibleInstalledMcpServers.map((server) => (
                      <InstalledMcpCard
                        key={server.id}
                        busy={mcpBusyId === server.id}
                        locale={locale}
                        server={server}
                        onEdit={openEditMcpDialog}
                        onRemove={handleRemoveInstalledMcp}
                        onTest={handleTestInstalledMcp}
                        onToggle={handleToggleInstalledMcp}
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : !isSkillsPlugin && view === "market" && mcpLoading ? (
            <SkillSkeletonGrid size={cardSize} />
          ) : !isSkillsPlugin &&
            view === "market" &&
            mcpServers.length === 0 ? (
            <div className={marketEmptyClass}>
              <div className="flex max-w-sm flex-col items-center text-center">
                <div className="mb-3 flex items-center justify-center text-muted-foreground">
                  <RiFolderLine className="size-5" aria-hidden />
                </div>
                <p className="text-sm font-medium">
                  {debouncedQuery ? t.mcpNoServersFound : t.mcpRegistryEmpty}
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="mt-4"
                  disabled={mcpLoading}
                  onClick={refresh}
                >
                  <RiRefreshLine
                    aria-hidden
                    className={cn(mcpLoading && "animate-spin")}
                  />
                  {t.refresh}
                </Button>
              </div>
            </div>
          ) : !isSkillsPlugin && view === "market" ? (
            <div className={installedGridClass}>
              {mcpServers.map((server) => (
                <McpMarketCard
                  key={server.id}
                  busy={mcpBusyId === server.id}
                  installed={
                    installedMcpByRegistry.get(
                      `${server.name}@${server.version}`
                    ) ?? installedMcpByRegistry.get(server.name)
                  }
                  locale={locale}
                  server={server}
                  onInstall={handleInstallMcpFromMarket}
                  onOpen={openMcpDetail}
                />
              ))}
            </div>
          ) : view === "market" && loading ? (
            <SkillSkeletonGrid size={cardSize} />
          ) : view === "market" && visibleSkills.length === 0 ? (
            <div className={marketEmptyClass}>
              <div className="flex max-w-sm flex-col items-center text-center">
                <div className="mb-3 flex items-center justify-center text-muted-foreground">
                  <RiBookOpenLine className="size-5" aria-hidden />
                </div>
                <p className="text-sm font-medium">{t.noSkillsFound}</p>
              </div>
            </div>
          ) : (
            <div className={skillGridClass}>
              {visibleSkills.map((skill, index) => (
                <SkillCard
                  key={`${skill.Slug}-${skill.Version}-${index}`}
                  installedSkill={
                    skill.Slug ? installedBySlug.get(skill.Slug) : undefined
                  }
                  installing={installingSlug === skill.Slug}
                  locale={locale}
                  skill={skill}
                  onInstall={handleInstallSkill}
                  onOpen={openSkill}
                />
              ))}
            </div>
          )}
        </div>

        {view === "market" && !isExpertsPlugin ? (
          <PagePaginationBar
            nextDisabled={
              isSkillsPlugin
                ? page + 1 >= totalPages || loading
                : !mcpNextCursor || mcpLoading
            }
            nextLabel={t.next}
            onNext={
              isSkillsPlugin
                ? () =>
                    setPage((current) => Math.min(totalPages - 1, current + 1))
                : handleNextMcpPage
            }
            onPrevious={
              isSkillsPlugin
                ? () => setPage((current) => Math.max(0, current - 1))
                : handlePreviousMcpPage
            }
            previousDisabled={
              page <= 0 || (isSkillsPlugin ? loading : mcpLoading)
            }
            previousLabel={t.previous}
            summary={
              isSkillsPlugin
                ? t.skillsPage(page + 1, totalPages)
                : t.mcpPage(page + 1)
            }
          />
        ) : null}
      </div>

      <input
        ref={directoryInputRef}
        type="file"
        className="hidden"
        multiple
        onChange={handleImportFolderChange}
        {...({ directory: "", webkitdirectory: "" } as Record<string, string>)}
      />
      <SkillImportDialog
        open={skillImportOpen}
        onOpenChange={setSkillImportOpen}
        data={skillImportData}
        busy={skillImporting}
        selected={skillImportSelected}
        onToggleCandidate={handleToggleImportCandidate}
        onToggleAll={handleToggleAllImportCandidates}
        onImportSelected={handleImportSelectedSkills}
      />
      <SkillDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        skill={selectedSkill}
        detail={detail}
        installedSkill={selectedInstalledSkill}
        installing={Boolean(
          selectedSkill?.Slug && installingSlug === selectedSkill.Slug
        )}
        loading={detailLoading}
        error={detailError}
        onInstall={handleInstallSkill}
        onRemove={handleRemoveInstalledSkill}
        onToggle={handleToggleInstalledSkill}
        removing={Boolean(
          selectedInstalledSkill && removingSlug === selectedInstalledSkill.slug
        )}
        updating={Boolean(
          selectedInstalledSkill && updatingSlug === selectedInstalledSkill.slug
        )}
      />
      <McpDetailDialog
        open={mcpDetailOpen}
        onOpenChange={setMcpDetailOpen}
        server={selectedMcp}
        detail={mcpDetail}
        installed={
          selectedMcp
            ? (installedMcpByRegistry.get(
                `${selectedMcp.name}@${selectedMcp.version}`
              ) ?? installedMcpByRegistry.get(selectedMcp.name))
            : undefined
        }
        installing={Boolean(selectedMcp && mcpBusyId === selectedMcp.id)}
        loading={mcpDetailLoading}
        error={mcpDetailError}
        onInstall={handleInstallMcpFromMarket}
      />
      <McpManualDialog
        open={mcpManualOpen}
        onOpenChange={handleMcpManualOpenChange}
        mode={mcpEditingId ? "edit" : "create"}
        form={mcpManualForm}
        onChange={setMcpManualForm}
        busy={mcpBusyId === (mcpEditingId || "manual")}
        error={mcpManualError}
        onSubmit={handleSaveMcpManual}
      />
    </main>
  )
}

export { SkillsMarketPage as default }
export type { SkillsMarketPageProps }
