"use client"

import * as React from "react"
import { toast } from "sonner"

import { CentralIcon } from "@/components/central-icon"
import { useI18n } from "@/components/i18n-provider"
import { SynaraButton } from "@/components/ui/synara-button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  SynaraTooltip,
  SynaraTooltipPopup,
  SynaraTooltipTrigger,
} from "@/components/ui/synara-tooltip"
import type { StudioProfileStats } from "@/lib/studio-profile-stats"
import { cn } from "@/lib/utils"

type ProfileStats = StudioProfileStats

type ProfileIdentity = {
  displayName: string
  handle: string
  initials: string
}

type HeatmapCell = {
  day: string
  count: number
  weekday: number
  intensity: number
}

type HeatmapSlot =
  { kind: "cell"; cell: HeatmapCell } | { kind: "pad"; id: string }

const profileCopy = {
  en: {
    statsLoadFailed: "Couldn’t load your local stats.",
    profileLoadFailed: "Couldn’t load profile.",
    tryAgain: "Try again",
    share: "Share",
    edit: "Edit",
    copied: "Profile summary copied.",
    lifetimeTokens: "Lifetime tokens",
    peakDay: "Peak day",
    totalPrompts: "Total prompts",
    currentStreak: "Current streak",
    longestStreak: "Longest streak",
    activity: "Activity",
    activityInsights: "Activity insights",
    mostUsedProvider: "Most used provider",
    mostUsedReasoning: "Most used reasoning",
    mostActiveHour: "Most active hour",
    mostWorkedProject: "Most worked project",
    skillsExplored: "Skills explored",
    totalSkillsUsed: "Total skills used",
    totalThreads: "Total threads",
    mostUsedPlugins: "Most used plugins",
    noPlugins: "No skills or agents used yet.",
    modelUsage: "Model usage",
    noModelActivity: "No model activity yet.",
    day: "day",
    days: "days",
    prompt: "prompt",
    prompts: "prompts",
    threads: "threads",
    tokens: "tokens",
  },
  zh: {
    statsLoadFailed: "无法加载本地使用统计。",
    profileLoadFailed: "无法加载个人资料。",
    tryAgain: "重试",
    share: "分享",
    edit: "编辑",
    copied: "个人资料摘要已复制。",
    lifetimeTokens: "累计 Token",
    peakDay: "单日峰值",
    totalPrompts: "提示词总数",
    currentStreak: "当前连续天数",
    longestStreak: "最长连续天数",
    activity: "活动",
    activityInsights: "活动洞察",
    mostUsedProvider: "最常用提供方",
    mostUsedReasoning: "最常用思考强度",
    mostActiveHour: "最活跃时段",
    mostWorkedProject: "最常用项目",
    skillsExplored: "浏览过的技能",
    totalSkillsUsed: "使用过的技能",
    totalThreads: "会话总数",
    mostUsedPlugins: "最常用插件",
    noPlugins: "尚未使用技能或 Agent。",
    modelUsage: "模型使用情况",
    noModelActivity: "还没有模型使用记录。",
    day: "天",
    days: "天",
    prompt: "条提示词",
    prompts: "条提示词",
    threads: "个会话",
    tokens: "Token",
  },
} as const

type ProfileCopy = (typeof profileCopy)[keyof typeof profileCopy]

const heatmapIntensityClasses = [
  "bg-muted/70 dark:bg-white/[0.06]",
  "bg-[color-mix(in_srgb,var(--info)_24%,transparent)]",
  "bg-[color-mix(in_srgb,var(--info)_46%,transparent)]",
  "bg-[color-mix(in_srgb,var(--info)_72%,transparent)]",
  "bg-[var(--info)]",
] as const

