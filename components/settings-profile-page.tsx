"use client"

import * as React from "react"
import {
  RiBuilding2Line,
  RiCalendarLine,
  RiCheckboxCircleLine,
  RiDatabase2Line,
  RiFolderLine,
  RiIdCardLine,
  RiLoader4Line,
  RiMailLine,
  RiTeamLine,
  RiUser3Line,
} from "@remixicon/react"

import { AppInfoButton } from "@/components/app-info-button"
import { LanguageToggle } from "@/components/language-toggle"
import { LogoutButton } from "@/components/logout-button"
import { ThemeToggle } from "@/components/theme-toggle"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { useI18n } from "@/components/i18n-provider"
import {
  readSelectedUCloudProjectId,
  UCLOUD_PROJECT_CHANGED_EVENT,
  type UCloudProjectChangedDetail,
  writeSelectedUCloudProjectId,
} from "@/lib/project-selection"

type UCloudProjectOption = {
  id: string
  name: string
  memberCount: number | null
  resourceCount: number | null
  createdAt: number | null
  isDefault: boolean | null
}

type UCloudUserInfoPayload = {
  userName: string
  displayName: string
  companyName: string
  userEmail: string
  companyId: number | null
}

type ProjectsPayload = {
  items: UCloudProjectOption[]
  selectedProjectId: string | null
  user: UCloudUserInfoPayload | null
}

type ProjectsResponse =
  | {
      ok: true
      data: ProjectsPayload
    }
  | {
      ok: false
      message?: string
    }

async function fetchProjects() {
  const response = await fetch("/api/studio/projects", { cache: "no-store" })
  const payload = (await response.json()) as ProjectsResponse

  if (!response.ok || !payload.ok) {
    throw new Error(
      (!payload.ok && payload.message) || "Failed to load projects."
    )
  }

  return payload.data
}

async function saveSelectedProject(projectId: string) {
  const response = await fetch("/api/studio/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId }),
  })
  const payload = (await response.json()) as ProjectsResponse

  if (!response.ok || !payload.ok) {
    throw new Error(
      (!payload.ok && payload.message) || "Failed to select project."
    )
  }

  return payload.data
}

function emitProjectChanged(projectId: string) {
  writeSelectedUCloudProjectId(projectId)
  window.dispatchEvent(
    new CustomEvent<UCloudProjectChangedDetail>(UCLOUD_PROJECT_CHANGED_EVENT, {
      detail: { projectId },
    })
  )
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-4 px-4 py-3">
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-3.5" aria-hidden />
        </span>
        <span className="min-w-0 text-sm font-medium">{label}</span>
      </span>
      <span className="min-w-0 truncate text-right text-sm text-muted-foreground">
        {value}
      </span>
    </div>
  )
}

function SettingsSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="grid gap-2">
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="divide-y">{children}</div>
      </div>
    </section>
  )
}

