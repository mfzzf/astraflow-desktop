"use client"

import {
  RiAddLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiBookOpenLine,
  RiFolderLine,
  RiRefreshLine,
  RiSearchLine,
} from "@remixicon/react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { useSkillsMarketPageState } from "@/components/skills-market/hooks/use-skills-market-page-state"
import {
  InstalledMcpCard,
  InstalledSkillCard,
  McpMarketCard,
  McpManualDialog,
  SkillCard,
  SkillDetailDialog,
  SkillImportDialog,
  SkillSkeletonGrid,
} from "@/components/skills-market/skills-market-components"
import { type SkillsMarketPageProps } from "@/components/skills-market/types"

export function SkillsMarketPage({
  embedded = false,
  initialView = "market",
}: SkillsMarketPageProps = {}) {
  const state = useSkillsMarketPageState({ embedded, initialView })
  const {
    category,
    categories,
    debouncedQuery,
    detail,
    detailError,
    detailLoading,
    detailOpen,
    error,
    handleCategoryChange,
    handleImportFolderChange,
    handleImportFolderClick,
    handleImportSelectedSkills,
    handleInstallMcpFromMarket,
    handleInstallSkill,
    handleMcpManualOpenChange,
    handleNextMcpPage,
    handleOrderChange,
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
    mcpInstalledLoading,
    mcpLoading,
    mcpManualError,
    mcpManualForm,
    mcpManualOpen,
    mcpNextCursor,
    mcpServers,
    mcpEditingId,
    needsSidebarToggleOffset,
    openEditMcpDialog,
    openInstalledSkill,
    openManualMcpDialog,
    openSkill,
    page,
    pluginTabs,
    pluginType,
    query,
    refresh,
    searchPlaceholder,
    selectedInstalledSkill,
    selectedSkill,
    setDetailOpen,
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
        className={cn(
          "flex h-full min-h-0 w-full flex-col",
          embedded
            ? "px-5 py-4"
            : needsSidebarToggleOffset
              ? "px-6 pt-14 lg:px-8 lg:pt-16"
              : "px-6 pt-6 lg:px-8 lg:pt-8"
        )}
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
                    <span className="hidden sm:inline">{t.skillImportFolder}</span>
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
                      : isSkillsPlugin
                        ? loading
                        : mcpLoading) && "animate-spin"
                  )}
                />
              </Button>
            </div>
          </div>

          {embedded ? null : pluginTabs}

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="relative min-w-0 sm:w-72">
              <RiSearchLine
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="h-8 pl-9"
              />
            </div>

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
                          {item
                            .split("-")
                            .filter(Boolean)
                            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                            .join(" ")}
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
                      <SelectItem value="recent">
                        {t.skillSortUpdated}
                      </SelectItem>
                      <SelectItem value="popular">
                        {t.skillSortDownloads}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </>
            ) : null}

            <span className="min-w-0 shrink-0 truncate text-xs text-muted-foreground">
              {isMineView
                ? t.mcpEnabledSummary(enabledPluginCount, totalPluginCount)
                : pluginType === "mcp"
                  ? t.mcpMarketSummary(page + 1, mcpServers.length)
                  : t.skillsSummary(visibleStart, visibleEnd, totalCount)}
            </span>
          </div>
        </header>

        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto",
            embedded ? "py-4 pr-1" : "pt-4"
          )}
        >
          {error ? (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>{t.requestFailed}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {isMineView ? (
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
                      <p className="text-sm font-medium">{t.skillNoInstalled}</p>
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
                    installedMcpByRegistry.get(`${server.name}@${server.version}`) ??
                    installedMcpByRegistry.get(server.name)
                  }
                  locale={locale}
                  server={server}
                  onInstall={handleInstallMcpFromMarket}
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
                  installedSkill={skill.Slug ? installedBySlug.get(skill.Slug) : undefined}
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

        {view === "market" ? (
          <div className="flex shrink-0 items-center justify-between border-t py-3">
            <span className="text-xs text-muted-foreground">
              {isSkillsPlugin
                ? t.skillsPage(page + 1, totalPages)
                : t.mcpPage(page + 1)}
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-muted-foreground"
                disabled={page <= 0 || (isSkillsPlugin ? loading : mcpLoading)}
                onClick={
                  isSkillsPlugin
                    ? () => setPage((current) => Math.max(0, current - 1))
                    : handlePreviousMcpPage
                }
              >
                <RiArrowLeftSLine aria-hidden />
                {t.previous}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-muted-foreground"
                disabled={
                  isSkillsPlugin
                    ? page + 1 >= totalPages || loading
                    : !mcpNextCursor || mcpLoading
                }
                onClick={
                  isSkillsPlugin
                    ? () => setPage((current) => Math.min(totalPages - 1, current + 1))
                    : handleNextMcpPage
                }
              >
                {t.next}
                <RiArrowRightSLine aria-hidden />
              </Button>
            </div>
          </div>
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
