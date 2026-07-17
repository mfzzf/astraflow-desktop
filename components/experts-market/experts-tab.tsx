"use client"

import { RiGroupLine, RiRefreshLine, RiRobotLine } from "@remixicon/react"

import { DenseListRow } from "@/components/dense-list-row"
import { useI18n } from "@/components/i18n-provider"
import { PagePaginationBar, PageSearchInput } from "@/components/page-controls"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

import { PluginMeta } from "@/components/skills-market/skills-market-components"
import {
  allExpertCategoriesValue,
  useExperts,
} from "./use-experts"
import type {
  ExpertAgent,
  ExpertCategory,
  ExpertDetail,
  ExpertListItem,
  ExpertSkill,
  ExpertTeamMember,
} from "./types"
import { isExpertRuntimeAvailable } from "./types"

type ExpertsTabProps = {
  embedded?: boolean
  onSearchValueChange?: (value: string) => void
  query: string
  refreshKey: number
  searchPlaceholder?: string
  searchValue?: string
}

export function ExpertsTab({
  embedded = false,
  onSearchValueChange,
  query,
  refreshKey,
  searchPlaceholder,
  searchValue,
}: ExpertsTabProps) {
  const { locale, t } = useI18n()
  const state = useExperts({ query, refreshKey })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-w-0 flex-wrap items-center gap-2 pb-3">
        <PageSearchInput
          className="sm:w-72"
          onValueChange={(value) => onSearchValueChange?.(value)}
          placeholder={searchPlaceholder ?? t.expertSearch}
          value={searchValue ?? query}
        />

        <Select value={state.categoryId} onValueChange={state.setCategoryId}>
          <SelectTrigger
            size="sm"
            className="h-8 w-fit max-w-56 min-w-0 px-2.5 text-xs sm:text-sm"
            aria-label={t.expertCategory}
          >
            <SelectValue placeholder={t.expertCategory} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={allExpertCategoriesValue}>
                {t.expertAllCategories}
              </SelectItem>
              {state.categories
                .filter((category) => Boolean(category.id))
                .map((category) => (
                  <SelectItem key={category.id} value={category.id ?? ""}>
                    {getCategoryName(category, locale)}
                  </SelectItem>
                ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          value={state.typeFilter}
          onValueChange={(value) =>
            state.setTypeFilter(value === "team" || value === "agent" ? value : "all")
          }
        >
          <SelectTrigger
            size="sm"
            className="h-8 w-fit max-w-40 min-w-0 px-2.5 text-xs sm:text-sm"
            aria-label={t.expertType}
          >
            <SelectValue placeholder={t.expertType} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">{t.expertTypeAll}</SelectItem>
              <SelectItem value="agent">{t.expertTypeAgent}</SelectItem>
              <SelectItem value="team">{t.expertTypeTeam}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          value={state.orderBy}
          onValueChange={(value) =>
            state.setOrderBy(value === "name" ? "name" : "recent")
          }
        >
          <SelectTrigger
            size="sm"
            className="h-8 w-fit max-w-40 min-w-0 px-2.5 text-xs sm:text-sm"
            aria-label={t.expertSort}
          >
            <SelectValue placeholder={t.expertSort} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="recent">{t.expertSortRecent}</SelectItem>
              <SelectItem value="name">{t.expertSortName}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <span className="min-w-0 shrink-0 truncate text-xs text-muted-foreground">
          {t.expertSummary(
            state.experts.length,
            state.totalSize,
            state.availableCount,
            state.metadataOnlyCount
          )}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {state.error ? (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>{t.requestFailed}</AlertTitle>
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}

        {state.loading ? (
          <ExpertSkeletonList />
        ) : state.experts.length === 0 ? (
          <div
            className={cn(
              "flex items-center justify-center",
              embedded ? "min-h-48 py-8" : "min-h-full py-12"
            )}
          >
            <div className="flex max-w-sm flex-col items-center text-center">
              <RiRobotLine
                aria-hidden
                className="mb-3 size-5 text-muted-foreground"
              />
              <p className="text-sm font-medium">{t.expertNoResults}</p>
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col">
            {state.experts.map((expert) => (
              <ExpertRow
                key={expert.id || expert.slug}
                expert={expert}
                locale={locale}
                summoning={state.summoningId === expert.id}
                onOpen={state.openExpert}
                onSummon={state.summon}
              />
            ))}
          </div>
        )}
      </div>

      <PagePaginationBar
        nextDisabled={!state.hasNext || state.loading}
        nextLabel={t.next}
        onNext={state.goNext}
        onPrevious={state.goPrevious}
        previousDisabled={!state.hasPrevious || state.loading}
        previousLabel={t.previous}
        summary={
          state.totalSize > 0
            ? t.expertPageSummary(state.experts.length, state.totalSize)
            : t.expertPageSummary(0, 0)
        }
      />

      <ExpertDetailDialog
        detail={state.detail}
        error={state.detailError}
        expert={state.selectedExpert}
        loading={state.detailLoading}
        locale={locale}
        open={state.detailOpen}
        summoning={Boolean(
          state.selectedExpert?.id && state.summoningId === state.selectedExpert.id
        )}
        onOpenChange={state.setDetailOpen}
        onSummon={state.summon}
      />
    </div>
  )
}

function ExpertSkeletonList() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 8 }).map((_, index) => (
        <DenseListRow
          as="div"
          key={index}
          interactive={false}
        >
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3 w-80 max-w-full" />
          </div>
          <Skeleton className="h-8 w-24 shrink-0" />
        </DenseListRow>
      ))}
    </div>
  )
}