function PreferenceRow({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function StatCell({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-lg border bg-card px-3 py-3">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <div className="truncate text-base font-semibold">{value}</div>
        <div className="mt-0.5 truncate text-xs font-medium text-muted-foreground">
          {label}
        </div>
      </div>
    </div>
  )
}

function getInitials(value: string) {
  const normalized = value.trim()

  if (!normalized) {
    return "AF"
  }

  return normalized.slice(0, 2).toUpperCase()
}

function formatCount(value: number | null, locale: string) {
  return typeof value === "number"
    ? new Intl.NumberFormat(locale).format(value)
    : "-"
}

function formatProjectCreatedAt(value: number | null, locale: string) {
  if (!value) {
    return "-"
  }

  const timestamp = value > 1_000_000_000_000 ? value : value * 1000
  const date = new Date(timestamp)

  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date)
}

function formatHandle(value: string) {
  const normalized = value.trim()

  if (!normalized) {
    return "-"
  }

  return normalized.startsWith("@") ? normalized : `@${normalized}`
}

function SettingsProfilePage() {
  const { locale, t } = useI18n()
  const [projects, setProjects] = React.useState<UCloudProjectOption[]>([])
  const [selectedProjectId, setSelectedProjectId] = React.useState("")
  const [user, setUser] = React.useState<UCloudUserInfoPayload | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [error, setError] = React.useState("")

  const copy =
    locale === "zh"
      ? {
          handle: "账户标识",
          projectCount: "项目数",
          members: "成员",
          resources: "资源",
          createdAt: "创建时间",
          defaultProject: "默认项目",
          accountDetails: t.settingsAccountDetailsSection,
          project: t.settingsProjectSection,
          preferences: t.settingsPreferencesSection,
          appearance: "外观",
          language: "语言",
          appInfo: "应用信息",
          session: t.settingsSessionSection,
          notDefault: "普通项目",
        }
      : {
          handle: "Account handle",
          projectCount: "Projects",
          members: "Members",
          resources: "Resources",
          createdAt: "Created",
          defaultProject: "Default project",
          accountDetails: t.settingsAccountDetailsSection,
          project: t.settingsProjectSection,
          preferences: t.settingsPreferencesSection,
          appearance: "Appearance",
          language: "Language",
          appInfo: "App info",
          session: t.settingsSessionSection,
          notDefault: "Standard project",
        }

  const loadProjects = React.useCallback(async () => {
    try {
      setIsLoading(true)
      setError("")

      const next = await fetchProjects()
      const resolvedProjectId = next.selectedProjectId ?? ""
      const previousProjectId = readSelectedUCloudProjectId()

      setProjects(next.items)
      setSelectedProjectId(resolvedProjectId)
      setUser(next.user)

      if (resolvedProjectId && resolvedProjectId !== previousProjectId) {
        emitProjectChanged(resolvedProjectId)
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : t.projectLoadFailed
      )
    } finally {
      setIsLoading(false)
    }
  }, [t.projectLoadFailed])

  React.useEffect(() => {
    queueMicrotask(() => {
      void loadProjects()
    })
  }, [loadProjects])

  async function selectProject(projectId: string) {
    const nextProjectId = projectId.trim()

    if (
      !nextProjectId ||
      nextProjectId === "__empty" ||
      nextProjectId === selectedProjectId
    ) {
      return
    }

    const previousProjectId = selectedProjectId

    setSelectedProjectId(nextProjectId)
    setIsSaving(true)
    setError("")

    try {
      const next = await saveSelectedProject(nextProjectId)
      const resolvedProjectId = next.selectedProjectId ?? nextProjectId

      setProjects(next.items)
      setSelectedProjectId(resolvedProjectId)
      setUser(next.user)
      emitProjectChanged(resolvedProjectId)
    } catch (selectError) {
      setSelectedProjectId(previousProjectId)
      setError(
        selectError instanceof Error
          ? selectError.message
          : t.projectSelectFailed
      )
    } finally {
      setIsSaving(false)
    }
  }

  const displayName =
    user?.displayName ||
    user?.userName ||
    user?.userEmail ||
    (isLoading ? t.accountLoading : t.account)
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? null
  const companyId =
    typeof user?.companyId === "number" ? String(user.companyId) : "-"
  const handle = formatHandle(
    user?.userName || user?.userEmail?.split("@")[0] || ""
  )
  const selectedProjectName =
    selectedProject?.name || (isLoading ? t.projectLoading : t.project)

  return (
    <section className="flex min-h-0 flex-col bg-background">
      <main className="min-h-0 flex-1">
        <div className="flex w-full flex-col gap-6">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-3xl font-semibold tracking-normal">
                {t.profile}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {t.settingsProfileDescription}
              </p>
            </div>
            {isLoading || isSaving ? (
              <RiLoader4Line
                className="size-5 shrink-0 animate-spin text-muted-foreground"
                aria-hidden
              />
            ) : null}
          </div>

          <section className="flex flex-col items-start pt-1">
            <Avatar className="size-20">
              <AvatarFallback className="bg-primary text-2xl font-medium text-primary-foreground">
                {getInitials(displayName)}
              </AvatarFallback>
            </Avatar>
            <h2 className="mt-3 max-w-full truncate text-2xl font-semibold">
              {displayName}
            </h2>
            <div className="mt-1.5 flex max-w-full flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate">{handle}</span>
              <span aria-hidden>·</span>
              <span className="truncate">{user?.userEmail || "-"}</span>
            </div>
          </section>

          <section className="grid gap-2.5 sm:grid-cols-2">
            <StatCell icon={RiUser3Line} label={copy.handle} value={handle} />
            <StatCell
              icon={RiFolderLine}
              label={copy.projectCount}
              value={formatCount(projects.length, locale)}
            />
            <StatCell
              icon={RiTeamLine}
              label={copy.members}
              value={formatCount(selectedProject?.memberCount ?? null, locale)}
            />
            <StatCell
              icon={RiDatabase2Line}
              label={copy.resources}
              value={formatCount(
                selectedProject?.resourceCount ?? null,
                locale
              )}
            />
            <StatCell
              icon={RiCalendarLine}
              label={copy.createdAt}
              value={formatProjectCreatedAt(
                selectedProject?.createdAt ?? null,
                locale
              )}
            />
          </section>

          <div className="grid min-w-0 gap-6">
            <SettingsSection title={copy.accountDetails}>
                <DetailRow
                  icon={RiUser3Line}
                  label={t.accountDisplayName}
                  value={user?.displayName || "-"}
                />
                <DetailRow
                  icon={RiBuilding2Line}
                  label={t.accountCompanyName}
                  value={user?.companyName || "-"}
                />
                <DetailRow
                  icon={RiMailLine}
                  label={t.accountUserEmail}
                  value={user?.userEmail || "-"}
                />
                <DetailRow
                  icon={RiIdCardLine}
                  label={t.accountCompanyId}
                  value={companyId}
                />
            </SettingsSection>

            <SettingsSection title={copy.project}>
              <div className="px-4 py-3">
                <Select
                  value={selectedProjectId}
                  onValueChange={(value) => void selectProject(value)}
                  disabled={isLoading || isSaving}
                >
                  <SelectTrigger
                    aria-label={t.project}
                    className="!h-10 w-full justify-start rounded-lg border-border bg-background px-3 hover:bg-muted/60"
                    title={error || t.project}
                  >
                    <span className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left">
                      <span className="flex min-w-0 items-center gap-2">
                        <RiFolderLine
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="min-w-0 truncate text-sm font-medium">
                          {selectedProjectName}
                        </span>
                      </span>
                      {selectedProject ? (
                        <span className="max-w-32 shrink-0 truncate font-mono text-xs text-muted-foreground">
                          {selectedProject.id}
                        </span>
                      ) : null}
                    </span>
                  </SelectTrigger>
                  <SelectContent
                    align="end"
                    className="max-h-80"
                    position="popper"
                  >
                    <SelectGroup>
                      {projects.length === 0 ? (
                        <SelectItem value="__empty" disabled>
                          {t.projectEmpty}
                        </SelectItem>
                      ) : (
                        projects.map((project) => (
                          <SelectItem
                            className="[&>span:last-child]:w-full"
                            key={project.id}
                            textValue={`${project.name} ${project.id}`}
                            value={project.id}
                          >
                            <span className="flex w-full min-w-0 items-center justify-between gap-3 py-1">
                              <span className="min-w-0 truncate text-sm font-medium">
                                {project.name}
                              </span>
                              <span className="max-w-36 shrink-0 truncate font-mono text-xs text-muted-foreground">
                                {project.id}
                              </span>
                            </span>
                          </SelectItem>
                        ))
                      )}
                    </SelectGroup>
                  </SelectContent>
                </Select>

                {error ? (
                  <div className="mt-2 text-xs font-medium text-destructive">
                    {error}
                  </div>
                ) : null}
              </div>
                  <DetailRow
                    icon={RiIdCardLine}
                    label={t.projectId}
                    value={selectedProject?.id || "-"}
                  />
                  <DetailRow
                    icon={RiCheckboxCircleLine}
                    label={copy.defaultProject}
                    value={
                      selectedProject?.isDefault
                        ? copy.defaultProject
                        : copy.notDefault
                    }
                  />
                  <DetailRow
                    icon={RiTeamLine}
                    label={copy.members}
                    value={formatCount(
                      selectedProject?.memberCount ?? null,
                      locale
                    )}
                  />
                  <DetailRow
                    icon={RiCalendarLine}
                    label={copy.createdAt}
                    value={formatProjectCreatedAt(
                      selectedProject?.createdAt ?? null,
                      locale
                    )}
                  />
            </SettingsSection>

            <SettingsSection title={copy.preferences}>
                <PreferenceRow title={copy.appearance}>
                  <ThemeToggle />
                </PreferenceRow>
                <PreferenceRow title={copy.language}>
                  <LanguageToggle />
                </PreferenceRow>
                <PreferenceRow title={copy.appInfo}>
                  <AppInfoButton />
                </PreferenceRow>
            </SettingsSection>

            <SettingsSection title={copy.session}>
              <div className="px-4 py-3">
                <div className="text-sm font-medium">{displayName}</div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {user?.userEmail || "-"}
                </div>
                <div className="mt-3">
                  <LogoutButton className="justify-start" />
                </div>
              </div>
            </SettingsSection>
          </div>
        </div>
      </main>
    </section>
  )
}

export { SettingsProfilePage }
