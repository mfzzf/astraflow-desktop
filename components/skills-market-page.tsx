"use client"

import * as React from "react"
import {
  RiAddLine,
  RiArchiveLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiBookOpenLine,
  RiCheckLine,
  RiCloseLine,
  RiDownloadLine,
  RiExternalLinkLine,
  RiFileTextLine,
  RiFolderLine,
  RiRefreshLine,
  RiSearchLine,
  RiTimeLine,
  RiUser3Line,
  RiVerifiedBadgeLine,
} from "@remixicon/react"

import { useI18n } from "@/components/i18n-provider"
import { Markdown } from "@/components/prompt-kit/markdown"
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
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  type SkillDetailApiResponse,
  type InstalledSkill,
  type InstalledSkillApiResponse,
  type InstalledSkillsApiResponse,
  type SkillMarketApiResponse,
  type SkillMeta,
  type SkillOrderBy,
} from "@/lib/skill-market"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 24
const allCategoriesValue = "__all__"

type SkillDetailState = {
  skill: SkillMeta
  skillMd: string
}

type SkillsView = "market" | "mine"
type PluginType = "skills" | "mcp"
type SkillCardSize = "default" | "large"

type SkillsMarketPageProps = {
  embedded?: boolean
  initialView?: SkillsView
}

function getSkillGridClass(size: SkillCardSize) {
  return size === "large"
    ? "grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-4"
    : "grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3"
}

function getLocaleTag(locale: string) {
  return locale === "zh" ? "zh-CN" : "en-US"
}

function compactNumber(value: number | undefined, locale: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-"
  }

  return new Intl.NumberFormat(getLocaleTag(locale), {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

function formatBytes(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "-"
  }

  const units = ["B", "KB", "MB", "GB"]
  let size = value
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`
}

function formatUpdatedAt(value: number | undefined, locale: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "-"
  }

  const timestamp = value < 1_000_000_000_000 ? value * 1000 : value
  const date = new Date(timestamp)

  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat(getLocaleTag(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

function formatIsoDate(value: string | undefined, locale: string) {
  if (!value) {
    return "-"
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat(getLocaleTag(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

function getSkillTitle(skill: SkillMeta) {
  return skill.Name?.trim() || skill.Slug?.trim() || "Untitled skill"
}

function getSkillDescription(skill: SkillMeta, locale: string) {
  const preferred = locale === "zh" ? skill.DescZh : skill.Desc
  const fallback = locale === "zh" ? skill.Desc : skill.DescZh

  return preferred?.trim() || fallback?.trim() || ""
}

function getAuthor(skill: SkillMeta) {
  return skill.Author?.trim() || "-"
}

function getSkillSearchText(skill: SkillMeta) {
  return [
    skill.Slug,
    skill.Name,
    skill.Author,
    skill.Desc,
    skill.DescZh,
    skill.Category,
    skill.UpStream,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

function categoryLabel(category: string) {
  return category
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

async function fetchSkills({
  category,
  keyword,
  offset,
  orderBy,
  signal,
}: {
  category: string
  keyword: string
  offset: number
  orderBy: SkillOrderBy
  signal: AbortSignal
}) {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(PAGE_SIZE),
    orderBy,
  })

  if (keyword) {
    params.set("keyword", keyword)
  }

  if (category !== allCategoriesValue) {
    params.set("category", category)
  }

  const response = await fetch(`/api/skills?${params}`, {
    signal,
    cache: "no-store",
  })
  const payload = (await response.json()) as SkillMarketApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload
}

async function fetchSkillDetail(skill: SkillMeta, signal: AbortSignal) {
  const slug = skill.Slug?.trim()

  if (!slug) {
    throw new Error("Skill slug is missing.")
  }

  const params = new URLSearchParams()

  if (skill.Version?.trim()) {
    params.set("version", skill.Version.trim())
  }

  const response = await fetch(
    `/api/skills/${encodeURIComponent(slug)}${
      params.size > 0 ? `?${params}` : ""
    }`,
    { signal, cache: "no-store" }
  )
  const payload = (await response.json()) as SkillDetailApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

async function fetchInstalledSkills(signal: AbortSignal) {
  const response = await fetch("/api/skills/installed", {
    signal,
    cache: "no-store",
  })
  const payload = (await response.json()) as InstalledSkillsApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

async function installSkill(skill: SkillMeta) {
  const slug = skill.Slug?.trim()

  if (!slug) {
    throw new Error("Skill slug is missing.")
  }

  const response = await fetch("/api/skills/installed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      slug,
      ...(skill.Version?.trim() ? { version: skill.Version.trim() } : {}),
    }),
  })
  const payload = (await response.json()) as InstalledSkillApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

async function updateInstalledSkill(slug: string, enabled: boolean) {
  const response = await fetch(
    `/api/skills/installed/${encodeURIComponent(slug)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }
  )
  const payload = (await response.json()) as InstalledSkillApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

async function removeInstalledSkill(slug: string) {
  const response = await fetch(
    `/api/skills/installed/${encodeURIComponent(slug)}`,
    { method: "DELETE" }
  )
  const payload = (await response.json()) as
    | { ok: true }
    | { ok: false; message: string }

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }
}