function ExpertRow({
  expert,
  locale,
  onOpen,
  onSummon,
  summoning,
}: {
  expert: ExpertListItem
  locale: string
  onOpen: (expert: ExpertListItem) => void
  onSummon: (expert: ExpertListItem, prompt?: string) => void
  summoning: boolean
}) {
  const { t } = useI18n()
  const title = getExpertName(expert, locale)
  const description = getExpertDescription(expert, locale)
  const canSummon = isExpertRuntimeAvailable(expert)
  const quickPrompt = expert.quickPrompts?.find(Boolean)

  return (
    <DenseListRow>
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted/35 text-xs font-semibold text-muted-foreground">
        {expert.type === "team" ? (
          <RiGroupLine aria-hidden className="size-4" />
        ) : (
          getInitials(title)
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate text-sm font-medium">{title}</h2>
          <span className="truncate text-xs text-muted-foreground">
            {getExpertProfession(expert, locale) || expert.slug}
          </span>
          <Badge variant="outline" className="shrink-0">
            {expert.type === "team" ? t.expertTypeTeam : t.expertTypeAgent}
          </Badge>
          {canSummon ? null : (
            <Badge variant="secondary" className="shrink-0">
              {t.expertMetadataOnly}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
          {description || t.expertNoDescription}
        </p>
        <PluginMeta
          parts={[
            expert.categoryId,
            expert.tags?.slice(0, 3).join(" / "),
            t.expertPromptCount(expert.promptCount ?? 0),
            t.expertSkillCount(expert.skillCount ?? 0),
            expert.type === "team"
              ? t.expertMemberCount(expert.memberCount ?? 0)
              : null,
          ]}
        />
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {quickPrompt ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="hidden h-8 max-w-40 text-muted-foreground lg:inline-flex"
            disabled={!canSummon || summoning}
            onClick={() => onSummon(expert, quickPrompt)}
          >
            <span className="truncate">{quickPrompt}</span>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-muted-foreground"
          onClick={() => onOpen(expert)}
        >
          {t.skillView}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          disabled={!canSummon || summoning}
          title={canSummon ? undefined : t.expertUnavailable}
          onClick={() => onSummon(expert)}
        >
          {summoning ? (
            <RiRefreshLine aria-hidden className="animate-spin" />
          ) : (
            <RiRobotLine aria-hidden />
          )}
          {summoning ? t.expertSummoning : t.expertSummon}
        </Button>
      </div>
    </DenseListRow>
  )
}

function ExpertDetailDialog({
  detail,
  error,
  expert,
  loading,
  locale,
  onOpenChange,
  onSummon,
  open,
  summoning,
}: {
  detail: ExpertDetail | null
  error: string
  expert: ExpertListItem | null
  loading: boolean
  locale: string
  onOpenChange: (open: boolean) => void
  onSummon: (expert: ExpertListItem, prompt?: string) => void
  open: boolean
  summoning: boolean
}) {
  const { t } = useI18n()
  const summary = detail?.summary ?? expert
  const agents = detail?.agents ?? []
  const skills = detail?.skills ?? []
  const mcpServers = detail?.mcpServers ?? []
  const teamMembers = detail?.teamMembers ?? []
  const quickPrompts = summary?.quickPrompts ?? []
  const canSummon = summary ? isExpertRuntimeAvailable(summary) : false

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(42rem,calc(100vh-2rem))] max-w-3xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{summary ? getExpertName(summary, locale) : t.experts}</DialogTitle>
          <DialogDescription>
            {summary
              ? getExpertProfession(summary, locale) || summary.slug || summary.id
              : t.expertLoading}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {error ? (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>{t.requestFailed}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          ) : summary ? (
            <div className="space-y-5">
              <section>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {summary.type === "team"
                      ? t.expertTypeTeam
                      : t.expertTypeAgent}
                  </Badge>
                  <Badge variant={canSummon ? "outline" : "secondary"}>
                    {canSummon ? t.expertReady : t.expertMetadataOnly}
                  </Badge>
                  {summary.runtimeHash ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {t.expertRuntimeHash(summary.runtimeHash.slice(0, 12))}
                    </span>
                  ) : null}
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  {getExpertDescription(summary, locale) ||
                    t.expertNoDescription}
                </p>
              </section>

              {quickPrompts.length > 0 ? (
                <section>
                  <h3 className="mb-2 text-sm font-medium">
                    {t.expertQuickPrompts}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {quickPrompts.slice(0, 6).map((prompt) => (
                      <Button
                        key={prompt}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 max-w-full"
                        disabled={!canSummon || summoning}
                        onClick={() => expert && onSummon(expert, prompt)}
                      >
                        <span className="truncate">{prompt}</span>
                      </Button>
                    ))}
                  </div>
                </section>
              ) : null}

              {teamMembers.length > 0 ? (
                <DetailList
                  title={t.expertTeamMembers}
                  items={teamMembers.map((member) => ({
                    key: member.id || member.agentName || "",
                    title: getTeamMemberName(member, locale),
                    meta: [
                      member.role,
                      getTeamMemberProfession(member, locale),
                    ],
                  }))}
                />
              ) : null}

              {skills.length > 0 ? (
                <DetailList
                  title={t.expertSkills}
                  items={skills.slice(0, 8).map((skill) => ({
                    key: skill.id || skill.skillSlug || "",
                    title: getSkillName(skill),
                    meta: [skill.description, skill.relativePath],
                  }))}
                />
              ) : null}

              {mcpServers.length > 0 ? (
                <section className="space-y-3">
                  <Alert>
                    <AlertTitle>{t.pluginMcpSummary}</AlertTitle>
                    <AlertDescription>
                      {t.expertConnectorRequired(mcpServers.length)}
                    </AlertDescription>
                  </Alert>
                  <DetailList
                    title={t.pluginMcpSummary}
                    items={mcpServers.map((server, index) => ({
                      key: server.id || server.relativePath || String(index),
                      title: server.id || server.relativePath || t.pluginMcpSummary,
                      meta: [
                        server.relativePath,
                        typeof server.serverCount === "number"
                          ? t.expertConnectorServerCount(server.serverCount)
                          : undefined,
                      ],
                    }))}
                  />
                </section>
              ) : null}

              {agents.length > 0 ? (
                <PromptViewer agents={agents} />
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {t.codeboxCancel}
          </Button>
          <Button
            type="button"
            disabled={!expert || !canSummon || summoning}
            onClick={() => expert && onSummon(expert)}
          >
            {summoning ? (
              <RiRefreshLine aria-hidden className="animate-spin" />
            ) : (
              <RiRobotLine aria-hidden />
            )}
            {summoning ? t.expertSummoning : t.expertSummon}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DetailList({
  items,
  title,
}: {
  items: Array<{ key: string; title: string; meta: Array<string | undefined> }>
  title: string
}) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      <div className="divide-y rounded-md border">
        {items.map((item, index) => (
          <div key={item.key || index} className="px-3 py-2">
            <p className="truncate text-sm font-medium">{item.title}</p>
            <PluginMeta parts={item.meta} />
          </div>
        ))}
      </div>
    </section>
  )
}

function PromptViewer({ agents }: { agents: ExpertAgent[] }) {
  const { t } = useI18n()

  return (
    <section>
      <details className="rounded-md border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
          {t.expertPromptViewer}
        </summary>
        <div className="border-t px-3 py-3">
          <p className="mb-3 text-xs text-muted-foreground">
            {t.expertPromptNotice}
          </p>
          <div className="space-y-3">
            {agents.map((agent) => (
              <div key={agent.id || agent.agentName}>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {[agent.role, agent.agentName].filter(Boolean).join(" · ")}
                </p>
                <pre className="max-h-60 overflow-auto rounded-md bg-muted/70 p-3 text-xs leading-5 whitespace-pre-wrap text-foreground">
                  {agent.promptMarkdown || t.none}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </details>
    </section>
  )
}

function getCategoryName(category: ExpertCategory, locale: string) {
  return (
    (locale === "zh" ? category.nameZh : category.nameEn)?.trim() ||
    category.nameZh?.trim() ||
    category.nameEn?.trim() ||
    category.id ||
    "-"
  )
}

function getExpertName(expert: ExpertListItem, locale: string) {
  return (
    (locale === "zh" ? expert.displayNameZh : expert.displayNameEn)?.trim() ||
    expert.displayName?.trim() ||
    expert.displayNameZh?.trim() ||
    expert.displayNameEn?.trim() ||
    expert.id ||
    expert.slug ||
    "Expert"
  )
}

function getExpertProfession(expert: ExpertListItem, locale: string) {
  return (
    (locale === "zh" ? expert.professionZh : expert.professionEn)?.trim() ||
    expert.profession?.trim() ||
    expert.professionZh?.trim() ||
    expert.professionEn?.trim() ||
    ""
  )
}

function getExpertDescription(expert: ExpertListItem, locale: string) {
  return (
    (locale === "zh" ? expert.descriptionZh : expert.descriptionEn)?.trim() ||
    expert.description?.trim() ||
    expert.descriptionZh?.trim() ||
    expert.descriptionEn?.trim() ||
    ""
  )
}

function getTeamMemberName(member: ExpertTeamMember, locale: string) {
  return (
    (locale === "zh" ? member.displayNameZh : member.displayNameEn)?.trim() ||
    member.displayNameZh?.trim() ||
    member.displayNameEn?.trim() ||
    member.agentName ||
    "-"
  )
}

function getTeamMemberProfession(member: ExpertTeamMember, locale: string) {
  return (
    (locale === "zh" ? member.professionZh : member.professionEn)?.trim() ||
    member.professionZh?.trim() ||
    member.professionEn?.trim() ||
    ""
  )
}

function getSkillName(skill: ExpertSkill) {
  return skill.title?.trim() || skill.skillSlug?.trim() || skill.id || "-"
}

function getInitials(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean)
  const initials = words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase()

  return initials || "E"
}