function formatCompact(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—"
  }

  const absolute = Math.abs(value)
  const compact = (divisor: number, suffix: string) => {
    const rounded = Math.round((value / divisor) * 10) / 10

    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}${suffix}`
  }

  if (absolute >= 1_000_000_000) return compact(1_000_000_000, "bn")
  if (absolute >= 1_000_000) return compact(1_000_000, "m")
  if (absolute >= 1_000) return compact(1_000, "k")

  return Math.round(value).toLocaleString()
}

function formatDays(value: number, locale: string, copy: ProfileCopy) {
  return `${value.toLocaleString(locale === "zh" ? "zh-CN" : "en-US")} ${
    value === 1 ? copy.day : copy.days
  }`
}

function formatHour(hour: number | null, locale: string) {
  if (hour === null) return "—"

  const normalized = ((hour % 24) + 24) % 24
  const date = new Date(2020, 0, 1, normalized)

  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    hour: "numeric",
  }).format(date)
}

function getInitials(value: string) {
  const initials = value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")

  return initials || "AF"
}

function buildHeatmapCells(activity: ProfileStats["activity"]) {
  const countByDay = new Map(activity.map((entry) => [entry.day, entry.count]))
  const counts = activity.map((entry) => entry.count)
  const max = Math.max(1, ...counts)
  const end = new Date()
  end.setUTCHours(0, 0, 0, 0)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 364)
  const cells: HeatmapCell[] = []

  for (let index = 0; index < 365; index += 1) {
    const date = new Date(start)
    date.setUTCDate(start.getUTCDate() + index)
    const day = date.toISOString().slice(0, 10)
    const count = countByDay.get(day) ?? 0
    const intensity =
      count === 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((count / max) * 4)))

    cells.push({ day, count, weekday: date.getUTCDay(), intensity })
  }

  return cells
}

function ActivityHeatmap({
  activity,
  copy,
  locale,
}: {
  activity: ProfileStats["activity"]
  copy: ProfileCopy
  locale: string
}) {
  const cells = React.useMemo(() => buildHeatmapCells(activity), [activity])
  const columns = React.useMemo(() => {
    const slots: HeatmapSlot[] = []

    for (let index = 0; index < (cells[0]?.weekday ?? 0); index += 1) {
      slots.push({ kind: "pad", id: `lead-${index}` })
    }

    for (const cell of cells) slots.push({ kind: "cell", cell })
    while (slots.length % 7 !== 0) {
      slots.push({ kind: "pad", id: `tail-${slots.length}` })
    }

    const result: { key: string; slots: HeatmapSlot[] }[] = []

    for (let index = 0; index < slots.length; index += 7) {
      result.push({
        key: `week-${index / 7}`,
        slots: slots.slice(index, index + 7),
      })
    }

    return result
  }, [cells])
  const months = React.useMemo(() => {
    let previous = -1

    return columns.map((column) => {
      const first = column.slots.find(
        (slot): slot is Extract<HeatmapSlot, { kind: "cell" }> =>
          slot.kind === "cell"
      )
      const month = first ? Number(first.cell.day.slice(5, 7)) - 1 : -1

      if (month < 0 || month === previous) return ""
      previous = month

      return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
        month: "short",
      }).format(new Date(Date.UTC(2020, month, 1)))
    })
  }, [columns, locale])

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 gap-[3px]">
        {columns.map((column) => (
          <div
            key={column.key}
            className="flex min-w-0 flex-1 flex-col gap-[3px]"
          >
            {column.slots.map((slot) => {
              if (slot.kind === "pad") {
                return <span key={slot.id} className="aspect-square w-full" />
              }

              return (
                <SynaraTooltip key={slot.cell.day}>
                  <SynaraTooltipTrigger
                    delay={0}
                    render={
                      <span
                        className={cn(
                          "aspect-square w-full rounded-[5px]",
                          heatmapIntensityClasses[slot.cell.intensity]
                        )}
                      />
                    }
                  />
                  <SynaraTooltipPopup side="top" sideOffset={6}>
                    {slot.cell.count === 0
                      ? locale === "zh"
                        ? `${slot.cell.day} 没有提示词`
                        : `No prompts on ${slot.cell.day}`
                      : locale === "zh"
                        ? `${slot.cell.day} · ${slot.cell.count.toLocaleString("zh-CN")} ${copy.prompts}`
                        : `${slot.cell.count.toLocaleString("en-US")} ${
                            slot.cell.count === 1 ? copy.prompt : copy.prompts
                          } on ${slot.cell.day}`}
                  </SynaraTooltipPopup>
                </SynaraTooltip>
              )
            })}
          </div>
        ))}
      </div>
      <div className="flex min-w-0 gap-[3px]">
        {columns.map((column, index) => (
          <span
            key={column.key}
            className="min-w-0 flex-1 overflow-visible text-[10px] font-medium whitespace-nowrap text-muted-foreground"
          >
            {months[index]}
          </span>
        ))}
      </div>
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-3 py-3">
      <span className="text-sm font-normal text-foreground tabular-nums">
        {value}
      </span>
      <span className="text-sm font-normal text-muted-foreground">{label}</span>
    </div>
  )
}

function InsightRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-normal tabular-nums" title={value}>
        {value}
      </dd>
    </div>
  )
}

function ProfileSkeleton() {
  return (
    <div className="flex flex-col items-center gap-7">
      <Skeleton className="size-16 rounded-full" />
      <div className="flex flex-col items-center gap-1.5">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-[72px] w-full rounded-2xl" />
      <Skeleton className="h-28 w-full rounded-lg" />
      <div className="grid w-full gap-7 md:grid-cols-2">
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    </div>
  )
}

async function loadProfileStats(errorMessage: string) {
  const response = await fetch("/api/studio/profile-stats", {
    cache: "no-store",
  })
  const payload = (await response.json()) as {
    ok: boolean
    data?: ProfileStats
  }

  if (!response.ok || !payload.ok || !payload.data) {
    throw new Error(errorMessage)
  }

  return payload.data
}

async function loadProfileIdentity(): Promise<ProfileIdentity> {
  const fallback = {
    displayName: "AstraFlow",
    handle: "@astraflow",
    initials: "AF",
  }

  try {
    const response = await fetch("/api/studio/projects", { cache: "no-store" })
    const payload = (await response.json()) as {
      ok: boolean
      data?: {
        user?: {
          displayName?: string
          userName?: string
          userEmail?: string
        } | null
      }
    }
    const user = payload.data?.user
    const displayName =
      user?.displayName ||
      user?.userName ||
      user?.userEmail ||
      fallback.displayName
    const rawHandle =
      user?.userName || user?.userEmail?.split("@")[0] || "astraflow"

    return {
      displayName,
      handle: `@${rawHandle.replace(/^@+/, "")}`,
      initials: getInitials(displayName),
    }
  } catch {
    return fallback
  }
}

function SettingsProfileDashboard() {
  const { locale } = useI18n()
  const copy = profileCopy[locale]
  const [stats, setStats] = React.useState<ProfileStats | null>(null)
  const [identity, setIdentity] = React.useState<ProfileIdentity | null>(null)
  const [error, setError] = React.useState("")
  const [reloadKey, setReloadKey] = React.useState(0)

  React.useEffect(() => {
    let active = true

    void Promise.all([
      loadProfileStats(copy.statsLoadFailed),
      loadProfileIdentity(),
    ])
      .then(([nextStats, nextIdentity]) => {
        if (!active) return
        setStats(nextStats)
        setIdentity(nextIdentity)
      })
      .catch((loadError) => {
        if (!active) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : copy.profileLoadFailed
        )
      })

    return () => {
      active = false
    }
  }, [copy.profileLoadFailed, copy.statsLoadFailed, reloadKey])

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
        <SynaraButton
          variant="outline"
          size="sm"
          onClick={() => {
            setError("")
            setStats(null)
            setIdentity(null)
            setReloadKey((current) => current + 1)
          }}
        >
          {copy.tryAgain}
        </SynaraButton>
      </div>
    )
  }

  if (!stats || !identity) return <ProfileSkeleton />

  const provider = stats.topProvider
    ? `${stats.topProvider.name} · ${stats.topProvider.percent}%`
    : "—"
  const project = stats.mostWorkedProject
    ? `${stats.mostWorkedProject.title} · ${stats.mostWorkedProject.count} ${
        stats.mostWorkedProject.count === 1 ? copy.prompt : copy.prompts
      }`
    : "—"
  const shareSummary = `${identity.displayName} ${identity.handle} — ${formatCompact(
    stats.lifetimeTokens
  )} ${copy.tokens}, ${stats.totalPrompts.toLocaleString()} ${copy.prompts}, ${stats.totalThreads.toLocaleString()} ${copy.threads}.`

  function shareProfile() {
    void navigator.clipboard.writeText(shareSummary).then(() => {
      toast.success(copy.copied)
    })
  }

  return (
    <div className="flex min-w-0 flex-col gap-7">
      <div className="flex items-center justify-end gap-2">
        <SynaraButton variant="outline" size="sm" onClick={shareProfile}>
          <CentralIcon name="share-os" />
          {copy.share}
        </SynaraButton>
        <SynaraButton variant="outline" size="sm" disabled>
          <CentralIcon name="pencil" />
          {copy.edit}
        </SynaraButton>
      </div>

      <header className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-emerald-500 text-xl font-medium text-white shadow-sm">
          {identity.initials}
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">
            {identity.displayName}
          </h1>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span>{identity.handle}</span>
            <span aria-hidden>·</span>
            <span className="rounded-full border px-1.5 py-px text-xs text-muted-foreground">
              AstraFlow
            </span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 divide-x divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/60 sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
        <StatTile
          label={copy.lifetimeTokens}
          value={formatCompact(stats.lifetimeTokens)}
        />
        <StatTile
          label={copy.peakDay}
          value={formatCompact(stats.peakDayTokens)}
        />
        <StatTile
          label={copy.totalPrompts}
          value={stats.totalPrompts.toLocaleString()}
        />
        <StatTile
          label={copy.currentStreak}
          value={formatDays(stats.currentStreakDays, locale, copy)}
        />
        <StatTile
          label={copy.longestStreak}
          value={formatDays(stats.longestStreakDays, locale, copy)}
        />
      </div>

      <section className="flex min-w-0 flex-col gap-3">
        <h2 className="text-sm font-medium">{copy.activity}</h2>
        <ActivityHeatmap
          activity={stats.activity}
          copy={copy}
          locale={locale}
        />
      </section>

      <div className="grid gap-x-12 gap-y-7 md:grid-cols-2">
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">{copy.activityInsights}</h2>
          <dl className="flex flex-col gap-2.5">
            <InsightRow label={copy.mostUsedProvider} value={provider} />
            <InsightRow label={copy.mostUsedReasoning} value="—" />
            <InsightRow
              label={copy.mostActiveHour}
              value={formatHour(stats.mostActiveHour, locale)}
            />
            <InsightRow label={copy.mostWorkedProject} value={project} />
            <InsightRow label={copy.skillsExplored} value="0" />
            <InsightRow label={copy.totalSkillsUsed} value="0" />
            <InsightRow
              label={copy.totalThreads}
              value={stats.totalThreads.toLocaleString()}
            />
          </dl>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">{copy.mostUsedPlugins}</h2>
          <p className="text-sm text-muted-foreground">{copy.noPlugins}</p>
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">{copy.modelUsage}</h2>
        {stats.modelUsage.length > 0 ? (
          <ul className="grid grid-cols-1 gap-x-12 gap-y-3 sm:grid-cols-2">
            {stats.modelUsage.map((entry) => (
              <li key={entry.model} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <CentralIcon name="brain" className="size-3.5" />
                    <span className="truncate">{entry.model}</span>
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {entry.percent}%
                  </span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-[var(--info)]"
                    style={{ width: `${Math.max(2, entry.percent)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {copy.noModelActivity}
          </p>
        )}
      </section>
    </div>
  )
}

export { SettingsProfileDashboard }