function SkillStat({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      {icon}
      <span className="truncate">{label}</span>
    </span>
  )
}

function SkillCard({
  installedSkill,
  installing,
  locale,
  onInstall,
  onOpen,
  size = "default",
  skill,
}: {
  installedSkill?: InstalledSkill
  installing?: boolean
  locale: string
  onInstall?: (skill: SkillMeta) => void
  onOpen: (skill: SkillMeta) => void
  size?: SkillCardSize
  skill: SkillMeta
}) {
  const { t } = useI18n()
  const title = getSkillTitle(skill)
  const description = getSkillDescription(skill, locale)
  const slug = skill.Slug?.trim() || "-"
  const canInstall =
    Boolean(skill.Slug?.trim()) && !installedSkill && Boolean(onInstall)

  return (
    <article
      className={cn(
        "flex min-w-0 flex-col rounded-lg border bg-card text-card-foreground shadow-sm transition-colors hover:border-foreground/20",
        size === "large" ? "min-h-[252px]" : "min-h-[226px]"
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
              <RiBookOpenLine className="size-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-medium">{title}</h2>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {slug}
              </p>
            </div>
          </div>
          {skill.Latest ? (
            <Badge variant="secondary" className="shrink-0">
              <RiVerifiedBadgeLine aria-hidden />
              {t.skillLatest}
            </Badge>
          ) : null}
        </div>

        <p className="line-clamp-3 min-h-[60px] text-sm leading-5 text-muted-foreground">
          {description || t.skillNoDescription}
        </p>

        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <SkillStat
            icon={<RiDownloadLine className="size-3.5" aria-hidden />}
            label={t.skillDownloads(compactNumber(skill.Downloads, locale))}
          />
          <SkillStat
            icon={<RiFileTextLine className="size-3.5" aria-hidden />}
            label={t.skillFiles(skill.FileCount ?? 0)}
          />
          <SkillStat
            icon={<RiArchiveLine className="size-3.5" aria-hidden />}
            label={formatBytes(skill.SizeBytes)}
          />
          <SkillStat
            icon={<RiTimeLine className="size-3.5" aria-hidden />}
            label={formatUpdatedAt(skill.UpStreamUpdatedAt, locale)}
          />
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-between gap-3 border-t px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="outline" className="max-w-40">
            <span className="truncate">
              {skill.Category ? categoryLabel(skill.Category) : t.none}
            </span>
          </Badge>
          <span className="truncate text-xs text-muted-foreground">
            {getAuthor(skill)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => onOpen(skill)}
          >
            {t.skillView}
          </Button>
          <Button
            type="button"
            variant={installedSkill ? "secondary" : "default"}
            size="sm"
            className="h-8"
            disabled={!canInstall || installing}
            onClick={() => onInstall?.(skill)}
          >
            {installedSkill ? (
              <RiCheckLine aria-hidden />
            ) : (
              <RiAddLine aria-hidden />
            )}
            {installedSkill
              ? t.skillAdded
              : installing
                ? t.skillAdding
                : t.skillAdd}
          </Button>
        </div>
      </div>
    </article>
  )
}

function InstalledSkillCard({
  busy,
  installedSkill,
  locale,
  onOpen,
  onRemove,
  onToggle,
  size = "default",
}: {
  busy: boolean
  installedSkill: InstalledSkill
  locale: string
  onOpen: (installedSkill: InstalledSkill) => void
  onRemove: (installedSkill: InstalledSkill) => void
  onToggle: (installedSkill: InstalledSkill, enabled: boolean) => void
  size?: SkillCardSize
}) {
  const { t } = useI18n()
  const skill = installedSkill.skill
  const title = getSkillTitle(skill)
  const description = getSkillDescription(skill, locale)

  return (
    <article
      className={cn(
        "flex min-w-0 flex-col rounded-lg border bg-card text-card-foreground shadow-sm transition-colors hover:border-foreground/20",
        size === "large" ? "min-h-[252px]" : "min-h-[226px]"
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
              <RiBookOpenLine className="size-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-medium">{title}</h2>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {installedSkill.slug}
              </p>
            </div>
          </div>
          <Badge variant={installedSkill.enabled ? "secondary" : "outline"}>
            {installedSkill.enabled ? t.skillEnabled : t.skillDisabled}
          </Badge>
        </div>

        <p className="line-clamp-3 min-h-[60px] text-sm leading-5 text-muted-foreground">
          {description || t.skillNoDescription}
        </p>

        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <SkillStat
            icon={<RiFileTextLine className="size-3.5" aria-hidden />}
            label={t.skillFiles(installedSkill.installedFileCount)}
          />
          <SkillStat
            icon={<RiArchiveLine className="size-3.5" aria-hidden />}
            label={formatBytes(installedSkill.installedSizeBytes)}
          />
          <SkillStat
            icon={<RiTimeLine className="size-3.5" aria-hidden />}
            label={t.skillInstalledAt(
              formatIsoDate(installedSkill.installedAt, locale)
            )}
          />
          <SkillStat
            icon={<RiVerifiedBadgeLine className="size-3.5" aria-hidden />}
            label={`v${installedSkill.version}`}
          />
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-between gap-3 border-t px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="outline" className="max-w-40">
            <span className="truncate">
              {skill.Category ? categoryLabel(skill.Category) : t.none}
            </span>
          </Badge>
          <span className="truncate text-xs text-muted-foreground">
            {getAuthor(skill)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => onOpen(installedSkill)}
          >
            {t.skillView}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={busy}
            onClick={() => onToggle(installedSkill, !installedSkill.enabled)}
          >
            {installedSkill.enabled ? t.skillDisable : t.skillEnable}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={busy}
            onClick={() => onRemove(installedSkill)}
          >
            <RiCloseLine aria-hidden />
            {t.skillRemove}
          </Button>
        </div>
      </div>
    </article>
  )
}

function SkillSkeletonGrid({ size = "default" }: { size?: SkillCardSize }) {
  return (
    <div className={getSkillGridClass(size)}>
      {Array.from({ length: 9 }).map((_, index) => (
        <div
          key={`skill-skeleton-${index}`}
          className={cn(
            "flex flex-col rounded-lg border bg-card p-4",
            size === "large" ? "min-h-[252px]" : "min-h-[226px]"
          )}
        >
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-md" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="mt-2 h-3 w-1/2" />
            </div>
          </div>
          <Skeleton className="mt-5 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-11/12" />
          <Skeleton className="mt-2 h-3 w-2/3" />
          <div className="mt-auto grid grid-cols-2 gap-3 pt-6">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}

function SkillDetailDialog({
  detail,
  error,
  installedSkill,
  installing,
  loading,
  onInstall,
  onOpenChange,
  onRemove,
  onToggle,
  open,
  removing,
  skill,
  updating,
}: {
  detail: SkillDetailState | null
  error: string
  installedSkill?: InstalledSkill
  installing: boolean
  loading: boolean
  onInstall: (skill: SkillMeta) => void
  onOpenChange: (open: boolean) => void
  onRemove: (installedSkill: InstalledSkill) => void
  onToggle: (installedSkill: InstalledSkill, enabled: boolean) => void
  open: boolean
  removing: boolean
  skill: SkillMeta | null
  updating: boolean
}) {
  const { locale, t } = useI18n()
  const activeSkill = detail?.skill ?? skill
  const title = activeSkill ? getSkillTitle(activeSkill) : t.skills
  const description = activeSkill
    ? getSkillDescription(activeSkill, locale)
    : ""

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] min-h-0 flex-col gap-4 sm:max-w-5xl">
        <DialogHeader className="pr-9">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <DialogTitle className="truncate text-lg">{title}</DialogTitle>
            {activeSkill?.Version ? (
              <Badge variant="secondary">v{activeSkill.Version}</Badge>
            ) : null}
            {activeSkill?.Category ? (
              <Badge variant="outline">
                {categoryLabel(activeSkill.Category)}
              </Badge>
            ) : null}
          </div>
          <DialogDescription className="line-clamp-2">
            {description || t.skillNoDescription}
          </DialogDescription>
        </DialogHeader>

        {activeSkill ? (
          <div className="space-y-2">
            <div className="grid gap-2 rounded-lg border bg-muted/25 p-3 text-xs text-muted-foreground sm:grid-cols-4">
              <SkillStat
                icon={<RiDownloadLine className="size-3.5" aria-hidden />}
                label={t.skillDownloads(
                  compactNumber(activeSkill.Downloads, locale)
                )}
              />
              <SkillStat
                icon={<RiFileTextLine className="size-3.5" aria-hidden />}
                label={t.skillFiles(activeSkill.FileCount ?? 0)}
              />
              <SkillStat
                icon={<RiArchiveLine className="size-3.5" aria-hidden />}
                label={formatBytes(activeSkill.SizeBytes)}
              />
              <SkillStat
                icon={<RiTimeLine className="size-3.5" aria-hidden />}
                label={formatUpdatedAt(activeSkill.UpStreamUpdatedAt, locale)}
              />
            </div>
            {installedSkill ? (
              <div className="flex flex-col gap-2 rounded-lg border bg-muted/25 p-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="mb-1 flex min-w-0 items-center gap-2">
                    <span className="font-medium text-foreground">
                      {t.skillLocalStatus}
                    </span>
                    <Badge
                      variant={installedSkill.enabled ? "secondary" : "outline"}
                    >
                      {installedSkill.enabled
                        ? t.skillEnabled
                        : t.skillDisabled}
                    </Badge>
                  </div>
                  <p className="line-clamp-2">{t.skillSandboxHint}</p>
                </div>
                <span className="shrink-0">
                  {t.skillInstalledAt(
                    formatIsoDate(installedSkill.installedAt, locale)
                  )}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-background p-4">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-32 w-full rounded-lg" />
            </div>
          ) : error ? (
            <Alert variant="destructive">
              <AlertTitle>{t.requestFailed}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : detail?.skillMd ? (
            <Markdown className="prose-sm max-w-none dark:prose-invert prose-headings:font-heading prose-headings:text-foreground prose-a:text-primary prose-code:rounded-sm prose-code:bg-muted prose-code:px-1 prose-code:py-0.5">
              {detail.skillMd}
            </Markdown>
          ) : (
            <p className="text-sm text-muted-foreground">{t.skillNoReadme}</p>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {activeSkill && !installedSkill ? (
            <Button
              type="button"
              size="sm"
              disabled={installing || !activeSkill.Slug?.trim()}
              onClick={() => onInstall(activeSkill)}
            >
              <RiAddLine aria-hidden />
              {installing ? t.skillAdding : t.skillAdd}
            </Button>
          ) : null}
          {installedSkill ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={updating}
                onClick={() => onToggle(installedSkill, !installedSkill.enabled)}
              >
                {installedSkill.enabled ? t.skillDisable : t.skillEnable}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={removing}
                onClick={() => onRemove(installedSkill)}
              >
                <RiCloseLine aria-hidden />
                {removing ? t.skillRemoving : t.skillRemove}
              </Button>
            </>
          ) : null}
          {activeSkill?.UpStreamUrl ? (
            <Button asChild variant="outline" size="sm">
              <a
                href={activeSkill.UpStreamUrl}
                target="_blank"
                rel="noreferrer"
              >
                <RiExternalLinkLine aria-hidden />
                {t.skillUpstream}
              </a>
            </Button>
          ) : null}
          {activeSkill?.ArchiveUrl ? (
            <Button asChild size="sm">
              <a href={activeSkill.ArchiveUrl}>
                <RiDownloadLine aria-hidden />
                {t.skillDownload}
              </a>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SkillsMarketPage({
  embedded = false,
  initialView = "market",
}: SkillsMarketPageProps = {}) {
  const { locale, t } = useI18n()
  const [pluginType, setPluginType] = React.useState<PluginType>("skills")
  const [view, setView] = React.useState<SkillsView>(initialView)
  const [query, setQuery] = React.useState("")
  const [debouncedQuery, setDebouncedQuery] = React.useState("")
  const [category, setCategory] = React.useState(allCategoriesValue)
  const [orderBy, setOrderBy] = React.useState<SkillOrderBy>("popular")
  const [page, setPage] = React.useState(0)
  const [skills, setSkills] = React.useState<SkillMeta[]>([])
  const [installedSkills, setInstalledSkills] = React.useState<
    InstalledSkill[]
  >([])
  const [categories, setCategories] = React.useState<string[]>([])
  const [totalCount, setTotalCount] = React.useState(0)
  const [refreshTick, setRefreshTick] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [installedLoading, setInstalledLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [selectedSkill, setSelectedSkill] = React.useState<SkillMeta | null>(
    null
  )
  const [detailSource, setDetailSource] =
    React.useState<SkillsView>("market")
  const [detail, setDetail] = React.useState<SkillDetailState | null>(null)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [detailError, setDetailError] = React.useState("")
  const [installingSlug, setInstallingSlug] = React.useState("")
  const [updatingSlug, setUpdatingSlug] = React.useState("")
  const [removingSlug, setRemovingSlug] = React.useState("")
  const cardSize: SkillCardSize = embedded ? "large" : "default"
  const skillGridClass = getSkillGridClass(cardSize)
  const offset = page * PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const visibleStart = totalCount === 0 ? 0 : offset + 1
  const visibleEnd = Math.min(offset + skills.length, totalCount)
  const normalizedQuery = query.trim().toLowerCase()
  const isSkillsPlugin = pluginType === "skills"
  const isMineView = view === "mine"
  const searchPlaceholder = isMineView
    ? t.skillSearch
    : pluginType === "mcp"
      ? t.mcpSearch
      : t.skillSearch
  const installedBySlug = React.useMemo(() => {
    return new Map(installedSkills.map((skill) => [skill.slug, skill]))
  }, [installedSkills])
  const selectedInstalledSkill = React.useMemo(() => {
    const slug = selectedSkill?.Slug?.trim()

    return slug ? installedBySlug.get(slug) : undefined
  }, [installedBySlug, selectedSkill])
  const visibleSkills =
    debouncedQuery || !normalizedQuery
      ? skills
      : skills.filter((skill) =>
          getSkillSearchText(skill).includes(normalizedQuery)
        )
  const visibleInstalledSkills = React.useMemo(() => {
    if (!normalizedQuery) {
      return installedSkills
    }

    return installedSkills.filter((installedSkill) =>
      getSkillSearchText(installedSkill.skill).includes(normalizedQuery)
    )
  }, [installedSkills, normalizedQuery])

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
      setPage(0)
    }, 250)

    return () => window.clearTimeout(timer)
  }, [query])

  React.useEffect(() => {
    const controller = new AbortController()

    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return
      }

      setLoading(true)
      setError("")

      void fetchSkills({
        category,
        keyword: debouncedQuery,
        offset,
        orderBy,
        signal: controller.signal,
      })
        .then((payload) => {
          setSkills(payload.data)
          setTotalCount(payload.totalCount)
          setCategories(payload.allCategories)
        })
        .catch((loadError) => {
          if (!controller.signal.aborted) {
            setError(
              loadError instanceof Error ? loadError.message : t.requestFailed
            )
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false)
          }
        })
    })

    return () => controller.abort()
  }, [category, debouncedQuery, offset, orderBy, refreshTick, t.requestFailed])

  React.useEffect(() => {
    const controller = new AbortController()

    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return
      }

      setInstalledLoading(true)

      void fetchInstalledSkills(controller.signal)
        .then((data) => {
          setInstalledSkills(data)
        })
        .catch((loadError) => {
          if (!controller.signal.aborted) {
            setError(
              loadError instanceof Error ? loadError.message : t.requestFailed
            )
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setInstalledLoading(false)
          }
        })
    })

    return () => controller.abort()
  }, [refreshTick, t.requestFailed])

  const refresh = React.useCallback(() => {
    setDebouncedQuery(query.trim())
    setPage(0)
    setRefreshTick((current) => current + 1)
  }, [query])

  const openSkill = React.useCallback((skill: SkillMeta) => {
    setSelectedSkill(skill)
    setDetailSource("market")
    setDetail(null)
    setDetailError("")
    setDetailOpen(true)
  }, [])

  const openInstalledSkill = React.useCallback(
    (installedSkill: InstalledSkill) => {
      setSelectedSkill(installedSkill.skill)
      setDetailSource("mine")
      setDetail({
        skill: installedSkill.skill,
        skillMd: installedSkill.skillMd,
      })
      setDetailLoading(false)
      setDetailError("")
      setDetailOpen(true)
    },
    []
  )

  React.useEffect(() => {
    if (!detailOpen || !selectedSkill) {
      return
    }

    if (detailSource === "mine") {
      return
    }

    const controller = new AbortController()

    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return
      }

      setDetailLoading(true)
      setDetailError("")

      void fetchSkillDetail(selectedSkill, controller.signal)
        .then((data) => {
          setDetail({ skill: data.skill, skillMd: data.skillMd })
        })
        .catch((loadError) => {
          if (!controller.signal.aborted) {
            setDetailError(
              loadError instanceof Error ? loadError.message : t.requestFailed
            )
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setDetailLoading(false)
          }
        })
    })

    return () => controller.abort()
  }, [detailOpen, detailSource, selectedSkill, t.requestFailed])

  const upsertInstalledSkill = React.useCallback(
    (installedSkill: InstalledSkill) => {
      setInstalledSkills((current) => {
        const existingIndex = current.findIndex(
          (item) => item.slug === installedSkill.slug
        )

        if (existingIndex < 0) {
          return [installedSkill, ...current]
        }

        return current.map((item) =>
          item.slug === installedSkill.slug ? installedSkill : item
        )
      })
    },
    []
  )

  const handleInstallSkill = React.useCallback(
    async (skill: SkillMeta) => {
      const slug = skill.Slug?.trim()

      if (!slug) {
        return
      }

      setInstallingSlug(slug)
      setError("")

      try {
        const installedSkill = await installSkill(skill)
        upsertInstalledSkill(installedSkill)

        if (selectedSkill?.Slug?.trim() === slug) {
          setDetail({
            skill: installedSkill.skill,
            skillMd: installedSkill.skillMd,
          })
        }
      } catch (installError) {
        const message =
          installError instanceof Error ? installError.message : t.requestFailed

        setError(message)
        setDetailError(message)
      } finally {
        setInstallingSlug("")
      }
    },
    [selectedSkill, t.requestFailed, upsertInstalledSkill]
  )

  const handleToggleInstalledSkill = React.useCallback(
    async (installedSkill: InstalledSkill, enabled: boolean) => {
      setUpdatingSlug(installedSkill.slug)
      setError("")

      try {
        const updatedSkill = await updateInstalledSkill(
          installedSkill.slug,
          enabled
        )
        upsertInstalledSkill(updatedSkill)
      } catch (updateError) {
        setError(
          updateError instanceof Error ? updateError.message : t.requestFailed
        )
      } finally {
        setUpdatingSlug("")
      }
    },
    [t.requestFailed, upsertInstalledSkill]
  )

  const handleRemoveInstalledSkill = React.useCallback(
    async (installedSkill: InstalledSkill) => {
      setRemovingSlug(installedSkill.slug)
      setError("")

      try {
        await removeInstalledSkill(installedSkill.slug)
        setInstalledSkills((current) =>
          current.filter((item) => item.slug !== installedSkill.slug)
        )

        if (selectedSkill?.Slug?.trim() === installedSkill.slug) {
          setDetailOpen(false)
        }
      } catch (removeError) {
        setError(
          removeError instanceof Error ? removeError.message : t.requestFailed
        )
      } finally {
        setRemovingSlug("")
      }
    },
    [selectedSkill, t.requestFailed]
  )

  function handleCategoryChange(nextCategory: string) {
    setCategory(nextCategory)
    setPage(0)
  }

  function handleOrderChange(nextOrderBy: string) {
    setOrderBy(nextOrderBy as SkillOrderBy)
    setPage(0)
  }

  function handlePluginTypeChange(nextPluginType: PluginType) {
    setPluginType(nextPluginType)
    setView("market")
    setQuery("")
    setDebouncedQuery("")
    setPage(0)
  }

  function handleViewChange(nextView: SkillsView) {
    setView(nextView)
    setPage(0)
  }

  return (
    <main
      className={cn(
        "overflow-hidden bg-background",
        embedded ? "h-full rounded-4xl" : "h-[calc(100svh-4rem)]"
      )}
    >
      <div
        className={cn(
          "flex h-full min-h-0 flex-col gap-4",
          embedded ? "p-4" : "p-4 lg:p-6"
        )}
      >
        <section className="sticky top-0 z-20 flex shrink-0 flex-col gap-3 rounded-4xl border bg-background/95 p-3 shadow-sm backdrop-blur xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 sm:w-[320px]">
              <RiSearchLine
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="h-9 pl-9"
              />
            </div>

            {isSkillsPlugin && view === "market" ? (
              <>
                <Select value={category} onValueChange={handleCategoryChange}>
                  <SelectTrigger
                    size="sm"
                    className="h-9 w-full max-w-full min-w-0 px-2.5 text-xs sm:w-fit sm:max-w-56 sm:text-sm lg:max-w-64"
                    aria-label={t.skillCategory}
                  >
                    <RiFolderLine className="size-4 shrink-0 text-muted-foreground" />
                    <SelectValue placeholder={t.skillCategory} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={allCategoriesValue}>
                        {t.skillAllCategories}
                      </SelectItem>
                      {categories.map((item) => (
                        <SelectItem key={item} value={item}>
                          {categoryLabel(item)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>

                <Select value={orderBy} onValueChange={handleOrderChange}>
                  <SelectTrigger
                    size="sm"
                    className="h-9 w-full max-w-full min-w-0 px-2.5 text-xs sm:w-fit sm:max-w-44 sm:text-sm lg:max-w-52"
                    aria-label={t.skillSort}
                  >
                    <SelectValue placeholder={t.skillSort} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="popular">
                        {t.skillSortDownloads}
                      </SelectItem>
                      <SelectItem value="recent">
                        {t.skillSortUpdated}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </>
            ) : null}
          </div>

          <div className="flex min-w-0 items-center justify-end gap-2 text-sm text-muted-foreground xl:ml-auto">
            <span className="min-w-0 truncate text-xs sm:text-sm">
              {isMineView
                ? t.skillInstalledSummary(visibleInstalledSkills.length)
                : pluginType === "mcp"
                ? t.pluginMcpSummary
                : t.skillsSummary(visibleStart, visibleEnd, totalCount)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0 rounded-full px-3"
              aria-label={t.refresh}
              onClick={refresh}
              disabled={
                isMineView
                  ? installedLoading
                  : pluginType === "mcp"
                    ? false
                    : loading
              }
            >
              <RiRefreshLine
                data-icon="inline-start"
                aria-hidden
                className={cn(
                  (isMineView ? installedLoading : isSkillsPlugin && loading) &&
                    "animate-spin"
                )}
              />
              <span className="hidden sm:inline">{t.refresh}</span>
            </Button>
          </div>
        </section>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="sticky top-0 flex h-full min-h-0 flex-col overflow-hidden rounded-4xl border bg-card p-3 shadow-sm">
            <div className="mb-3 pl-3 text-sm font-medium">
              {t.pluginType}
            </div>
            <div className="flex flex-col gap-1">
              <Button
                type="button"
                variant={
                  !isMineView && pluginType === "skills"
                    ? "secondary"
                    : "ghost"
                }
                className="h-9 justify-start gap-2 px-2 font-normal"
                onClick={() => handlePluginTypeChange("skills")}
              >
                <RiBookOpenLine className="size-4" aria-hidden />
                <span>{t.pluginTypeSkills}</span>
              </Button>
              <Button
                type="button"
                variant={
                  !isMineView && pluginType === "mcp" ? "secondary" : "ghost"
                }
                className="h-9 justify-start gap-2 px-2 font-normal"
                onClick={() => handlePluginTypeChange("mcp")}
              >
                <RiFolderLine className="size-4" aria-hidden />
                <span>{t.pluginTypeMcp}</span>
              </Button>
            </div>

            <div className="mt-auto pt-3">
              <Button
                type="button"
                variant={view === "mine" ? "secondary" : "ghost"}
                className="h-9 w-full justify-start gap-2 px-2 font-normal"
                onClick={() => handleViewChange("mine")}
              >
                <RiUser3Line className="size-4" aria-hidden />
                <span>{t.pluginMine}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {installedSkills.length}
                </span>
              </Button>
            </div>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-col gap-3">
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {(isMineView || isSkillsPlugin) && error ? (
                <Alert variant="destructive" className="mb-4">
                  <AlertTitle>{t.requestFailed}</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              {isMineView ? (
                <div className="flex flex-col gap-6">
                  <section className="flex flex-col gap-3">
                    <div className="flex min-w-0 items-center justify-between gap-3 px-1">
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
                        {t.skillInstalledSummary(
                          visibleInstalledSkills.length
                        )}
                      </span>
                    </div>

                    {installedLoading ? (
                      <SkillSkeletonGrid size={cardSize} />
                    ) : visibleInstalledSkills.length === 0 ? (
                      <div className="flex min-h-48 items-center justify-center rounded-3xl border border-dashed bg-muted/20 py-12">
                        <div className="flex max-w-sm flex-col items-center text-center">
                          <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <RiBookOpenLine className="size-5" aria-hidden />
                          </div>
                          <p className="text-sm font-medium">
                            {t.skillNoInstalled}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className={skillGridClass}>
                        {visibleInstalledSkills.map((installedSkill) => (
                          <InstalledSkillCard
                            key={`${installedSkill.slug}-${installedSkill.version}`}
                            busy={
                              updatingSlug === installedSkill.slug ||
                              removingSlug === installedSkill.slug
                            }
                            installedSkill={installedSkill}
                            locale={locale}
                            onOpen={openInstalledSkill}
                            onRemove={handleRemoveInstalledSkill}
                            onToggle={handleToggleInstalledSkill}
                            size={cardSize}
                          />
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="flex flex-col gap-3">
                    <div className="flex min-w-0 items-center justify-between gap-3 px-1">
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
                        {t.pluginMcpSummary}
                      </span>
                    </div>

                    <div className="flex min-h-48 items-center justify-center rounded-3xl border border-dashed bg-muted/20 py-12">
                      <div className="flex max-w-sm flex-col items-center text-center">
                        <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <RiFolderLine className="size-5" aria-hidden />
                        </div>
                        <p className="text-sm font-medium">
                          {t.pluginMcpComingSoon}
                        </p>
                      </div>
                    </div>
                  </section>
                </div>
              ) : !isSkillsPlugin ? (
                <div className="flex min-h-full items-center justify-center py-12">
                  <div className="flex max-w-sm flex-col items-center text-center">
                    <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <RiFolderLine className="size-5" aria-hidden />
                    </div>
                    <p className="text-sm font-medium">
                      {t.pluginMcpComingSoon}
                    </p>
                  </div>
                </div>
              ) : view === "market" && loading ? (
                <SkillSkeletonGrid size={cardSize} />
              ) : view === "market" && visibleSkills.length === 0 ? (
                <div className="flex min-h-full items-center justify-center py-12">
                  <div className="flex max-w-sm flex-col items-center text-center">
                    <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <RiBookOpenLine className="size-5" aria-hidden />
                    </div>
                    <p className="text-sm font-medium">{t.noSkillsFound}</p>
                  </div>
                </div>
              ) : view === "market" ? (
                <div className={skillGridClass}>
                  {visibleSkills.map((skill) => (
                    <SkillCard
                      key={`${skill.Slug}-${skill.Version}`}
                      installedSkill={
                        skill.Slug ? installedBySlug.get(skill.Slug) : undefined
                      }
                      installing={installingSlug === skill.Slug}
                      locale={locale}
                      skill={skill}
                      onInstall={handleInstallSkill}
                      onOpen={openSkill}
                      size={cardSize}
                    />
                  ))}
                </div>
              ) : (
                <div className={skillGridClass}>
                  {visibleInstalledSkills.map((installedSkill) => (
                    <InstalledSkillCard
                      key={`${installedSkill.slug}-${installedSkill.version}`}
                      busy={
                        updatingSlug === installedSkill.slug ||
                        removingSlug === installedSkill.slug
                      }
                      installedSkill={installedSkill}
                      locale={locale}
                      onOpen={openInstalledSkill}
                      onRemove={handleRemoveInstalledSkill}
                      onToggle={handleToggleInstalledSkill}
                      size={cardSize}
                    />
                  ))}
                </div>
              )}
            </div>

            {isSkillsPlugin && view === "market" ? (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-4xl border bg-background/95 px-4 py-3 shadow-sm">
                <span className="text-sm text-muted-foreground">
                  {t.skillsPage(page + 1, totalPages)}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page <= 0 || loading}
                    onClick={() =>
                      setPage((current) => Math.max(0, current - 1))
                    }
                  >
                    <RiArrowLeftSLine aria-hidden />
                    {t.previous}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page + 1 >= totalPages || loading}
                    onClick={() =>
                      setPage((current) =>
                        Math.min(totalPages - 1, current + 1)
                      )
                    }
                  >
                    {t.next}
                    <RiArrowRightSLine aria-hidden />
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </div>

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
    </main>
  )
}

export { SkillsMarketPage }
